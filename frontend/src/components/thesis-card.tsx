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
// Every value is fixed rather than themed: these carry meaning, and a theme
// that repainted "deteriorating" would repaint the meaning with it.
const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',

  // Verdict scale — one step of lightness apart, readable on dark and light.
  up: '#34D399',        // emerald 400
  flat: '#94A3B8',      // slate 400
  down: '#FB7185',      // rose 400 — a warning, not an alarm
  absent: '#64748B',    // slate 500, deliberately quiet

  // Reserved for severity and for the one call to action.
  alarm: '#F43F5E',     // rose 500 — thesis broken only
  warn: '#FBBF24',      // amber 400 — confirmation required
  cyan: 'var(--mc-cyan)',
  amber: '#FBBF24',
  green: '#34D399',
  red: '#FB7185',
};

const VERDICT: Record<VarVerdict, { mark: string; color: string; word: string }> = {
  improving: { mark: '▲', color: C.up, word: 'improving' },
  flat: { mark: '–', color: C.flat, word: 'flat, and checked' },
  deteriorating: { mark: '▼', color: C.down, word: 'deteriorating' },
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
  /** The AI summary has not been read for this holding yet. */
  needsRead?: boolean;
  reading?: boolean;
  onRead?: () => void;
  error?: string | null;
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
                              : `1px solid ${v.color}55`,
                            color: un ? C.absent : v.color,
                            background: un ? 'transparent' : `${v.color}1A`,
                          }}>
                          <span style={{ opacity: un ? 0.85 : 1 }}>{un ? ab!.mark : v.mark}</span>
                          {' '}{c.label}
                          {!un && (c.delta || c.after) ? ` ${c.delta || c.after}` : ''}
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
      {a && (
        <div style={{ marginTop: 7, fontSize: 10.5, color: C.dim, lineHeight: 1.55 }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>THESIS EVIDENCE </span>
          <b style={{ color: C.up }}>{a.coverage.criticalConfirmed} confirmed</b>
          {' · '}
          <b style={{ color: a.coverage.criticalPending ? C.warn : C.flat }}>{a.coverage.criticalPending} pending</b>
          {' · '}
          <b style={{ color: a.coverage.criticalContradicted ? C.down : C.flat }}>
            {a.coverage.criticalContradicted} contradicted
          </b>
          <span style={{ color: C.faint }}> · of {a.coverage.criticalTotal} thesis-critical variables</span>
          {a.coverage.missingCore.length > 0 && (
            <div style={{ color: C.faint, marginTop: 2 }}>
              Core still unreviewed: <span style={{ color: C.text }}>{a.coverage.missingCore.join(', ')}</span>
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
                  </span>
                  <span style={{ fontSize: 10.5, color: C.dim, flex: 1 }}>{c.evidence}</span>
                  <span style={{ fontSize: 8.5, fontWeight: 800, color: C.faint }}>W{c.weight}</span>
                </div>
              );
            })}
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
                Evidence search — {p.discoveryAttempts.filter((a) => a.outcome === 'found').length} of{' '}
                {p.discoveryAttempts.length} source(s) answered
                {p.discoveryState === 'RETRIEVAL_FAILED' ? ' · a source could not be reached, so nothing here is an absence of disclosure' : ''}
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
