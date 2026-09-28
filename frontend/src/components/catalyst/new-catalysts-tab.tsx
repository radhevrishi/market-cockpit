'use client';

// ═══════════════════════════════════════════════════════════════════════════
// "New · last 10 days" — the tab both Portfolio Catalysts pages share.
//                                              (zzz808 → zzz813 → zzz824)
//
// zzz824 redesign: EVENT → EVIDENCE → THESIS → MATERIALITY → ACTION.
// Page order: a compact header, one command bar (book · materiality · event
// type · thesis · impact · days), WHAT CHANGED (three counts and the few
// decision-relevant events), NEEDS ATTENTION, EVIDENCE GAPS, the MATERIAL
// thesis-event cards, then Notable; Minor and routine paperwork collapsed to
// one line each. Every card field (event, evidence, thesis, impact, why,
// evidence quality, evidence delta, evidence chain, next evidence) is computed
// separately and deterministically in lib/catalyst/event-card — this file only
// draws it. "Open thesis ledger" opens a side panel from the card's own ledger.
// No price, no model, no scores.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import {
  EVENT_TYPES, daysAgo, windowRange, dayLabel, inRange, rowAnchor, compareWithinDay, WINDOW_SPANS, normUrl,
  type RecentCatalystResult, type TypeFilter, type RecentEvent, type WindowSpan,
} from '@/lib/catalyst/recent-events';
import { IMPACTS, ledgerView, type Impact, type EvidenceQuality } from '@/lib/catalyst/event-card';
import { STATUS_META } from '@/lib/thesis/status';
import type { ReadProgress } from './use-filing-reads';

const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)',
  green: 'var(--mc-verdict-up, #34D399)', red: 'var(--mc-verdict-down, #F87171)', alarm: 'var(--mc-verdict-alarm, #F43F5E)',
  absent: 'var(--mc-verdict-absent, #94A3B8)', cyan: 'var(--tc-accent, #22D3EE)',
};

const IMPACT_COLOR: Record<Impact, string> = { Supports: C.green, Neutral: C.dim, Weakens: C.red, Broken: C.alarm, 'Evidence incomplete': C.absent };
const QUALITY_COLOR: Record<EvidenceQuality, string> = { Direct: C.green, Static: C.dim, Indirect: C.dim, Unproven: C.amber, Conflicting: C.amber };
const MAT_RANK: Record<string, number> = { Material: 0, Notable: 1, Minor: 2, Routine: 3 };
const VERDICT_WORD: Record<string, string> = { improving: 'improving', deteriorating: 'getting worse', flat: 'no material change', stated: 'level only', unknown: 'not disclosed' };

type Holding = 'book' | 'bench' | null;
type BookF = 'all' | 'book' | 'bench';
type MatF = 'All' | 'Material' | 'Notable' | 'Minor';
type ThesisF = 'All' | 'A' | 'B' | 'F' | 'G' | 'none';
type ImpactF = 'All' | Impact;

export interface NewCatalystsTabProps {
  result: RecentCatalystResult | null;
  loading: boolean;
  names: number;
  sourceNotes: string[];
  market: 'IN' | 'US';
  progress?: ReadProgress | null;
  onJump?: (ticker: string) => void;
  /** zzz814: the selected days — controlled by the page so the tab label counts the same window. */
  win?: { span: WindowSpan; anchor: string | null };
  onWin?: (w: { span: WindowSpan; anchor: string | null }) => void;
  /** zzz824: which population a ticker is in — your book or the Conviction Beats bench. Omit to hide the book filter. */
  holdingOf?: (ticker: string) => Holding;
  /** zzz825 (§34): known-Minor documents are read only on demand — the page queues these URLs when asked. */
  onRead?: (urls: string[]) => void;
  /** zzz825: URLs (normUrl) the owner has already asked to read. */
  wanted?: ReadonlySet<string>;
}

const SPAN_LABEL: Record<number, string> = { 1: 'Today', 3: '3d', 5: '5d', 10: '10d' };
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const when = (date: string, today: string) => { const k = daysAgo(date, today); return k <= 0 ? 'today' : k === 1 ? 'yesterday' : `${k}d ago`; };
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);

// ── small pieces ──────────────────────────────────────────────────────────

function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button onClick={onClick} aria-pressed={on} title={title} style={{
      fontSize: 12.5, fontWeight: 800, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap', flex: '0 0 auto',
      border: `1px solid ${on ? C.cyan : C.border}`, color: on ? C.cyan : C.dim, background: C.bg,
    }}>{children}</button>
  );
}

/** One horizontally scrolling filter group — never wraps into a wall on a phone. */
function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', alignItems: 'center', gap: 5, overflowX: 'auto', flexWrap: 'nowrap', maxWidth: '100%', paddingBottom: 2, WebkitOverflowScrolling: 'touch' } as CSSProperties}>
      <span style={{ fontSize: 11, fontWeight: 900, color: C.faint, letterSpacing: 0.5, textTransform: 'uppercase', flex: '0 0 auto', minWidth: 64 }}>{label}</span>
      {children}
    </div>
  );
}

function HoldingBadge({ h }: { h: Holding }) {
  if (!h) return null;
  const book = h === 'book';
  return (
    <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 0.4, padding: '1px 7px', borderRadius: 999, whiteSpace: 'nowrap',
      border: `1px solid ${book ? C.green : C.amber}`, color: book ? C.green : C.amber }}>
      {book ? 'MY BOOK' : 'CONVICTION BEATS'}
    </span>
  );
}

function ImpactBadge({ i }: { i: Impact }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 900, padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap', border: `1px solid ${IMPACT_COLOR[i]}`, color: IMPACT_COLOR[i] }}>
      {i.toUpperCase()}
    </span>
  );
}

function Chain({ e }: { e: RecentEvent }) {
  const ch = e.card?.chain;
  if (!ch) return <span style={{ color: C.faint }}>no chain for this event type</span>;
  return (
    <div style={{ overflowX: 'auto', whiteSpace: 'nowrap', WebkitOverflowScrolling: 'touch', fontSize: 12.5, fontWeight: 800 } as CSSProperties}>
      {ch.map((l, i) => (
        <span key={l.label}>
          {i > 0 && <span style={{ color: C.faint, fontWeight: 500 }}> → </span>}
          <span style={{ color: l.ok ? C.green : C.faint }}>{l.label} {l.ok ? '✓' : '?'}</span>
        </span>
      ))}
    </div>
  );
}

// ── the card — compact, six lines ─────────────────────────────────────────

/** "order disclosed", "allotment disclosed" … only restate the event type — the row is dropped. */
const RESTATES = /^[a-z /]+ disclosed$/i;

function MatChip({ m }: { m: string }) {
  const strong = m === 'Material';
  return (
    <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.5, padding: '0 6px', borderRadius: 4, whiteSpace: 'nowrap',
      border: `1px solid ${strong ? C.text : C.border}`, color: strong ? C.text : C.faint }}>{m.toUpperCase()}</span>
  );
}
const K = ({ children }: { children: ReactNode }) => <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.5, color: C.faint, marginRight: 4 }}>{children}</span>;
const ROW: CSSProperties = { fontSize: 12.5, color: C.dim, lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };

function EventCardView({ e, holding, today, market, onJump, onLedger }: { e: RecentEvent; holding: Holding; today: string; market: 'IN' | 'US'; onJump?: (t: string) => void; onLedger: (e: RecentEvent) => void }) {
  const [open, setOpen] = useState(false);
  const c = e.card!;
  const material = c.materiality === 'Material';
  const border = c.attention ? C.amber : material ? C.dim : C.border;
  const ex = e.exchange || (market === 'US' ? 'SEC' : null);
  const nsePage = market === 'IN' ? `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(e.ticker.replace(/-(BE|SM|ST|BZ|E1)$/i, ''))}` : null;
  const showEvidence = !RESTATES.test(c.evidence);
  return (
    <article id={rowAnchor(e)} data-testid="nc-card" style={{ border: `${material || c.attention ? 1.5 : 1}px solid ${border}`, borderRadius: 6, background: C.bg, padding: '6px 10px', scrollMarginTop: 80, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
      {/* 1 · materiality · TICKER · population · type · date · key number · impact */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5 }}>
        <MatChip m={c.materiality} />
        {onJump
          ? <a href="#" onClick={(ev) => { ev.preventDefault(); onJump(e.ticker); }} title={e.company || undefined} style={{ fontSize: 14, fontWeight: 900, color: C.text, textDecoration: 'none' }}>{e.ticker}</a>
          : <b title={e.company || undefined} style={{ fontSize: 14, color: C.text }}>{e.ticker}</b>}
        {e.company && <span data-testid="nc-company" title={e.company} style={{ color: C.faint, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.company}</span>}
        <HoldingBadge h={holding} />
        <b style={{ color: C.dim }}>{c.eventType}</b>
        <span style={{ color: C.faint }}>· {dayLabel(e.date)} ({when(e.date, today)})</span>
        {c.keyNumber && <span style={{ color: C.text, fontWeight: 900 }}>· {c.keyNumber}</span>}
        {c.attention && <span style={{ color: C.amber, fontWeight: 800 }}>· ⚠ {c.attention}</span>}
        <span style={{ marginLeft: 'auto' }}><ImpactBadge i={c.impact} /></span>
      </div>
      {/* 2 · the event, one line */}
      <div style={{ ...ROW, color: C.text, fontWeight: material ? 700 : 500 }} title={c.event}>
        {c.event}{e.read === 'pending' && <span style={{ color: C.cyan, fontWeight: 500 }}> · reading…</span>}
      </div>
      {/* 3 · thesis — impact: why */}
      <div style={ROW} title={`${c.impact}: ${c.why}`}>
        <K>THESIS</K>{c.thesisType
          ? <><b style={{ color: C.text }}>{c.thesisType}</b>{c.thesisVariableLabel ? ` · ${c.thesisVariableLabel.toLowerCase()}${c.mapped ? '' : ' (not a thesis variable)'}` : ''}</>
          : <span style={{ color: C.faint }}>not set</span>}
        <span style={{ color: C.faint }}> — </span><K>IMPACT</K><b style={{ color: IMPACT_COLOR[c.impact] }}>{c.impact}</b>: {c.why}
      </div>
      {/* 4 · quality · delta (· evidence when it says more than the type) */}
      <div style={ROW} title={`${c.qualityWhy} · ${c.delta.text}${showEvidence ? ` · ${c.evidence}` : ''}`}>
        <K>QUALITY</K><b style={{ color: QUALITY_COLOR[c.quality] }}>{c.quality}</b>
        <span style={{ color: C.faint }}> · </span><K>DELTA</K><span style={{ color: c.delta.kind === 'change' ? C.text : C.faint, fontWeight: c.delta.kind === 'change' ? 800 : 500 }}>{c.delta.kind === 'change' ? c.delta.text.replace(/^CHANGE:\s*/, '') : c.delta.text.replace(/^LEVEL ONLY/, 'level only')}</span>
        {showEvidence && <><span style={{ color: C.faint }}> · </span><K>EVIDENCE</K>{c.evidence}</>}
      </div>
      {e.readNote && <div style={{ ...ROW, fontSize: 12, color: C.amber }} title={e.readNote}>{e.readNote}</div>}
      {/* zzz829: the other events and changes stated in the SAME filing — one filing, one card */}
      {e.also && e.also.length > 0 && (
        <div data-testid="nc-also" style={{ fontSize: 12, color: C.dim, lineHeight: 1.45, minWidth: 0 }}>
          <K>ALSO IN THIS FILING</K>
          {e.also.map((a, i) => (
            <div key={i} style={{ ...ROW, fontSize: 12, paddingLeft: 8 }} title={`${a.type}: ${a.line}`}>
              · <b style={{ color: a.dir === 'down' ? C.red : a.dir === 'up' ? C.green : C.dim }}>{a.type}</b>: {a.line}
            </div>
          ))}
        </div>
      )}
      {/* 5 · the chain, one line (scrolls on a phone) */}
      {c.chain && <div style={{ display: 'flex', gap: 4, alignItems: 'center', minWidth: 0 }}><K>CHAIN</K><div style={{ minWidth: 0, flex: 1 }}><Chain e={e} /></div></div>}
      {/* 6 · next · source · buttons */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', fontSize: 12, color: C.faint }}>
        {c.next && <span style={{ color: C.dim }}><K>NEXT</K><span style={{ color: C.text }}>{c.next}</span></span>}
        <span style={{ marginLeft: c.next ? 8 : 0, fontWeight: 800, color: e.badge === 'filed' ? C.cyan : C.amber }}>{e.badge === 'filed' ? 'Filed' : 'Press only'}</span>
        {ex && <span>· {ex}</span>}
        <span>· {c.sourceDocument}</span>
        {e.url ? <a href={e.url} target="_blank" rel="noreferrer" style={{ color: C.cyan, fontWeight: 800 }}>· Open filing ↗</a>
          : nsePage ? <a href={nsePage} target="_blank" rel="noreferrer" style={{ color: C.cyan }}>· NSE page ↗</a> : null}
        {e.filings.length > 1 && (
          <button onClick={() => setOpen((o) => !o)} style={{ fontSize: 12, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
            · {open ? '▾' : '▸'} {e.filings.length} filings
          </button>
        )}
        <button onClick={() => onLedger(e)} style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 800, color: C.cyan, background: C.bg, border: `1px solid ${C.cyan}`, borderRadius: 5, padding: '1px 8px', cursor: 'pointer' }}>
          Open thesis ledger
        </button>
      </div>
      {open && e.filings.length > 1 && (
        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.45 }}>
          {e.filings.map((f, k) => (
            <div key={k} style={ROW}>
              <span style={{ color: C.faint }}>{f.date}</span>{' · '}
              {f.url ? <a href={f.url} target="_blank" rel="noreferrer" style={{ color: C.dim }}>{f.title || 'filing'}</a> : f.title}
              {f.readNote && <span style={{ color: C.amber }}> — {f.readNote}</span>}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/** Minor and routine: one line each. */
function OneLine({ e, today, routine, onReadNow }: { e: RecentEvent; today: string; routine?: boolean; onReadNow?: (() => void) | null }) {
  const c = e.card;
  return (
    <div style={{ fontSize: 12.5, color: C.faint, lineHeight: 1.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
      <b style={{ color: C.dim }} title={e.company || undefined}>{e.ticker}</b>{e.company ? <span> ({clip(e.company, 40)})</span> : null}{' · '}{routine ? (e.routineWhy || 'routine') : (c?.eventType || e.type)}{' · '}{dayLabel(e.date)}{' · '}
      <span style={{ color: C.dim }}>{clip(routine ? (e.title || e.what) : (c?.event || e.what), 150)}</span>
      {e.url && <> · <a href={e.url} target="_blank" rel="noreferrer" style={{ color: C.faint }}>open ↗</a></>}
      {!routine && c && <span style={{ color: IMPACT_COLOR[c.impact] }}> · {c.impact}</span>}
      {onReadNow && <> · <button data-testid="nc-read-now" onClick={onReadNow} style={{ fontSize: 12, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>read now</button></>}
      <span style={{ color: C.faint }}> ({when(e.date, today)})</span>
    </div>
  );
}

// ── the thesis ledger side panel ──────────────────────────────────────────

function LedgerPanel({ e, all, onClose, holding }: { e: RecentEvent; all: RecentEvent[]; onClose: () => void; holding: Holding }) {
  useEffect(() => {
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  const v = ledgerView(e, all);
  const pattern = e.card?.thesisType || null;
  const status = v.status && (STATUS_META as any)[v.status] ? (STATUS_META as any)[v.status].label as string : null;
  const rows = v.rows, latest = v.latest, missing = v.missing, mine = v.events;
  return (
    <div role="dialog" aria-modal="true" aria-label={`Thesis ledger — ${e.ticker}`} data-testid="nc-ledger-panel"
      style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'color-mix(in srgb, var(--mc-bg-0, #000) 45%, transparent)' }} />
      <aside style={{ position: 'relative', width: 'min(560px, 100vw)', height: '100%', overflowY: 'auto', background: C.bg, borderLeft: `1px solid ${C.border}`, padding: '14px 16px', boxShadow: '0 0 24px rgba(0,0,0,0.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 17, color: C.text }}>{e.ticker}</b>
          <HoldingBadge h={holding} />
          <button onClick={onClose} aria-label="Close" style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 800, color: C.dim, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 6, padding: '2px 10px', cursor: 'pointer' }}>Close ✕</button>
        </div>
        {e.company && <div style={{ fontSize: 12.5, color: C.faint }}>{e.company}</div>}
        <div style={{ fontSize: 13, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>
          Thesis: {pattern ? <b style={{ color: C.text }}>{pattern}{e.card?.thesisName ? ` · ${e.card.thesisName.toLowerCase()}` : ''}</b> : <b style={{ color: C.text }}>not set</b>}
          {e.ctx?.fit === 'provisional' && <span style={{ color: C.faint }}> (provisional type)</span>}
          <br />Status: <b style={{ color: C.text }}>{status || 'no assessment on file'}</b>
        </div>

        <div style={{ fontSize: 11, fontWeight: 900, color: C.faint, letterSpacing: 0.5, marginTop: 12 }}>VARIABLES — FROM THE CARD&apos;S LEDGER</div>
        {rows.length ? (
          <div className="mc-table-scroll" style={{ border: `1px solid ${C.border}`, borderRadius: 6, marginTop: 4 }}>
            <table data-mc-table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
              <thead>
                <tr style={{ color: C.faint, textAlign: 'left', fontSize: 11, textTransform: 'uppercase' }}>
                  <th style={{ padding: '4px 6px' }}>Variable</th><th style={{ padding: '4px 6px' }}>Previous</th><th style={{ padding: '4px 6px' }}>Latest</th><th style={{ padding: '4px 6px' }}>Direction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top', background: e.card?.thesisVariable === r.key ? C.bg2 : undefined }}>
                    <td style={{ padding: '4px 6px', color: C.text, fontWeight: r.weight >= 4 ? 800 : 500 }}>{r.label || r.key}{r.weight >= 4 ? <span style={{ color: C.faint, fontWeight: 600 }}> · core</span> : null}</td>
                    <td style={{ padding: '4px 6px', color: C.dim }}>{r.before || '—'}</td>
                    <td style={{ padding: '4px 6px', color: C.dim }}>{r.after || (r.absence ? String(r.state || 'not disclosed').replace(/_/g, ' ').toLowerCase() : '—')}</td>
                    <td style={{ padding: '4px 6px', color: r.verdict === 'improving' ? C.green : r.verdict === 'deteriorating' ? C.red : C.faint }}>
                      {r.withinMateriality ? 'within materiality' : (VERDICT_WORD[r.verdict] || r.verdict || '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ fontSize: 12.5, color: C.faint, marginTop: 4 }}>No ledger read for this name yet — &ldquo;Check all for new evidence&rdquo; on the board reads it.</div>}

        <div style={{ fontSize: 11, fontWeight: 900, color: C.faint, letterSpacing: 0.5, marginTop: 12 }}>LATEST EVIDENCE</div>
        {latest.length ? <ul style={{ margin: '4px 0 0 16px', padding: 0, fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>{latest.map((x, i) => <li key={i}>{x}</li>)}</ul>
          : <div style={{ fontSize: 12.5, color: C.faint }}>none on file</div>}

        <div style={{ fontSize: 11, fontWeight: 900, color: C.faint, letterSpacing: 0.5, marginTop: 12 }}>MISSING EVIDENCE</div>
        {missing.length ? <div style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>{missing.join(' · ')}</div>
          : <div style={{ fontSize: 12.5, color: C.faint }}>nothing listed as missing</div>}

        <div style={{ fontSize: 11, fontWeight: 900, color: C.faint, letterSpacing: 0.5, marginTop: 12 }}>EVENTS IN THIS WINDOW</div>
        {mine.map((x) => (
          <div key={x.id} style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.5 }}>
            {dayLabel(x.date)} · {x.card?.eventType || x.type} · <span style={{ color: C.text }}>{clip(x.card?.event || x.what, 120)}</span>
            {x.card && <span style={{ color: IMPACT_COLOR[x.card.impact] }}> · {x.card.impact}</span>}
            {x.card?.next && <span style={{ color: C.faint }}> · next: {x.card.next}</span>}
          </div>
        ))}
      </aside>
    </div>
  );
}

// ── the tab ───────────────────────────────────────────────────────────────

export default function NewCatalystsTab({ result, loading, names, sourceNotes, market, progress, onJump, win, onWin, holdingOf, onRead, wanted }: NewCatalystsTabProps) {
  const [book, setBook] = useState<BookF>('all');
  const [mat, setMat] = useState<MatF>('All');
  const [type, setType] = useState<TypeFilter>('All');
  const [thesis, setThesis] = useState<ThesisF>('All');
  const [impact, setImpact] = useState<ImpactF>('All');
  const [showMinor, setShowMinor] = useState(false);
  const [showRoutine, setShowRoutine] = useState(false);
  const [showAllGaps, setShowAllGaps] = useState(false);
  const [ledger, setLedger] = useState<RecentEvent | null>(null);
  const [ownWin, setOwnWin] = useState<{ span: WindowSpan; anchor: string | null }>({ span: 10, anchor: null });
  const w = win || ownWin;
  const setW = (x: { span: WindowSpan; anchor: string | null }) => { if (onWin) onWin(x); else setOwnWin(x); };
  const today0 = result?.window.to || '';
  const range = useMemo(() => (today0 ? windowRange(today0, w.span, w.anchor, result?.window.days) : { from: '', to: '', days: 0 }), [today0, w.span, w.anchor, result?.window.days]);
  const hOf = (t: string): Holding => (holdingOf ? holdingOf(t) : null);
  // zzz825 (§34): a known-Minor document not yet asked for — read only when the Minor section opens or on click
  const lazyUrl = (e: RecentEvent): string | null => (onRead && e.read === 'pending' && e.readTier === 'minor' && e.url && !(wanted && wanted.has(normUrl(e.url))) ? e.url : null);

  // every non-routine event in the chosen days, then the filters
  const inWin = useMemo(() => (result ? [...result.items, ...result.minor].filter((e) => inRange(e.date, range, today0) && e.card) : []), [result, range, today0]);
  const routineWin = useMemo(() => (result ? result.hidden.filter((e) => inRange(e.date, range, today0)) : []), [result, range, today0]);
  const pass = (e: RecentEvent, skip?: 'book' | 'mat' | 'type' | 'thesis' | 'impact') => {
    const c = e.card!;
    const h = hOf(e.ticker);
    if (skip !== 'book' && book !== 'all' && h !== book) return false;
    if (skip !== 'mat' && mat !== 'All' && c.materiality !== mat) return false;
    if (skip !== 'type' && type !== 'All' && e.type !== type) return false;
    if (skip !== 'thesis' && thesis !== 'All' && (thesis === 'none' ? !!c.thesisType : c.thesisType !== thesis)) return false;
    if (skip !== 'impact' && impact !== 'All' && c.impact !== impact) return false;
    return true;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => inWin.filter((e) => pass(e)).sort((a, b) => b.date.localeCompare(a.date) || compareWithinDay(a, b)), [inWin, book, mat, type, thesis, impact, holdingOf]);
  const count = (skip: 'book' | 'mat' | 'type' | 'thesis' | 'impact', ok: (e: RecentEvent) => boolean) => inWin.filter((e) => pass(e, skip) && ok(e)).length;

  if (loading || !result) {
    return (
      <div role="status" style={{ fontSize: 14, color: C.cyan, fontWeight: 700, padding: '10px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
        Loading the filings on file for {names} names… the list appears when it is in.
      </div>
    );
  }

  const today = result.window.to;
  const oldest = shift(today, -(result.window.days - 1));
  const rd = result.reading;
  const reading = rd.pending - (onRead ? rd.lazy || 0 : 0) > 0 && (progress?.running ?? true);

  const material = list.filter((e) => e.card!.materiality === 'Material');
  const notable = list.filter((e) => e.card!.materiality === 'Notable');
  const minor = list.filter((e) => e.card!.materiality === 'Minor');
  const attention = list.filter((e) => e.card!.attention);
  const thesisEvidence = list.filter((e) => e.card!.quality === 'Direct' && e.card!.mapped);
  const investigate = list.filter((e) => e.card!.attention || (e.card!.materiality === 'Material' && e.card!.quality === 'Unproven'));
  const highlights = list.filter((e) => e.card!.materiality !== 'Minor')
    .sort((a, b) => (a.card!.attention ? 0 : 1) - (b.card!.attention ? 0 : 1)
      || (/Supports|Weakens|Broken/.test(a.card!.impact) ? 0 : 1) - (/Supports|Weakens|Broken/.test(b.card!.impact) ? 0 : 1)
      || MAT_RANK[a.card!.materiality] - MAT_RANK[b.card!.materiality] || (a.card!.keyNumber ? 0 : 1) - (b.card!.keyNumber ? 0 : 1)
      || b.date.localeCompare(a.date)).slice(0, 5);
  const gaps = list.filter((e) => e.card!.gap && e.card!.thesisType && (e.card!.materiality === 'Material' || e.card!.materiality === 'Notable'));
  const types = EVENT_TYPES.filter((t) => count('type', (e) => e.type === t) > 0 || t === type);
  const rangeWords = range.from === range.to ? dayLabel(range.to) : `${dayLabel(range.from)} – ${dayLabel(range.to)}`;
  const jumpTo = (e: RecentEvent) => document.getElementById(rowAnchor(e))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const filtered = book !== 'all' || mat !== 'All' || type !== 'All' || thesis !== 'All' || impact !== 'All';
  const card = (e: RecentEvent) => <EventCardView key={e.id} e={e} holding={hOf(e.ticker)} today={today} market={market} onJump={onJump} onLedger={setLedger} />;
  const H = ({ children, n, id }: { children: ReactNode; n?: number; id?: string }) => (
    <div id={id} style={{ fontSize: 13, fontWeight: 900, letterSpacing: 0.6, color: C.text, borderBottom: `1px solid ${C.border}`, paddingBottom: 3, marginTop: 6 }}>
      {children}{n != null && <span style={{ color: C.faint, fontWeight: 700 }}> · {n}</span>}
    </div>
  );

  return (
    <div data-testid="new-catalysts-tab" style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      {/* ── HEADER + METADATA ─────────────────────────────────────────── */}
      <div>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>Evidence-driven monitoring of thesis variables across the book</div>
        <div data-testid="nc-meta" style={{ fontSize: 12.5, color: C.faint, lineHeight: 1.45 }}>
          <b style={{ color: C.dim }}>{names}</b> names · <b style={{ color: C.dim }}>{rd.read}</b> filings read · <b style={{ color: C.dim }}>{inWin.length}</b> events ({inWin.filter((e) => e.card!.materiality === 'Material').length} Material{routineWin.length ? `, ${routineWin.length} routine` : ''}) · {rangeWords}
          <span> · read by rule, no AI · a figure appears only when the filing states it</span>
        </div>
        {rd.total > 0 && (
          <div data-testid="new-catalysts-reading" role="status" style={{ fontSize: 12.5, color: reading ? C.cyan : C.faint, fontWeight: reading ? 700 : 500 }}>
            {reading
              ? <>Reading {Math.min(rd.total, rd.read + rd.failed + 1)} of {rd.total} filings… cards fill in as each document is read.{onRead && rd.lazy ? ` (${rd.lazy} minor — read when you open Minor)` : ''}</>
              : <>Read {rd.read} of {rd.total} filings{rd.failed ? ` · ${rd.failed} could not be opened (subject shown)` : ''}{rd.pending ? ` · ${rd.pending} not read yet` : ''}{onRead && rd.lazy ? ` (${rd.lazy} minor — read when you open Minor)` : ''}.</>}
            {progress?.error && <span style={{ color: C.amber }}> · {progress.error}</span>}
          </div>
        )}
        {sourceNotes.length > 0 && (
          <div data-testid="new-catalysts-source-notes" style={{ fontSize: 12.5, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '5px 10px', lineHeight: 1.45, marginTop: 4 }}>
            {sourceNotes.map((x, i) => <div key={i}>⚠ {x}</div>)}
          </div>
        )}
      </div>

      {/* ── COMMAND BAR ───────────────────────────────────────────────── */}
      <div data-testid="nc-command-bar" style={{ display: 'flex', flexDirection: 'column', gap: 4, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 8px', background: C.bg, minWidth: 0 }}>
        {holdingOf && (
          <Group label="Book">
            <Chip on={book === 'all'} onClick={() => setBook('all')}>All ({count('book', () => true)})</Chip>
            <Chip on={book === 'book'} onClick={() => setBook('book')} title="Names you hold">My Book ({count('book', (e) => hOf(e.ticker) === 'book')})</Chip>
            <Chip on={book === 'bench'} onClick={() => setBook('bench')} title={`${market === 'US' ? 'US' : 'India'} Conviction Beats names you do not hold`}>Conviction Beats ({count('book', (e) => hOf(e.ticker) === 'bench')})</Chip>
          </Group>
        )}
        <Group label="Materiality">
          {(['All', 'Material', 'Notable', 'Minor'] as MatF[]).map((m) => (
            <Chip key={m} on={mat === m} onClick={() => setMat(m)}>{m} ({count('mat', (e) => m === 'All' || e.card!.materiality === m)})</Chip>
          ))}
        </Group>
        <Group label="Event">
          <select aria-label="Event type" value={type} onChange={(ev) => setType(ev.target.value as TypeFilter)}
            style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 6px', borderRadius: 8, border: `1px solid ${type === 'All' ? C.border : C.cyan}`, color: type === 'All' ? C.dim : C.cyan, background: C.bg, maxWidth: 260 }}>
            <option value="All">All types ({count('type', () => true)})</option>
            {types.map((t) => <option key={t} value={t}>{t} ({count('type', (e) => e.type === t)})</option>)}
          </select>
        </Group>
        <Group label="Thesis">
          {(['All', 'A', 'B', 'F', 'G', 'none'] as ThesisF[]).map((t) => (
            <Chip key={t} on={thesis === t} onClick={() => setThesis(t)}>{t === 'none' ? 'Not set' : t} ({count('thesis', (e) => t === 'All' || (t === 'none' ? !e.card!.thesisType : e.card!.thesisType === t))})</Chip>
          ))}
        </Group>
        <Group label="Impact">
          {(['All', ...IMPACTS] as ImpactF[]).map((i) => (
            <Chip key={i} on={impact === i} onClick={() => setImpact(i)}>{i} ({count('impact', (e) => i === 'All' || e.card!.impact === i)})</Chip>
          ))}
        </Group>
        <Group label="Time">
          {WINDOW_SPANS.map((sp) => <Chip key={sp} on={w.span === sp && !w.anchor} onClick={() => setW({ span: sp, anchor: null })}>{SPAN_LABEL[sp]}</Chip>)}
          <button aria-label="One day earlier" disabled={range.to <= oldest} onClick={() => setW({ span: w.span, anchor: shift(range.to, -1) })}
            style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 800, padding: '2px 8px', borderRadius: 8, border: `1px solid ${C.border}`, color: range.to <= oldest ? C.faint : C.dim, background: C.bg, cursor: range.to <= oldest ? 'default' : 'pointer' }}>←</button>
          <input type="date" aria-label="Custom date" min={oldest} max={today} value={range.to}
            onChange={(ev) => { const v = ev.target.value; if (v) setW({ span: w.span, anchor: v >= today ? null : v }); }}
            style={{ flex: '0 0 auto', fontSize: 12.5, padding: '2px 5px', borderRadius: 8, border: `1px solid ${w.anchor ? C.cyan : C.border}`, color: C.text, background: C.bg }} />
          <button aria-label="One day later" disabled={range.to >= today} onClick={() => { const nx = shift(range.to, 1); setW({ span: w.span, anchor: nx >= today ? null : nx }); }}
            style={{ flex: '0 0 auto', fontSize: 12.5, fontWeight: 800, padding: '2px 8px', borderRadius: 8, border: `1px solid ${C.border}`, color: range.to >= today ? C.faint : C.dim, background: C.bg, cursor: range.to >= today ? 'default' : 'pointer' }}>→</button>
          <span data-testid="new-catalysts-range" style={{ flex: '0 0 auto', fontSize: 12, color: C.faint, whiteSpace: 'nowrap' }}>
            {rangeWords} · {list.length} shown
            {w.anchor && <> · <button onClick={() => setW({ span: w.span, anchor: null })} style={{ fontSize: 12, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>back to today</button></>}
          </span>
        </Group>
        {filtered && (
          <div><button onClick={() => { setBook('all'); setMat('All'); setType('All'); setThesis('All'); setImpact('All'); }}
            style={{ fontSize: 12, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>Clear filters</button></div>
        )}
      </div>

      {inWin.length === 0 ? (
        <div data-testid="new-catalysts-empty" style={{ fontSize: 14, color: C.dim, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '12px 14px', lineHeight: 1.55 }}>
          <b style={{ color: C.text }}>No new catalysts {range.from === range.to ? `on ${dayLabel(range.to)}` : `in the last ${range.days} days`} for your {names} names</b>
          {result.lastItem ? <> — last new item was {result.lastItem.date} ({result.lastItem.ticker}).</> : <> — no dated filing is on file for any of them yet.</>}
          {w.span < result.window.days && result.items.length > 0 && <div style={{ marginTop: 4 }}><button onClick={() => setW({ span: 10, anchor: null })} style={{ fontSize: 13, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>Show all 10 days</button></div>}
          {reading && <div style={{ color: C.cyan, marginTop: 4 }}>Filings are still being read — this may change.</div>}
          {sourceNotes.length > 0 && <div style={{ color: C.amber, marginTop: 4 }}>Some sources failed (see above), so this may be incomplete.</div>}
        </div>
      ) : (<>
        {/* ── WHAT CHANGED ─────────────────────────────────────────────── */}
        <section data-testid="nc-what-changed" style={{ border: `1px solid ${C.cyan}`, borderRadius: 8, padding: '8px 12px', background: C.bg }}>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
            <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 0.6, color: C.text }}>WHAT CHANGED</span>
            <span style={{ fontSize: 13, color: C.dim }}><b style={{ color: C.text, fontSize: 15 }}>{material.length}</b> Material</span>
            <span style={{ fontSize: 13, color: C.dim }} title="Events whose filing states a change, with its prior, in a variable the thesis rests on"><b style={{ color: C.text, fontSize: 15 }}>{thesisEvidence.length}</b> thesis evidence</span>
            <span style={{ fontSize: 13, color: C.dim }} title="Needs attention, or a Material filing whose evidence is unproven"><b style={{ color: investigate.length ? C.amber : C.text, fontSize: 15 }}>{investigate.length}</b> need investigation</span>
          </div>
          {highlights.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6, marginTop: 6 }}>
              {highlights.map((e) => (
                <button key={e.id} onClick={() => jumpTo(e)} style={{ textAlign: 'left', cursor: 'pointer', border: `1px solid ${e.card!.attention ? C.amber : C.border}`, borderRadius: 6, background: C.bg, padding: '5px 8px', minWidth: 0 }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <b style={{ color: C.text, fontSize: 13 }} title={e.company || undefined}>{e.ticker}</b>
                    <span style={{ fontSize: 11.5, color: C.faint, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.card!.eventType}{e.company ? ` · ${e.company}` : ''}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 900, color: IMPACT_COLOR[e.card!.impact] }}>{e.card!.impact}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.35 }}>{e.card!.keyNumber ? <b style={{ color: C.text }}>{e.card!.keyNumber} · </b> : null}{clip(e.card!.event, 90)}</div>
                  {e.card!.attention && <div style={{ fontSize: 11.5, color: C.amber }}>⚠ {e.card!.attention}</div>}
                </button>
              ))}
            </div>
          )}
        </section>

        {/* ── NEEDS ATTENTION ──────────────────────────────────────────── */}
        {attention.length > 0 && (
          <section data-testid="nc-attention" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <H n={attention.length}>NEEDS ATTENTION</H>
            {attention.map(card)}
          </section>
        )}

        {/* ── EVIDENCE GAPS ────────────────────────────────────────────── */}
        {gaps.length > 0 && (
          <section data-testid="nc-gaps">
            <H n={gaps.length}>EVIDENCE GAPS</H>
            <div className="mc-table-scroll" style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, marginTop: 4 }}>
              <table data-mc-table style={{ width: '100%', minWidth: 560, borderCollapse: 'collapse', fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: C.faint, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    <th style={{ padding: '5px 8px' }}>Company</th><th style={{ padding: '5px 8px' }}>Thesis</th><th style={{ padding: '5px 8px' }}>Gap</th><th style={{ padding: '5px 8px' }}>Next evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllGaps ? gaps : gaps.slice(0, 8)).map((e) => (
                    <tr key={e.id} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                      <td style={{ padding: '5px 8px', whiteSpace: 'nowrap' }}>
                        <a href={`#${rowAnchor(e)}`} onClick={(ev) => { ev.preventDefault(); jumpTo(e); }} style={{ color: C.text, fontWeight: 900, textDecoration: 'none' }}>{e.ticker}</a>
                        <span style={{ color: C.faint }}> · {e.card!.eventType}</span>
                      </td>
                      <td style={{ padding: '5px 8px', color: C.dim }}>{e.card!.thesisType}{e.card!.thesisVariableLabel ? ` · ${e.card!.thesisVariableLabel.toLowerCase()}` : ''}</td>
                      <td style={{ padding: '5px 8px', color: C.text, fontWeight: 800, whiteSpace: 'nowrap' }}>{e.card!.gap}</td>
                      <td style={{ padding: '5px 8px', color: C.dim }}>{e.card!.next}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {gaps.length > 8 && <button onClick={() => setShowAllGaps((v) => !v)} style={{ fontSize: 12, color: C.cyan, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', marginTop: 3 }}>{showAllGaps ? 'Show fewer' : `Show all ${gaps.length}`}</button>}
          </section>
        )}

        {/* ── MATERIAL THESIS EVENTS ───────────────────────────────────── */}
        {material.length > 0 && (
          <section data-testid="nc-material" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <H n={material.length}>MATERIAL THESIS EVENTS</H>
            {material.filter((e) => !e.card!.attention).map(card)}
            {material.some((e) => e.card!.attention) && <div style={{ fontSize: 12, color: C.faint }}>{material.filter((e) => e.card!.attention).length} more under Needs attention above.</div>}
          </section>
        )}

        {/* ── NOTABLE ──────────────────────────────────────────────────── */}
        {notable.length > 0 && (
          <section data-testid="nc-notable" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <H n={notable.length}>NOTABLE</H>
            {notable.filter((e) => !e.card!.attention).map(card)}
          </section>
        )}

        {list.length === 0 && (
          <div style={{ fontSize: 13, color: C.faint, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
            Nothing matches these filters in {rangeWords}.
          </div>
        )}

        {/* ── MINOR + ROUTINE — collapsed, one line each ──────────────── */}
        {(minor.length > 0 || routineWin.length > 0) && (
          <section data-testid="nc-minor" style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
            {minor.length > 0 && (
              <button data-testid="nc-minor-toggle" onClick={() => { const open = !showMinor; setShowMinor(open); if (open && onRead) { const us = minor.map(lazyUrl).filter((u): u is string => !!u); if (us.length) onRead(us); } }} style={{ alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 800, color: C.faint, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                {showMinor ? '▾' : '▸'} MINOR · {minor.length}
              </button>
            )}
            {showMinor && minor.map((e) => { const u = lazyUrl(e); return <OneLine key={e.id} e={e} today={today} onReadNow={u ? () => onRead!([u]) : null} />; })}
            {routineWin.length > 0 && !filtered && (
              <button onClick={() => setShowRoutine((v) => !v)} style={{ alignSelf: 'flex-start', fontSize: 12.5, fontWeight: 800, color: C.faint, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
                {showRoutine ? '▾' : '▸'} ROUTINE PAPERWORK · {routineWin.length}
              </button>
            )}
            {showRoutine && !filtered && routineWin.map((e) => <OneLine key={e.id} e={e} today={today} routine />)}
          </section>
        )}
      </>)}

      {ledger && <LedgerPanel e={ledger} all={inWin} holding={hOf(ledger.ticker)} onClose={() => setLedger(null)} />}
    </div>
  );
}
