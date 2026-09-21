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
import { CAPEX_META, type CapexChain } from '@/lib/thesis/capex-chain';
import type { VarVerdict } from '@/lib/thesis/variables';
import { ABFG_META, type AbfgResult } from '@/lib/earnings/pattern-abfg';

const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#F59E0B', cyan: 'var(--mc-cyan)',
};

const VERDICT: Record<VarVerdict, { mark: string; color: string; word: string }> = {
  improving: { mark: '✓', color: C.green, word: 'improving' },
  flat: { mark: '→', color: C.faint, word: 'flat' },
  deteriorating: { mark: '✕', color: C.red, word: 'deteriorating' },
  unknown: { mark: '·', color: C.faint, word: 'not disclosed' },
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
            }}>✨ Read the filing</button>
          )}
          {p.reading && <span style={{ fontSize: 10.5, color: C.dim }}>Reading the filing…</span>}
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
            <div style={{ fontSize: 11.5, color: C.text, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {a.thesis.mechanism.map((m, i) => (
                <span key={i}>
                  <span style={{ color: C.text }}>{m}</span>
                  {i < a.thesis.mechanism.length - 1 && <span style={{ color: C.faint }}> → </span>}
                </span>
              ))}
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

          {p.sources && p.sources.length > 0 && (
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
