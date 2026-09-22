// ═══════════════════════════════════════════════════════════════════════════
// THE THESIS CARD — EVIDENCE FIRST, VERDICT LAST.                   (zzz715)
//
// One component, two screens: Portfolio Catalysts renders it per holding, and
// Exit Radar renders the same card for the ones that have deteriorated. They
// must never disagree about the same company, which is the whole reason this
// is a component and not two copies of a layout.
//
// THE ORDER OF THE SECTIONS IS THE ARGUMENT, and it is deliberately the
// reverse of a normal dashboard card. A dashboard leads with the verdict and
// buries the evidence. This one leads with WHAT CHANGED — before, after,
// delta, source — and only then says what it means, because the owner's
// standing instruction is that he decides and the machine's job is to have
// the evidence ready. "Machines calculate. AI interprets. You decide."
//
// FACTS AND INTERPRETATION ARE VISUALLY SEPARATE. Everything above the
// THESIS block is a figure read from a document. Everything in and below it
// is inference, and it is labelled as inference on screen. A reader who
// trusts only the top half of this card loses nothing but the conclusion.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useState } from 'react';
import { STATUS_META, type ThesisAssessment } from '@/lib/thesis/status';
import { ORIGIN_META, type BookOrigin } from '@/lib/thesis/universe';
import { CAPEX_META, type CapexChain } from '@/lib/thesis/capex-chain';
import type { VarVerdict } from '@/lib/thesis/variables';
import { VAR_GROUP, GROUP_ORDER, GROUP_LABEL, ABSENCE_MARK, type VarGroup } from '@/lib/thesis/taxonomy';
import { ABFG_META, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import type { CompanyLedger, FreshnessState, ChangeLine } from '@/lib/thesis/evidence-ledger';
import { BASIS_LABEL } from '@/lib/thesis/comparison';

// ── THE PALETTE.                                                   (zzz723)
//
// The first version reached for whatever colour was nearest — the portal's
// bullish green for "improving", a hard red for anything down, and the same
// muted grey for four completely different kinds of absence. The result was a
// wall of red and green in which a deteriorating CORE variable and a routine
// flat one carried the same visual weight, and a variable nobody had read
// looked identical to one that had been read and was fine.
//
// Three rules, and they are about legibility rather than taste:
//
//   1. THE VERDICT SCALE IS SEQUENTIAL, NOT BINARY. Improving, flat and
//      deteriorating are three points on one axis, so they get one hue family
//      each at a consistent lightness — emerald, slate, rose — rather than
//      maximum-saturation green and red shouting over everything else.
//   2. ABSENCE IS NEVER COLOURED. Four absence states share one low-contrast
//      grey and are distinguished by their MARK (○ — n/a ?), because an
//      absence is not a finding and must not compete with one for attention.
//   3. SEVERITY GETS THE ONLY SATURATED COLOUR ON THE CARD. A broken thesis
//      is the single thing that should pull the eye across a fifty-row page.
//
// The HUE is fixed rather than themed: these carry meaning, and a theme that
// repainted "deteriorating" would repaint the meaning with it. The LIGHTNESS
// is not fixed — it tracks the background, because a colour nobody can read
// carries no meaning either. (zzz761)
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',

  // Verdict scale — one step of lightness apart, readable on dark and light.
  // ── THE HUE IS FIXED; THE LIGHTNESS IS NOT.                  (zzz761)
  //
  // These were literal 400-level hexes, and on the light theme emerald-400
  // sits at roughly 1.8:1 against white — the whole board read washed out.
  // The variables keep one hue per meaning and swap lightness with the
  // ground (globals.css), so "deteriorating" is the same rose on both
  // themes and legible on both. Fallbacks preserve the dark values.
  up: 'var(--mc-verdict-up, #34D399)',
  flat: 'var(--mc-verdict-flat, #94A3B8)',
  down: 'var(--mc-verdict-down, #FB7185)',
  absent: 'var(--mc-verdict-absent, #64748B)',

  // Reserved for severity and for the one call to action.
  alarm: 'var(--mc-verdict-alarm, #F43F5E)',
  warn: 'var(--mc-verdict-warn, #FBBF24)',
  cyan: 'var(--mc-cyan)',
  amber: 'var(--mc-verdict-warn, #FBBF24)',
  green: 'var(--mc-verdict-up, #34D399)',
  red: 'var(--mc-verdict-down, #FB7185)',
};

const VERDICT: Record<VarVerdict, { mark: string; color: string; word: string }> = {
  improving: { mark: '▲', color: C.up, word: 'improving' },
  flat: { mark: '–', color: C.flat, word: 'flat, and checked' },
  deteriorating: { mark: '▼', color: C.down, word: 'deteriorating' },
  // Disclosed, value shown, nothing to compare against. Neither an arrow
  // nor a hollow circle: the company said it, the ledger cannot yet judge
  // it. (zzz754)
  stated: { mark: '◐', color: C.flat, word: 'disclosed — a level only, no comparison basis' },
  unknown: { mark: '○', color: C.absent, word: 'no value' },
};

export interface ThesisCardProps {
  symbol: string;
  market: 'IN' | 'US';
  tier?: string | null;
  pattern?: AbfgResult | null;
  radarScore?: number | null;
  assessment: ThesisAssessment | null;
  capex?: CapexChain | null;
  /** Filing links. Never a price, never a chart. */
  sources?: Array<{ label: string; url: string }>;
  /** Every document actually read for this holding. Several, not one. */
  documentsRead?: Array<{ label: string; kind: string; source: string; period: string | null; url: string }>;
  /** Every retrieval attempt and what it answered — so an empty structural
   *  field can say which sources were searched rather than showing a bare
   *  circle with no reason. (zzz737) */
  discoveryAttempts?: Array<{ source: string; outcome: string; detail: string; found: number }>;
  discoveryState?: string | null;
  /** Per-document result of the read attempt: read / download_failed / scanned / too_short. */
  documentOutcomes?: Array<{ label: string; kind: string; outcome: string; chars: number; pages: number; detail?: string; url?: string }>;
  /** The AI summary has not been read for this holding yet. */
  needsRead?: boolean;
  reading?: boolean;
  onRead?: () => void;
  /** Discovery only — is there a newer document than the one on file? */
  onCheck?: () => void;
  /** Re-read the current period regardless (debug / manual refresh). */
  onReread?: () => void;
  error?: string | null;
  // ── THE PERSISTENT LEDGER.                                     (zzz740)
  ledger?: CompanyLedger | null;
  freshness?: { state: FreshnessState; detail: string } | null;
  reportingPeriod?: string | null;
  changed?: ChangeLine[];
  changedFrom?: string | null;
  persisted?: boolean | null;
  readNote?: string | null;
  /** Said plainly when the ledger has no earlier promise to check against. */
  promiseNote?: string | null;
  /** 'graded' | 'screener' | 'none' — where the grader-level numbers came
   *  from. A screener figure and a filing-read figure are not the same
   *  evidence and the card must never let them look the same. */
  dataSource?: string | null;
  /** Whether this name is held, a preset-passing bench candidate, or both.
   *  A bench card must never be mistaken for a holding, so this is rendered
   *  next to the ticker rather than buried in a tooltip. (zzz731) */
  origin?: BookOrigin;
  defaultOpen?: boolean;
}

function Section({ label, color, children }: { label: string; color?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        fontSize: 8.5, fontWeight: 800, letterSpacing: 0.5, color: color || C.faint,
        marginBottom: 4, borderBottom: `1px solid ${C.border}`, paddingBottom: 3,
      }}>{label}</div>
      {children}
    </div>
  );
}

export function ThesisCard(p: ThesisCardProps) {
  const [open, setOpen] = useState(!!p.defaultOpen);
  const a = p.assessment;
  const sm = a ? STATUS_META[a.status] : null;
  const pm = p.pattern ? ABFG_META[p.pattern.pattern] : null;

  // Only variables the evidence actually spoke to appear in WHAT CHANGED.
  // The undisclosed ones are not hidden — they are listed under the thesis as
  // unchecked, which is a different and more useful statement than a row of
  // dashes.
  const changed = (a?.checked || []).filter((c) => c.verdict !== 'unknown');
  const unchecked = (a?.checked || []).filter((c) => c.verdict === 'unknown');

  return (
    <div style={{
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 14px',
      borderLeft: `3px solid ${sm?.color || C.border}`,
    }}>
      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{p.symbol}</span>
        <span style={{ fontSize: 9.5, fontWeight: 800, color: C.faint }}>{p.market}</span>
        {p.origin && (
          <span title={p.origin === 'bench'
            ? 'On the conviction bench and passing the quality preset. NOT a holding — this is a candidate, and nothing here implies you own it.'
            : p.origin === 'both'
              ? 'Held, and also on the conviction bench.'
              : 'In your book.'}
            style={{
              fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${ORIGIN_META[p.origin].color}`,
              color: ORIGIN_META[p.origin].color,
            }}>{ORIGIN_META[p.origin].icon} {ORIGIN_META[p.origin].short}</span>
        )}
        {p.tier && (
          <span style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
            border: `1px solid ${C.border}`, color: C.dim }}>{p.tier}</span>
        )}
        {pm && p.pattern && (
          <span title={p.pattern.because} style={{
            fontSize: 9.5, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
            border: `1px solid ${pm.color}`, background: `${pm.color}18`, color: pm.color,
          }}>{pm.icon} {p.pattern.pattern} · {pm.name}</span>
        )}
        {p.radarScore != null && (
          <span style={{ fontSize: 9.5, fontWeight: 800, color: '#A78BFA' }}>🚀 T-{Math.round(p.radarScore)}</span>
        )}
        {p.dataSource === 'screener' && (
          <span title="These figures are screener.in's, not read from the filing by this portal's own engine. Wider coverage, one step further from the document."
            style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${C.faint}`, color: C.faint }}>screener.in data</span>
        )}
        {p.dataSource === 'none' && (
          <span title="This holding is in neither the graded bench nor the screener exports. Read the filing to populate it — nothing about it is being reported as clean."
            style={{ fontSize: 9, fontWeight: 800, padding: '1px 6px', borderRadius: 3,
              border: `1px solid ${C.amber}`, color: C.amber }}>no stored figures</span>
        )}

        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {sm && (
            <span title={sm.meaning} style={{
              fontSize: 10, fontWeight: 900, padding: '2px 9px', borderRadius: 3,
              border: `1px solid ${sm.color}`, background: `${sm.color}18`, color: sm.color,
            }}>{sm.dot} {sm.label}</span>
          )}
          {p.needsRead && !p.reading && (
            <button onClick={p.onRead} style={{
              fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
              border: `1px solid ${C.border}`, background: 'transparent', color: C.cyan, cursor: 'pointer',
            }}>✨ Read evidence</button>
          )}
          {p.reading && <span style={{ fontSize: 10.5, color: C.dim }}>Reading the latest document…</span>}
          {a && (
            <button onClick={() => setOpen((v) => !v)} style={{
              fontSize: 10, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
              border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer',
            }}>{open ? 'Less' : 'Evidence'}</button>
          )}
        </span>
      </div>

      {p.error && <div style={{ marginTop: 7, fontSize: 11, color: C.amber }}>{p.error}</div>}

      {/* ── EVIDENCE STATE — from the ledger, so it survives a reload. (zzz740)
          Period, documents read, when, and whether anything newer exists. */}
      {(p.ledger || p.freshness) && (() => {
        const l = p.ledger;
        const period = p.reportingPeriod || l?.latest_period || null;
        const pr = period && l ? l.periods[period] : null;
        const fr = p.freshness;
        const frColor = fr?.state === 'CURRENT' ? C.up : fr?.state === 'NEW_EVIDENCE_AVAILABLE' ? C.amber
          : fr?.state === 'SOURCE_UNAVAILABLE' ? C.alarm : fr?.state === 'STALE' ? C.amber : C.faint;
        const frLabel = fr?.state === 'CURRENT' ? 'CURRENT' : fr?.state === 'NEW_EVIDENCE_AVAILABLE' ? 'NEW EVIDENCE AVAILABLE'
          : fr?.state === 'SOURCE_UNAVAILABLE' ? 'SOURCE UNAVAILABLE' : fr?.state === 'STALE' ? 'STALE' : 'NEVER READ';
        return (
          <div style={{ marginTop: 7, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 10.5, color: C.dim }}>
            <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>EVIDENCE</span>
            {pr ? (
              <span title={`Reporting period ${pr.reporting_period}${pr.period_end_date ? ` (quarter ended ${pr.period_end_date})` : ''} · newest document ${pr.latest_document_date || 'undated'} · read ${pr.extracted_at.slice(0, 10)}${pr.updated_at !== pr.extracted_at ? ` · updated ${pr.updated_at.slice(0, 10)}` : ''}`}>
                <b style={{ color: C.text }}>{pr.reporting_period}</b> · {pr.documents_read} document{pr.documents_read === 1 ? '' : 's'} read
                {pr.documents_failed > 0 && <> · {pr.documents_failed} unavailable</>}
                {' '}· {pr.facts.length} facts · last updated {pr.updated_at.slice(0, 10)}
              </span>
            ) : <span>no persisted evidence</span>}
            {fr && (
              <span title={fr.detail} style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 3, border: `1px solid ${frColor}`, color: frColor }}>{frLabel}</span>
            )}
            {p.persisted === false && (
              <span style={{ fontSize: 9, fontWeight: 800, padding: '1px 7px', borderRadius: 3, border: `1px solid ${C.alarm}`, color: C.alarm }} title="The read succeeded but the write to the evidence store failed. This will not survive a reload.">NOT SAVED</span>
            )}
            {!p.reading && (
              <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {p.onCheck && pr && (
                  <button onClick={p.onCheck} title="Search the sources for a document newer than the one on file. No model call." style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer',
                  }}>↻ Check for new evidence</button>
                )}
                {p.onRead && pr && fr?.state === 'NEW_EVIDENCE_AVAILABLE' && (
                  <button onClick={p.onRead} title="Read the newer documents, add the new period to the ledger, keep the old one." style={{
                    fontSize: 10, fontWeight: 800, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer',
                  }}>✨ Read latest evidence</button>
                )}
                {p.onReread && pr && (
                  <button onClick={p.onReread} title="Re-run extraction on the current period's documents and update the persisted record. Debug / manual refresh; the normal path is incremental." style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.faint, cursor: 'pointer',
                  }}>↻ Re-read current period</button>
                )}
              </span>
            )}
            {p.readNote && <span style={{ width: '100%', color: p.persisted === false ? C.alarm : C.faint }}>{p.readNote}</span>}
          </div>
        );
      })()}

      {/* ── WHAT CHANGED — generated from persisted facts, never from a
          summary. Deteriorations first. (zzz740) */}
      {p.changed && p.changed.length > 0 && (
        <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg }}>
          <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginBottom: 3 }}>
            WHAT CHANGED{p.changedFrom ? ` · ${p.changedFrom} → ${p.reportingPeriod}` : p.reportingPeriod ? ` · ${p.reportingPeriod} (first read)` : ''}
          </div>
          {p.changed.map((c, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.55, color: C.dim }} title={`Source: ${c.source}`}>
              <span style={{ fontWeight: 900, color: c.sign === '+' ? C.up : c.sign === '-' ? C.down : C.faint }}>{c.sign}</span>{' '}
              <span style={{ color: c.sign === '·' ? C.dim : C.text }}>{c.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* The one-line verdict is always visible; the evidence expands. */}
      {a && (
        <div style={{ marginTop: 7, fontSize: 11.5, color: C.dim, lineHeight: 1.55 }}>
          <b style={{ color: sm?.color }}>{a.action}</b> — {a.because}
        </div>
      )}

      {/* ── THE VARIABLE BOARD, GROUPED, ALWAYS VISIBLE.         (zzz720)
          Revenue and margin tell you WHAT happened; capacity, utilisation,
          capex, orders and guidance tell you WHY and whether it continues.
          So the financial group is one row among several rather than the
          whole card, and a hollow ○ is a variable nobody looked at — never a
          variable that was checked and did not move. */}
      {a && (() => {
        const byGroup = new Map<VarGroup, typeof a.checked>();
        for (const c of a.checked) {
          const g = VAR_GROUP[c.key] || 'financial';
          if (!byGroup.has(g)) byGroup.set(g, [] as any);
          (byGroup.get(g) as any).push(c);
        }
        return (
          <div style={{ marginTop: 8 }}>
            {GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => {
              const items = byGroup.get(g)!;
              const read = items.filter((c) => c.verdict !== 'unknown').length;
              return (
                <div key={g} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                  <span style={{
                    fontSize: 8, fontWeight: 800, letterSpacing: 0.4, color: read ? C.dim : C.faint,
                    minWidth: 128, textAlign: 'right', paddingTop: 2,
                  }}>{GROUP_LABEL[g].split(' — ')[0]}</span>
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                    {items.map((c) => {
                      const v = VERDICT[c.verdict];
                      const un = c.verdict === 'unknown';
                      const ab = un ? (c.absence ? ABSENCE_MARK[c.absence] : ABSENCE_MARK.not_read) : null;
                      const isCore = c.weight >= 4;
                      // Absence is never coloured and never competes with a
                      // finding; a CORE absence is the one exception and gets
                      // a dotted outline rather than a colour, so it reads as
                      // "missing" rather than as "bad". (zzz723)
                      return (
                        <span key={c.key}
                          title={un
                            ? `${c.label} — ${ab!.label}. ${ab!.hint}${isCore ? '\n\nCORE to this thesis.' : ''}`
                            : `${c.label} — ${v.word}.\n\n${c.evidence}${isCore ? '\n\nCORE to this thesis.' : ''}`}
                          style={{
                            fontSize: 9.5, fontWeight: isCore ? 800 : 600,
                            padding: '1px 6px', borderRadius: 4,
                            border: un
                              ? `1px ${isCore ? 'dashed' : 'solid'} ${isCore ? C.absent : 'transparent'}`
                              : `1px solid color-mix(in srgb, ${v.color} 45%, transparent)`,
                            color: un ? C.absent : v.color,
                            background: un ? 'transparent' : `color-mix(in srgb, ${v.color} 12%, transparent)`,
                          }}>
                          <span style={{ opacity: un ? 0.85 : 1 }}>{un ? ab!.mark : v.mark}</span>
                          {' '}{c.label}
                          {/* ── BEFORE → NOW, NOT JUST THE DELTA.        (zzz761)
                              This row printed `delta || after`, so every
                              variable that HAD both sides showed only the
                              change: GOLDIAM's order book read "▲ Order book
                              +60.7%" while WHAT CHANGED, three inches below,
                              read "INR140 crores → INR225 crores (+60.7%)".
                              The before value was extracted, stored and then
                              discarded by the renderer — which is exactly the
                              "before and now not showing" the owner reported.
                              REDINGTON was the same bug wearing a different
                              hat: the chip showed the delta (−14%) and the
                              status sentence showed the level (32), so one
                              card stated two different numbers for one
                              variable. One field order, everywhere. */}
                          {!un && (c.before || c.after || c.delta) ? (
                            <>
                              {' '}
                              {c.before && c.after ? (
                                <>
                                  <span style={{ opacity: 0.75 }}>{c.before} → </span>
                                  <b>{c.after}</b>
                                  {c.delta ? <span style={{ opacity: 0.9 }}> · {c.delta}</span> : null}
                                </>
                              ) : (
                                <>
                                  {/* The LEVEL is the number; the delta is the
                                      qualifier. status.ts prints `after ||
                                      before` in its sentence, and the chip
                                      now prints the same field in the same
                                      order — one variable, one figure, on
                                      every line of the card. (zzz762) */}
                                  <b>{c.after || c.before || c.delta}</b>
                                  {(c.after || c.before) && c.delta && c.delta !== c.after
                                    ? <span style={{ opacity: 0.9 }}> · {c.delta}</span> : null}
                                </>
                              )}
                            </>
                          ) : ''}
                        </span>
                      );
                    })}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* ── THE EVIDENCE MATRIX.                                 (zzz727)
          "Core variables checked: 2/3" read as near-complete on a thesis that
          actually depends on nine things. Three counts cannot be misread as
          progress towards a finish line, and the denominator is now this
          ledger's own thesis-critical set rather than a generic model. */}
      {/* ── FINANCIAL WARNING, SEPARATE FROM THE STATUS.         (zzz738)
          EXICOM read "THESIS WEAKENING" on cash conversion 0.32× with no
          document read. The figure is real and belongs on the card in red.
          It does not, on its own, decide the status of a thesis whose
          mechanism nobody has examined. */}
      {a && a.financialWarning.length > 0 && (
        <div style={{ marginTop: 7, fontSize: 10.5, lineHeight: 1.55, padding: '6px 9px', borderRadius: 6,
          border: `1px solid ${C.down}`, background: `color-mix(in srgb, ${C.down} 10%, transparent)` }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.4, color: C.down }}>FINANCIAL WARNING </span>
          {a.financialWarning.map((w, i) => (
            <span key={i} style={{ color: C.text }}>{i > 0 ? ' · ' : ''}{w.label} <b style={{ color: C.down }}>{w.value}</b></span>
          ))}
          <span style={{ color: C.faint }}> — not thesis-critical for this pattern{p.needsRead ? ', and no document has been read' : ''}; shown, not counted.</span>
        </div>
      )}

      {/* ── THE EVIDENCE MATRIX, THREE POPULATIONS.              (zzz738)
          "4 confirmed · 1 pending" counted revenue, margin, earnings and
          cash conversion as confirmations while every mechanism variable
          was unread. Output confirms the quarter was good. Mechanism
          confirms WHY. Forward confirms what comes next. They are never
          added together again. */}
      {a && (
        <div style={{ marginTop: 7, fontSize: 10.5, color: C.dim, lineHeight: 1.7 }}>
          {([
            ['MECHANISM', a.coverage.mechanism, 'the WHY — capacity, utilisation, orders, capex, customers, one-offs, cash'],
            ['OUTPUT', a.coverage.output, 'the result — revenue, margin, earnings, leverage'],
            ['FORWARD', a.coverage.forward, 'what management commits to next'],
          ] as Array<[string, { confirmed: number; pending: number; contradicted: number; stated?: number; flat?: number; total: number }, string]>)
            .filter(([, t]) => t.total > 0)
            .map(([name, t, hint]) => (
              <div key={name} title={hint}>
                <span style={{ display: 'inline-block', minWidth: 78, fontSize: 8, fontWeight: 800, letterSpacing: 0.4,
                  color: name === 'MECHANISM' ? C.text : C.faint }}>{name}</span>
                <b style={{ color: t.confirmed ? C.up : C.flat }}>{t.confirmed} confirmed</b>
                {' · '}
                <b style={{ color: t.pending ? C.warn : C.flat }}>{t.pending} pending</b>
                {' · '}
                <b style={{ color: t.contradicted ? C.down : C.flat }}>{t.contradicted} contradicted</b>
                {(t.stated || 0) > 0 && <span style={{ color: C.flat }}> · {t.stated} stated</span>}
                {(t.flat || 0) > 0 && <span style={{ color: C.flat }}> · {t.flat} flat</span>}
                <span style={{ color: C.faint }}> · of {t.total}</span>
              </div>
            ))}
          {a.coverage.missingCore.length > 0 && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              Core still unreviewed: <span style={{ color: C.text }}>{a.coverage.missingCore.join(', ')}</span>
            </div>
          )}
          {a.coverage.levelOnlyCore.length > 0 && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              Level only, no comparison basis: <span style={{ color: C.text }}>{a.coverage.levelOnlyCore.join(', ')}</span>
            </div>
          )}
          {a.coverage.missingNeedsFiling.length > 0 && p.needsRead && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              {a.coverage.missingNeedsFiling.length} of the pending variables exist only in a filing, concall or
              exchange announcement — no amount of screener data will fill them.
            </div>
          )}
        </div>
      )}

      {a && open && (
        <>
          {/* ── WHAT CHANGED — facts only. ─────────────────────────────── */}
          <Section label={`WHAT CHANGED · ${changed.length} variable${changed.length === 1 ? '' : 's'} read from the evidence`}>
            {changed.length === 0 && (
              <div style={{ fontSize: 11, color: C.dim }}>
                Nothing structural was disclosed. That is silence, not bad news.
              </div>
            )}
            {changed.map((c) => {
              const v = VERDICT[c.verdict];
              return (
                <div key={c.key} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                  <span style={{ color: v.color, fontSize: 11, fontWeight: 900, width: 12 }}>{v.mark}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: C.text, minWidth: 132 }}>{c.label}</span>
                  <span style={{ fontSize: 11, color: C.text, minWidth: 150 }}>
                    {c.before && <span style={{ color: C.faint }}>{c.before} → </span>}
                    <b>{c.after || c.delta || '—'}</b>
                    {c.before && c.delta && <span style={{ color: v.color }}> ({c.delta})</span>}
                    {/* ── THE COMPARISON BASIS TRAVELS WITH THE NUMBER. (zzz758)
                        "+8pp" means something different sequentially than it
                        does year on year, and a reader who cannot see which
                        one it is has been handed a figure, not a fact. */}
                    {c.comparison && c.comparison.basis !== 'NONE' && c.comparison.previous && (
                      <span style={{ display: 'block', fontSize: 9, color: C.faint }}>
                        {c.comparison.previous_period
                          ? `${c.comparison.previous_period} → ${c.comparison.current_period} · ${BASIS_LABEL[c.comparison.basis]}`
                          : BASIS_LABEL[c.comparison.basis]}
                      </span>
                    )}
                    {c.comparison && !c.comparison.previous && c.comparison.current && (
                      <span style={{ display: 'block', fontSize: 9, color: C.faint }}>previous: NOT DISCLOSED</span>
                    )}
                    {/* ── TWO DOCUMENTS, TWO NUMBERS. (zzz759) The written
                        source supplies the value; the disagreement is shown
                        rather than resolved out of sight. */}
                    {c.conflict && c.conflict.length > 0 && (
                      <span style={{ display: 'block', fontSize: 9, fontWeight: 800, color: C.warn }}
                        title={c.conflict.map((x) => `${x.value} — ${x.source}`).join('\n')}>
                        ⚠ sources disagree: {c.conflict.map((x) => x.value).join(' / ')}
                      </span>
                    )}
                  </span>
                  <span style={{ fontSize: 10.5, color: C.dim, flex: 1 }}>
                    {/* CAUSE AND WHETHER IT REPEATS — the two questions a
                        number cannot answer about itself. Extracted from the
                        sentence, never inferred: "not disclosed" is printed
                        wherever the document gave no reason. */}
                    {c.comparison?.cause && (
                      <span style={{
                        display: 'inline-block', marginRight: 6, padding: '0 4px', borderRadius: 3,
                        fontSize: 8.5, fontWeight: 800, letterSpacing: 0.3,
                        color: c.comparison.cause.persistence === 'STRUCTURAL' ? C.up
                          : c.comparison.cause.persistence === 'TEMPORARY' ? C.warn : C.faint,
                        border: `1px solid ${C.border}`,
                      }} title={c.comparison.cause.persistence_because}>
                        {c.comparison.cause.persistence}
                      </span>
                    )}
                    {c.comparison && (c.comparison.change_type === 'INCREASED' || c.comparison.change_type === 'DECREASED') && !c.comparison.cause && (
                      <span style={{ color: C.warn }}>CAUSE NOT DISCLOSED · </span>
                    )}
                    {c.evidence}
                  </span>
                  <span style={{ fontSize: 8.5, fontWeight: 800, color: C.faint }}>W{c.weight}</span>
                </div>
              );
            })}
          </Section>

          {/* ══ CHANGE DETECTION — the longitudinal block. ══════ (zzz758)
              Everything above reads ONE filing. This reads the ledger: what
              each figure was the last time it was disclosed, what it is now,
              on what basis the two are being compared, the reason the company
              gave, and whether that reason repeats. Where the ledger holds
              only one period, it says so rather than implying the company
              withheld a comparison it was never asked for. */}
          <Section label={`CHANGE vs PREVIOUS DISCLOSURE · ${a.historyDepth} reporting period${a.historyDepth === 1 ? '' : 's'} on file`}>
            {a.historyDepth <= 1 && (
              <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.55 }}>
                This is the first period read for this holding, so every figure below is a first observation and
                <b style={{ color: C.text }}> no previous value exists to compare against</b>. Nothing is inferred to fill
                that gap. The next read turns these levels into directions.
              </div>
            )}
            {a.historyDepth > 1 && a.changes.length === 0 && (
              <div style={{ fontSize: 11, color: C.dim }}>
                Earlier periods are on file and nothing comparable moved between them.
              </div>
            )}
            {a.changes.map((m) => {
              const tone = m.change_type === 'DECREASED' || m.change_type === 'NOT_DISCLOSED' ? C.down
                : m.change_type === 'INCREASED' ? C.up : C.flat;
              return (
                <div key={m.key} style={{ padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 8.5, fontWeight: 800, color: tone, letterSpacing: 0.3, minWidth: 96 }}>
                      {m.change_type.replace(/_/g, ' ')}
                    </span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: C.text, minWidth: 132 }}>{m.label}</span>
                    <span style={{ fontSize: 11, color: C.dim, flex: 1 }}>
                      <span style={{ color: C.faint }}>{m.previous ? `${m.previous.raw}${m.previous_period ? ` (${m.previous_period})` : ''} → ` : 'previous: NOT DISCLOSED · '}</span>
                      <b style={{ color: C.text }}>{m.current ? m.current.raw : 'not disclosed'}</b>
                      {m.change && <span style={{ color: tone, fontWeight: 800 }}> {m.change}</span>}
                      {m.change_relative && <span style={{ color: C.faint }}> ({m.change_relative})</span>}
                      <span style={{ color: C.faint }}> · {BASIS_LABEL[m.basis]}</span>
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: C.dim, paddingLeft: 104, lineHeight: 1.5 }}>
                    {m.cause
                      ? <>
                        <b style={{ color: m.cause.persistence === 'STRUCTURAL' ? C.up : m.cause.persistence === 'TEMPORARY' ? C.warn : C.faint }}>
                          {m.cause.persistence}
                        </b>
                        {' — stated cause: '}{m.cause.text}
                        <span style={{ color: C.faint }}> ({m.cause.persistence_because} Read from “{m.cause.connective}” in {m.source}.)</span>
                      </>
                      : (m.change_type === 'INCREASED' || m.change_type === 'DECREASED')
                        ? <span style={{ color: C.warn }}>CAUSE NOT DISCLOSED — the document states the change and gives no reason for it, so whether it repeats is unknown.</span>
                        : <span style={{ color: C.faint }}>{m.line}</span>}
                    {m.promised && (
                      <div style={{ color: C.faint }}>
                        Management said in {m.promised.period}: {m.promised.kind.toLowerCase()} {m.promised.value} — this is the actual it will be graded against.
                      </div>
                    )}
                    {m.forward && (
                      <div style={{ color: C.faint }}>
                        Forward: {m.forward.kind.toLowerCase()} {m.forward.value} — a claim about the future, not a reported figure.
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {a.changes.length > 0 && (
              <div style={{ fontSize: 10, color: C.faint, marginTop: 5 }}>
                Causes: {a.causeSummary.structural} structural · {a.causeSummary.temporary} temporary ·{' '}
                {a.causeSummary.unclassified} stated but unclassified · {a.causeSummary.none} moves with no reason given.
              </div>
            )}
            {a.statusChangeReason && (
              <div style={{ fontSize: 10.5, color: C.text, marginTop: 5, fontWeight: 700 }}>
                STATUS CHANGED — {a.statusChangeReason}
              </div>
            )}
          </Section>

          {/* ── STRUCTURAL SIGNAL — the mechanism, as a chain. ─────────── */}
          <Section label="STRUCTURAL SIGNAL — the mechanism this thesis depends on">
            <div style={{ fontSize: 11.5, color: C.text, display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {a.thesis.mechanism.map((m, i) => (
                <span key={i}>
                  <span style={{ color: C.text }}>{m}</span>
                  {i < a.thesis.mechanism.length - 1 && <span style={{ color: C.faint }}> → </span>}
                </span>
              ))}
            </div>
            {a.mechanismCheck.map((m) => {
              const col = m.state === 'confirmed' ? C.green : m.state === 'contradicted' ? C.red : C.faint;
              const mark = m.state === 'confirmed' ? '✓' : m.state === 'contradicted' ? '✕' : '○';
              return (
                <div key={m.link} style={{ fontSize: 11, color: C.dim, padding: '1px 0' }}>
                  <span style={{ color: col, fontWeight: 900, marginRight: 6 }}>{mark}</span>{m.link}
                  <span style={{ color: C.faint, fontSize: 10 }}> · {m.state}</span>
                </div>
              );
            })}
            <div style={{ marginTop: 5, fontSize: 11, fontWeight: 800,
              color: a.mechanismVerdict.includes('CONTRADICTED') ? C.red
                : a.mechanismVerdict.includes('NOT YET') ? C.amber : C.green }}>
              → {a.mechanismVerdict}
            </div>
          </Section>

          {/* ── CAPEX CHAIN ───────────────────────────────────────────── */}
          {p.capex && p.capex.state !== 'none' && (() => {
            const m = CAPEX_META[p.capex!.state];
            return (
              <Section label="CAPEX — DID THE MONEY EARN?" color={m.color}>
                <div style={{ fontSize: 10.5, fontWeight: 900, color: m.color, marginBottom: 4 }}>
                  {m.dot} {m.label}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 5 }}>
                  {p.capex!.links.map((l, i) => (
                    <span key={i} style={{
                      fontSize: 9.5, padding: '1px 6px', borderRadius: 3,
                      border: `1px solid ${l.known ? C.border : 'transparent'}`,
                      background: l.known ? C.bg2 : 'transparent',
                      color: l.known ? C.text : C.faint,
                      textDecoration: l.known ? 'none' : 'line-through',
                    }}>{l.name}{l.value ? ` ${l.value}` : ''}</span>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>{p.capex!.because}</div>
                {p.capex!.nextCheck && (
                  <div style={{ fontSize: 10.5, color: C.amber, marginTop: 3 }}>→ {p.capex!.nextCheck}</div>
                )}
              </Section>
            );
          })()}

          {/* ── FROM HERE DOWN IS INFERENCE, AND SAYS SO. ─────────────── */}
          <Section label="THESIS — interpretation, not fact" color={sm?.color}>
            <div style={{ fontSize: 11, color: C.dim, lineHeight: 1.55 }}>
              Bought as <b style={{ color: C.text }}>{a.thesis.name}</b>. {sm?.meaning}
            </div>
            <div style={{ fontSize: 10, color: C.faint, marginTop: 3 }}>
              {a.coverage.coreDisclosed} of {a.coverage.corePossible} core variables were disclosed
              · {a.coverage.disclosed} of {a.coverage.checked} in total.
              {a.coverage.coreDisclosed < a.coverage.corePossible
                && ' An undisclosed variable is never counted against the thesis.'}
            </div>
            {p.promiseNote && (
              <div style={{ fontSize: 10.5, color: C.dim, marginTop: 4 }}>📓 {p.promiseNote}</div>
            )}
          </Section>

          {a.nextConfirmation.length > 0 && (
            <Section label="NEXT THING TO WATCH">
              {a.nextConfirmation.map((t, i) => (
                <div key={i} style={{ fontSize: 11, color: C.dim, lineHeight: 1.5 }}>· {t}</div>
              ))}
            </Section>
          )}

          {/* ── THE DYNAMIC INVALIDATION LIST. ────────────────────────── */}
          <Section label="WHAT WOULD END THIS — ranked by how much of the thesis it carries" color={C.amber}>
            {a.invalidationConditions.map((ic, i) => {
              const col = ic.status === 'fired' ? C.red
                : ic.status === 'watch' ? C.amber
                  : ic.status === 'unknown' ? C.faint : C.green;
              const mark = ic.status === 'fired' ? '✕ FIRED'
                : ic.status === 'watch' ? '⚠ watch'
                  : ic.status === 'unknown' ? '· not checked' : '✓ ok';
              return (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '2px 0' }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: col, minWidth: 74 }}>{mark}</span>
                  <span style={{ fontSize: 8.5, fontWeight: 800, color: C.faint, minWidth: 18 }}>W{ic.weight}</span>
                  <span style={{ fontSize: 11, color: ic.status === 'fired' ? C.text : C.dim, lineHeight: 1.5 }}>
                    {ic.condition}
                  </span>
                </div>
              );
            })}
            <div style={{ fontSize: 10, color: C.faint, marginTop: 5, lineHeight: 1.5 }}>
              No price is on this list, and none ever will be. A drawdown, a weak market and one flat quarter are
              not on it either.
            </div>
          </Section>

          {unchecked.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 10, color: C.faint, lineHeight: 1.5 }}>
              Not disclosed this quarter, so not counted either way: {unchecked.map((c) => c.label.toLowerCase()).join(', ')}.
            </div>
          )}

          {/* ── WHAT WAS READ, AND WHAT WAS TRIED.                  (zzz737)
              An unexplained circle is the thing this block exists to end:
              "searched and not disclosed" and "could not be reached" look
              identical on a card until the trail is shown. */}
          {p.documentsRead && p.documentsRead.length > 0 && (
            <div style={{ marginTop: 9, fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
              <span style={{ fontWeight: 800, color: C.faint, letterSpacing: .4 }}>
                READ {p.documentsRead.length} DOCUMENT{p.documentsRead.length > 1 ? 'S' : ''}
              </span>{' '}
              {p.documentsRead.map((d, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  <a href={d.url} target="_blank" rel="noreferrer" style={{ color: C.cyan, textDecoration: 'none' }}>
                    ↗ {d.label}
                  </a>
                  {d.period ? <span style={{ color: C.faint }}> ({d.period})</span> : null}
                </span>
              ))}
            </div>
          )}

          {p.discoveryAttempts && p.discoveryAttempts.length > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 10, color: C.faint, cursor: 'pointer' }}>
                Evidence search — {p.discoveryAttempts.filter((a) => a.outcome !== 'error').length} of{' '}
                {p.discoveryAttempts.length} source(s) answered
                {p.discoveryState === 'RETRIEVAL_FAILED' ? ' · RETRIEVAL FAILED — a source could not be reached, so nothing here is an absence of disclosure'
                  : p.discoveryState === 'SEARCH_EXHAUSTED' ? ' · SEARCHED, NO EVIDENCE — every source answered'
                    : ''}
              </summary>
              <div style={{ marginTop: 5, fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
                {p.discoveryAttempts.map((a, i) => (
                  <div key={i}>
                    <span style={{ color: a.outcome === 'found' ? C.up : a.outcome === 'error' ? C.alarm : C.faint }}>
                      {a.outcome === 'found' ? '✓' : a.outcome === 'error' ? '✕' : '—'}
                    </span>{' '}
                    <b style={{ color: C.text }}>{a.source}</b> — {a.detail}
                  </div>
                ))}
                {p.documentOutcomes && p.documentOutcomes.length > 0 && (
                  <div style={{ marginTop: 4 }}>
                    {p.documentOutcomes.map((d, i) => {
                      const ok = d.outcome === 'read';
                      const why = ok ? `read · ${d.chars.toLocaleString()} chars${d.pages ? ` · ${d.pages} pp` : ''}`
                        : d.outcome === 'download_failed' ? `did not download${d.detail ? ` (${d.detail})` : ''}`
                          : d.outcome === 'scanned' ? `scanned image · ${d.pages} pp, no text layer — not OCR'd`
                            : d.outcome === 'too_short' ? `too short to be a filing (${d.chars} chars)`
                              : d.outcome === 'budget_exhausted' ? 'not read — reading budget spent on earlier documents'
                                : d.outcome;
                      // ── AN UNREADABLE DOCUMENT IS NOT A DEAD END.  (zzz760)
                      //
                      // A scanned filing has no text layer and this reader does
                      // not OCR, so the engine can never extract from it. That is
                      // an honest limit — but naming the document and then
                      // withholding it leaves the owner with nothing to do. The
                      // url is already on the record; the label becomes a link,
                      // so "this reader cannot read it" turns into "here it is,
                      // read it yourself" in one click.
                      const name = d.url
                        ? <a href={d.url} target="_blank" rel="noreferrer" style={{ color: ok ? C.text : C.cyan, textDecoration: 'none' }}>↗ {d.label}</a>
                        : <span style={{ color: C.text }}>{d.label}</span>;
                      return (
                        <div key={i}>
                          <span style={{ color: ok ? C.up : d.outcome === 'download_failed' || d.outcome === 'scanned' ? C.alarm : C.faint }}>
                            {ok ? '✓' : '✕'}
                          </span>{' '}
                          {name} <span style={{ color: C.faint }}>({d.kind})</span> — {why}
                          {d.outcome === 'scanned' && d.url && (
                            <span style={{ color: C.faint }}> · nothing here can be extracted from it; open it to read it yourself</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </details>
          )}

          {p.ledger && (Object.keys(p.ledger.periods).length > 0 || p.ledger.status_history.length > 0) && (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 10, color: C.faint, cursor: 'pointer' }}>
                Evidence history — {Object.keys(p.ledger.periods).length} period{Object.keys(p.ledger.periods).length === 1 ? '' : 's'} on file
                {p.ledger.status_history.length > 0 ? ` · ${p.ledger.status_history.length} status change${p.ledger.status_history.length === 1 ? '' : 's'}` : ''}
              </summary>
              <div style={{ marginTop: 5, fontSize: 10, color: C.dim, lineHeight: 1.6 }}>
                {Object.values(p.ledger.periods).sort((x, y) => x.reporting_period.localeCompare(y.reporting_period)).map((pr) => (
                  <div key={pr.reporting_period}>
                    <b style={{ color: C.text }}>{pr.reporting_period}</b> · {pr.documents_read} read · {pr.facts.length} facts · {pr.events.length} events
                    {pr.status ? <> · <span style={{ color: C.text }}>{pr.status.replace(/_/g, ' ')}</span></> : ''}
                    {' '}· read {pr.extracted_at.slice(0, 10)}{pr.updated_at !== pr.extracted_at ? `, updated ${pr.updated_at.slice(0, 10)}` : ''}
                    <div style={{ color: C.faint, paddingLeft: 10 }}>
                      {pr.events.slice(0, 8).map((e, i) => (
                        <div key={i} title={e.evidence_text}>{e.variable.replace(/_/g, ' ')} · {e.value_type.toLowerCase().replace('_', ' ')}{e.before ? ` ${e.before} →` : ''} {e.after || ''}{e.unit && !/%/.test(String(e.after || '')) ? ` ${e.unit}` : ''}{e.period ? ` (${e.period})` : ''} — {e.source}</div>
                      ))}
                      {pr.events.length > 8 && <div>… {pr.events.length - 8} more events</div>}
                    </div>
                  </div>
                ))}
                {p.ledger.status_history.map((h, i) => (
                  <div key={`h${i}`}>{h.at.slice(0, 10)} · {h.reporting_period} · <span style={{ color: C.text }}>{h.status.replace(/_/g, ' ')}</span>{h.because ? ` — ${h.because.slice(0, 140)}` : ''}</div>
                ))}
                {p.ledger.last_attempt && p.ledger.last_attempt.outcome !== 'COMPLETED' && (
                  <div style={{ color: p.ledger.last_attempt.outcome === 'SOURCE_UNAVAILABLE' ? C.alarm : C.faint }}>
                    last attempt {p.ledger.last_attempt.at.slice(0, 16).replace('T', ' ')} · {p.ledger.last_attempt.outcome.replace(/_/g, ' ')}{p.ledger.last_attempt.error ? ` — ${p.ledger.last_attempt.error.slice(0, 160)}` : ''}
                  </div>
                )}
              </div>
            </details>
          )}

          {p.sources && p.sources.length > 0 && !p.documentsRead?.length && (
            <div style={{ marginTop: 8, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {p.sources.map((s, i) => (
                <a key={i} href={s.url} target="_blank" rel="noreferrer"
                  style={{ fontSize: 10.5, color: C.cyan, textDecoration: 'none' }}>↗ {s.label}</a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
