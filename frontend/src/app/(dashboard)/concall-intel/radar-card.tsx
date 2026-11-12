'use client';
// zzz1214 — one compact Transformation Radar card.
// zzz1272 — readability redesign (owner: "make it more readable, increase text size"). Bigger type (14 px body), the card reads
// top to bottom in the order an investor asks: what changed → the evidence → is it in the numbers → which checks are still open →
// risk and next milestone. Text that repeated on every card (valuation boilerplate, "segment split not in the data", the six
// passing checks) is folded into tooltips / Details. No figure or rule changed — only how it is shown.
import type { ReactNode } from 'react';
import type { TransformScreenEntry } from './types';
import type { ConvictionEntry } from '@/lib/conviction-beats';
import { TF, TFM, CONV_TIER_COLOR } from './constants';
import { radarDecision } from '@/lib/concall-radar-decision';

/** zzz1272 — one type scale for the radar (px) */
export const RF = { label: 11.5, small: 12.5, body: 14, quote: 14, lead: 15, title: 20 } as const;

// zzz1224 — the card's colour and label follow the research state (radar-transformation.ts)
export const STATE_META: Record<string, { label: string; color: string; tip: string }> = {
  EARNINGS_POWER: { label: 'Earnings-power change confirmed', color: '#10B981', tip: 'A measured shift (e.g. share of higher-value products) large enough to show in consolidated results, and results growing. That the change caused the growth is not proven.' },
  COMMERCIAL: { label: 'Commercial change confirmed', color: '#0EA5E9', tip: 'Customers, orders or production of the new thing are real; earnings effect not yet visible.' },
  EMERGING: { label: 'Potential transformation', color: '#8B5CF6', tip: 'An early milestone (first order, approval, a turned-around unit, a large capacity step). Size or attribution still unknown.' },
  ROUTINE: { label: 'Ordinary business', color: '#94A3B8', tip: 'A real event, but ordinary business: product variants, normal capacity, a small order, margin commentary.' },
  INSUFFICIENT: { label: 'Insufficient evidence', color: '#94A3B8', tip: 'Plans, a capability, a slide fragment, or an old milestone — nothing to judge yet.' },
};
/** zzz1226 — the card / table label from the tier */
export function tierLabel(tr: { tier: string; stateWord: string; mechanismWord: string } | undefined, fallback: string): string {
  if (!tr) return fallback;
  if (tr.tier === 'CONFIRMED') return `★ Confirmed · ${tr.stateWord}`;
  if (tr.tier === 'WATCH') return `◔ Research watch · ${tr.mechanismWord}`;
  return tr.stateWord;
}
function tierTip(tr: { tier: string } | undefined, fallback: string): string {
  if (!tr) return fallback;
  if (tr.tier === 'CONFIRMED') return 'Confirmed transformation: every check passes on the same evidence sentence.';
  if (tr.tier === 'WATCH') return 'Potential transformation: a structural change with something still unknown (see the open checks). Research it; it is not proven.';
  return fallback;
}

/** zzz1272 — text that repeated on every card is moved to a tooltip; the figures stay */
const VAL_BOILERPLATE = /\s*Valuation not underwritten(?::[^.]*\.)?\.?\s*$/;
export const cleanValuationText = (t: string): string => String(t || '').replace(VAL_BOILERPLATE, '').trim();
export const cleanOldBusiness = (t: string): string => String(t || '').replace(/\s*\(segment split not in the data\)\s*$/, '').trim();

const TONE_COLOR: Record<string, string> = { POSITIVE: '#10B981', MIXED: '#F59E0B', NEGATIVE: '#EF4444', NEUTRAL: '#94A3B8' };
const VERDICT_COLOR: Record<string, string> = {
  STRONGER_LATEST: '#10B981', NOT_UNDERWRITTEN: '#64748B', STRETCHED: '#EF4444', ACCELERATING: '#10B981', GROWING: '#10B981', SLOWING: '#F59E0B', DECLINING: '#EF4444', UNKNOWN: '#94A3B8',
  RAISED: '#10B981', MAINTAINED: '#64748B', NEW: '#0EA5E9', LOWERED: '#EF4444', NONE: '#94A3B8', NOT_COMPARABLE: '#F59E0B',
  NOT_PRICED_IN: '#10B981', PARTLY: '#F59E0B', PRICED_IN: '#EF4444',
};
const WORD: Record<string, string> = {
  STRONGER_LATEST: 'latest quarter stronger', NOT_UNDERWRITTEN: 'not underwritten', STRETCHED: 'expensive (trailing)', ACCELERATING: 'speeding up', GROWING: 'growing', SLOWING: 'slowing', DECLINING: 'falling', UNKNOWN: 'not checked',
  RAISED: 'raised', MAINTAINED: 'kept', NEW: 'given', LOWERED: 'lowered', NONE: 'none on file', NOT_COMPARABLE: 'not comparable',
  NOT_PRICED_IN: 'not priced in', PARTLY: 'partly priced in', PRICED_IN: 'priced in',
};
const ROLE_WORD: Record<string, string> = { MANAGEMENT: 'management', COMPANY: 'company document', ANALYST: 'analyst question', UNKNOWN: 'speaker unknown' };
const CONF_COLOR: Record<string, string> = { HIGH: '#10B981', MEDIUM: '#0EA5E9', LOW: '#94A3B8' };

function SectionLabel({ children, color }: { children: ReactNode; color?: string }) {
  return <div style={{ fontSize: RF.label, fontWeight: 900, letterSpacing: '0.6px', textTransform: 'uppercase', color: color || TF.dim, marginBottom: 5 }}>{children}</div>;
}

function Fact({ title, verdict, text, tip, foot }: { title: string; verdict: string; text: string; tip?: string; foot?: ReactNode }) {
  const c = VERDICT_COLOR[verdict] || TF.dim;
  return (
    <div title={tip || text} style={{ flex: '1 1 220px', minWidth: 0, background: TF.card2, border: `1px solid ${TF.border}`, borderTop: `3px solid ${c}`, borderRadius: 8, padding: '9px 12px' }}>
      <div style={{ fontSize: RF.label, color: TF.dim, fontWeight: 900, letterSpacing: '0.6px' }}>{title}</div>
      <div style={{ fontSize: RF.lead, fontWeight: 900, color: c, margin: '2px 0 4px' }}>{WORD[verdict] || verdict.toLowerCase()}</div>
      <div style={{ fontSize: RF.small, color: TF.text2, lineHeight: 1.5 }}>{text}</div>
      {foot && <div style={{ fontSize: RF.label, color: TF.dim, marginTop: 5 }}>{foot}</div>}
    </div>
  );
}

function Chip({ children, color, title, solid }: { children: ReactNode; color: string; title?: string; solid?: boolean }) {
  return (
    <span title={title} style={{ fontSize: RF.small, fontWeight: 800, padding: '3px 10px', borderRadius: 999, whiteSpace: 'nowrap',
      color: solid ? '#fff' : color, background: solid ? color : `color-mix(in srgb, ${color} 12%, transparent)`, border: `1px solid ${solid ? color : `color-mix(in srgb, ${color} 45%, transparent)`}` }}>
      {children}
    </span>
  );
}

export function RadarCard({ e, rank, bench, inBook, capCr, showFullSignals }: {
  e: TransformScreenEntry; rank: number; bench: ConvictionEntry | undefined; inBook: boolean; capCr: number | null; showFullSignals: boolean;
}) {
  const ins = e.insight;
  const tr = ins?.transformation;
  const lane = STATE_META[tr?.state || 'INSUFFICIENT'];
  const d = radarDecision(e);
  const dColor = d.queue === 'RESEARCH' ? TF.green : d.queue === 'RISK' ? TF.red : d.queue === 'UNVERIFIED' ? TF.dim : TF.amber;
  const role = e.quote_role || (e.evidence_record?.attribution === 'COMPANY_DOCUMENT' ? 'COMPANY' : e.evidence_record?.attribution) || 'UNKNOWN';
  const quoteUsable = e.evidence_record ? e.evidence_record.quote_quality === 'USABLE' : !!e.evidence_quote;
  const st = e.facts?.stage;
  const date = (() => { const t = new Date(e.filing_datetime); return Number.isFinite(t.getTime()) ? t.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : ''; })();
  const tierColor = tr?.tier === 'CONFIRMED' ? '#B45309' : tr?.tier === 'WATCH' ? '#7C3AED' : lane.color;
  const passed = tr ? tr.gates.filter((g) => g.result === 'PASS') : [];
  const open = tr ? tr.gates.filter((g) => g.result !== 'PASS') : [];
  const linkStyle = { fontSize: RF.small, fontWeight: 800, color: TF.cyan, textDecoration: 'none', padding: '5px 12px', borderRadius: 7, border: `1px solid color-mix(in srgb, ${TF.cyan} 45%, transparent)`, background: `color-mix(in srgb, ${TF.cyan} 8%, transparent)` } as const;

  return (
    <div style={{ background: TF.card, border: `1px solid ${TF.border}`, borderLeft: `5px solid ${tierColor}`, borderRadius: 12, padding: '16px 20px' }}>
      {/* header — who, which tier, how sure */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0, flex: '1 1 420px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: RF.lead, fontWeight: 900, color: TF.dim, ...TFM }}>#{rank}</span>
            <span style={{ fontSize: RF.title, fontWeight: 900, color: TF.text, letterSpacing: '0.2px' }}>{e.symbol}</span>
            <span style={{ fontSize: RF.lead, color: TF.muted, fontWeight: 600 }}>{e.company_name}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginTop: 8 }}>
            {/* zzz1226 — ONE label per card, from the tier: never "confirmed" on a name that is only on the research watch */}
            <Chip color={tierColor} solid title={tierTip(tr, lane.tip)}>{tierLabel(tr, lane.label)}</Chip>
            {ins?.promising && <Chip color="#D97706" title="Passes every best rule except one: the document has a contradiction (a positive and a negative statement) that must be read and reconciled first">◐ Promising — reconcile first</Chip>}
            <Chip color={TF.text2} title="Market capitalisation">{capCr != null ? `₹${Math.round(capCr).toLocaleString('en-IN')} Cr` : 'size n/a'}</Chip>
            {st != null && <Chip color={st === 2 ? '#10B981' : st === 4 ? '#EF4444' : '#94A3B8'} title="Weekly Stage Analysis (completed weeks)">Stage {st}</Chip>}
            {e.tone && <Chip color={TONE_COLOR[e.tone] || '#94A3B8'} title={`Management tone read from the document: ${e.tone_pos ?? 0} positive and ${e.tone_neg ?? 0} negative phrases`}>● {e.tone.toLowerCase()} tone</Chip>}
            {inBook && <Chip color="#059669">📗 in my book</Chip>}
            {bench && <a href="/conviction-beats" style={{ textDecoration: 'none' }}><Chip color={CONV_TIER_COLOR[bench.tier] || '#10B981'} title="On the Conviction Beats bench">🏆 {bench.tier}</Chip></a>}
          </div>
        </div>
        {tr && (
          <div style={{ textAlign: 'right', flex: '0 0 auto' }} title="Confidence in this reading: HIGH when every eligibility gate passes, MEDIUM with one unknown, LOW otherwise. The list is ranked by research state, then size, then confidence — not a score.">
            <div style={{ fontSize: RF.lead, fontWeight: 900, color: CONF_COLOR[tr.confidence] || TF.dim }}>{tr.confidence.toLowerCase()} confidence</div>
            <div style={{ fontSize: RF.small, color: TF.muted, marginTop: 2 }}>{tr.proofStage ? <>proof stage: <b style={{ color: TF.text2 }}>{tr.proofStage}</b></> : 'no proof stage'}</div>
            <div style={{ fontSize: RF.label, color: TF.dim, marginTop: 2 }}>{e.doc_label ? `📄 ${e.doc_label}` : ''}{date ? ` · ${date}` : ''}</div>
          </div>
        )}
      </div>

      {/* what changed + the evidence — in plain words, big enough to read */}
      {tr ? (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            {/* zzz1224 label kept: "Transformation thesis:" */}
            <SectionLabel color={tierColor}>Transformation thesis: {tr.mechanismWord}</SectionLabel>
            <div style={{ fontSize: RF.body, color: TF.text, lineHeight: 1.6, fontWeight: 600 }}>{tr.thesis.whatChanges}</div>
            <div style={{ fontSize: RF.small, color: TF.text2, lineHeight: 1.55, marginTop: 3 }}><b>Earnings impact:</b> {tr.thesis.earningsImpact}</div>
          </div>
          <div style={{ borderLeft: `4px solid ${TF.cyan}`, background: TF.card2, borderRadius: '0 8px 8px 0', padding: '10px 14px' }}>
            <SectionLabel>Evidence: in the company’s words</SectionLabel>
            <div style={{ fontSize: RF.quote, color: TF.text, lineHeight: 1.65, fontStyle: 'italic' }}>
              “{tr.evidence.quote.length > 420 ? `${tr.evidence.quote.slice(0, 420)}…` : tr.evidence.quote}”
            </div>
            <div style={{ fontSize: RF.small, color: TF.muted, marginTop: 6 }}>
              — {e.quote_speaker ? <b style={{ color: TF.text2 }}>{e.quote_speaker}</b> : null}{e.quote_speaker ? ', ' : ''}{ROLE_WORD[role] || 'speaker unknown'} · {date || 'date n/a'} · {tr.evidence.actual === 'ACTUAL' ? 'already achieved' : 'a plan'} · {tr.evidence.scope === 'UNKNOWN' ? 'scope not stated' : tr.evidence.scope.toLowerCase().replace('_', ' ')}
            </div>
            {tr.evidence.entity.ok !== true && <div style={{ color: TF.amber, fontSize: RF.small, marginTop: 5, fontWeight: 700 }}>⚠ {tr.evidence.entity.note}</div>}
          </div>
          {tr.contradiction && <div style={{ fontSize: RF.small, color: TF.amber, fontWeight: 700 }}>⚠ {tr.contradiction}</div>}
        </div>
      ) : ins && <div style={{ fontSize: RF.body, color: TF.text2, marginTop: 10, lineHeight: 1.6 }}>{ins.headline}</div>}

      {/* is it in the numbers — three separate facts, never inferred from each other */}
      {ins && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>In the numbers</SectionLabel>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Fact title="RESULTS" verdict={ins.results.verdict} text={ins.results.text}
              foot={tr ? <>Link to this change: <b>not proven</b></> : undefined} />
            <Fact title="GUIDANCE" verdict={ins.guidance.verdict} text={ins.guidance.text} />
            <Fact title="VALUATION (context)" verdict={ins.valuation.gap} text={cleanValuationText(ins.valuation.text) || ins.valuation.text}
              tip={`${ins.valuation.text} The radar does not judge value: there is no forward earnings estimate here, so a low P/E or a falling price is not proof of value.`} />
          </div>
        </div>
      )}

      {/* zzz1216 — older cached scans without the transformation read: three separate facts plus the order size */}
      {!tr && ins?.checks && (
        <div style={{ fontSize: RF.small, color: TF.muted, marginTop: 10, lineHeight: 1.6 }}>
          <span style={{ color: ins.checks.transformation ? TF.green : TF.dim }}>{ins.checks.transformation ? '✓' : '✗'} business change seen</span>
          {' · '}<span style={{ color: ins.checks.growth ? TF.green : TF.dim }}>{ins.checks.growth ? '✓' : '✗'} growth in reported results</span>
          {' · '}<span style={{ color: TF.dim }}>✗ link between the two not proven</span>
          {ins.proof && <div title="Does the quoted sentence itself prove the named business event? A keyword elsewhere in the document is not proof." style={{ color: ins.proof.kind === 'MILESTONE' ? TF.green : TF.amber }}>{ins.proof.kind === 'MILESTONE' ? '✓' : '✗'} Proof sentence: {ins.proof.reason}</div>}
          {ins.materiality && <div title="Order value against annual sales (market cap ÷ P/S). Only an amount in the proof sentence is sized. Orders are not revenue until delivered.">{ins.materiality.text}</div>}
        </div>
      )}
      {!tr && (e.evidence_quote && quoteUsable && role !== 'ANALYST' ? (
        <div style={{ fontSize: RF.body, color: TF.text2, marginTop: 10, lineHeight: 1.6, borderLeft: `4px solid ${TF.cyan}`, paddingLeft: 12, fontStyle: 'italic' }}>
          “{e.evidence_quote.length > 360 ? `${e.evidence_quote.slice(0, 360)}…` : e.evidence_quote}”
          <span style={{ color: TF.dim, fontSize: RF.small, fontStyle: 'normal' }}> — {e.quote_speaker ? `${e.quote_speaker}, ` : ''}{ROLE_WORD[role] || 'speaker unknown'}{e.evidence_record?.fiscal_period ? ` · ${e.evidence_record.fiscal_period}` : ''}</span>
        </div>
      ) : (
        <div style={{ fontSize: RF.small, color: TF.dim, marginTop: 10 }}>
          {role === 'ANALYST' ? 'The strongest line was an analyst question — not used as proof.' : 'No clean management sentence to quote (slide table or broken text) — open the filing.'}
        </div>
      ))}

      {/* the six checks: passing ones as one line, the open ones spelled out (the first open one is the next check) */}
      {tr && (
        <div style={{ marginTop: 14 }}>
          <SectionLabel>Checks · <span style={{ color: open.length ? TF.amber : TF.green }}>{passed.length} of {tr.gates.length} pass</span></SectionLabel>
          {open.length === 0
            ? <div style={{ fontSize: RF.small, color: TF.green, fontWeight: 800 }} title={passed.map((g) => `✓ ${g.label}`).join('\n')}>✓ All checks pass</div>
            : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {open.map((g, i) => (
                  <div key={g.key} style={{ fontSize: RF.small, lineHeight: 1.5, color: TF.text2 }}>
                    <b style={{ color: g.result === 'FAIL' ? TF.red : TF.amber }}>{g.result === 'FAIL' ? '✗' : '?'} {g.label}</b>
                    {i === 0 && <span style={{ fontSize: RF.label, fontWeight: 900, color: TF.amber, marginLeft: 6 }}>NEXT CHECK</span>}
                    {g.note && <span style={{ color: TF.muted }}> — {g.note}</span>}
                  </div>
                ))}
                <div style={{ fontSize: RF.label, color: TF.dim }} title={passed.map((g) => `✓ ${g.label}`).join('\n')}>Passing: {passed.map((g) => g.label.toLowerCase()).join(' · ') || 'none'}</div>
              </div>
            )}
        </div>
      )}

      {/* risk and next milestone side by side */}
      {tr && tr.state !== 'ROUTINE' && tr.state !== 'INSUFFICIENT' && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          <div style={{ flex: '1 1 260px', background: `color-mix(in srgb, ${TF.red} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${TF.red} 30%, transparent)`, borderRadius: 8, padding: '9px 12px' }}>
            <SectionLabel color={TF.red}>Key risk</SectionLabel>
            <div style={{ fontSize: RF.small, color: TF.text2, lineHeight: 1.55 }}>{tr.thesis.keyRisk}</div>
          </div>
          <div style={{ flex: '1 1 260px', background: `color-mix(in srgb, ${TF.cyan} 6%, transparent)`, border: `1px solid color-mix(in srgb, ${TF.cyan} 30%, transparent)`, borderRadius: 8, padding: '9px 12px' }}>
            <SectionLabel color={TF.cyan}>Next milestone</SectionLabel>
            <div style={{ fontSize: RF.small, color: TF.text2, lineHeight: 1.55 }}>{tr.thesis.nextMilestone}</div>
          </div>
        </div>
      )}
      {tr?.thesis.sectorCheck && <div style={{ fontSize: RF.small, color: TF.muted, marginTop: 8, lineHeight: 1.5 }}><b style={{ color: TF.text2 }}>What to watch in this sector:</b> {tr.thesis.sectorCheck}</div>}

      {/* holding back + links */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 14, paddingTop: 12, borderTop: `1px solid ${TF.border}` }}>
        {!tr && (ins?.best
          ? (d.queue === 'RECONCILE' || d.queue === 'RISK' ? <span title={d.reason} style={{ fontSize: RF.small, fontWeight: 800, color: TF.amber }}>Check: {(e.caution_flags || []).slice(0, 2).join(', ') || d.reason}</span> : null)
          : <span title={d.reason} style={{ fontSize: RF.small, fontWeight: 800, color: dColor }}>{d.label}</span>)}
        {ins && ins.blockers.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: RF.label, fontWeight: 900, color: TF.dim, letterSpacing: '0.5px' }}>HOLDING BACK</span>
            {ins.blockers.slice(0, 3).map((b) => <Chip key={b} color="#D97706">{b}</Chip>)}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {e.attachment_url && <a href={e.attachment_url} target="_blank" rel="noopener noreferrer" style={linkStyle}>Open filing →</a>}
        <a href={`/company-lab?add=IN:${encodeURIComponent(e.symbol)}`} style={linkStyle}>Company Lab →</a>
      </div>

      <details style={{ marginTop: 10 }} open={showFullSignals}>
        <summary style={{ cursor: 'pointer', fontSize: RF.small, color: TF.muted, fontWeight: 800 }}>Details</summary>
        <div style={{ fontSize: RF.small, color: TF.muted, lineHeight: 1.65, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {tr && <div><b style={{ color: TF.text2 }}>Business today:</b> {cleanOldBusiness(tr.thesis.oldBusiness)} <span style={{ color: TF.dim }}>(segment split not in the data)</span></div>}
          {tr && <div><b style={{ color: TF.text2 }}>All checks:</b>{tr.gates.map((g) => <div key={g.key} style={{ paddingLeft: 10 }}><span style={{ color: g.result === 'PASS' ? TF.green : g.result === 'FAIL' ? TF.red : TF.amber, fontWeight: 800 }}>{g.result === 'PASS' ? '✓' : g.result === 'FAIL' ? '✗' : '?'} {g.label}</span>{g.note ? ` — ${g.note}` : ''}</div>)}</div>}
          {!tr && <div><b style={{ color: TF.text2 }}>Review queue:</b> {d.label} — {d.reason}</div>}
          <div><b style={{ color: TF.text2 }}>Next check:</b> {d.nextCheck}</div>
          {tr && tr.evidence.quote !== e.evidence_quote && e.evidence_quote && <div><b style={{ color: TF.text2 }}>Keyword proof sentence:</b> “{e.evidence_quote.slice(0, 240)}”</div>}
          {e.change_lines && e.change_lines.length > 0 && <div><b style={{ color: TF.text2 }}>Change lines read from management text:</b>{e.change_lines.slice(0, 5).map((l, i) => <div key={i} style={{ paddingLeft: 10 }}>• {l.slice(0, 220)}{l.length > 220 ? '…' : ''}</div>)}</div>}
          {e.evidence_record && <div><b style={{ color: TF.text2 }}>Evidence record:</b> {ROLE_WORD[role] || 'speaker unknown'} · period {e.evidence_record.fiscal_period || 'not stated in the quote'} · {e.evidence_record.verification.replace(/_/g, ' ').toLowerCase()}{e.evidence_record.missing.length ? ` · missing: ${e.evidence_record.missing.slice(0, 3).join(', ')}` : ''}</div>}
          {e.speakers_parsed != null && <div><b style={{ color: TF.text2 }}>Transcript:</b> {e.speakers_parsed ? `speakers identified; only management answers scored${e.analyst_share != null ? ` (analyst questions ${e.analyst_share}% of the text, ignored)` : ''}` : 'speakers could not be identified; whole text scored'}</div>}
          <div><b style={{ color: TF.text2 }}>Signals:</b> {e.patterns.slice(0, 8).map((p) => `${p.label}${p.hits > 1 ? ` ×${p.hits}` : ''}`).join(' · ') || 'none'} · proof step {e.evidence_score}/11 ({e.evidence_label}) · keyword score {e.transformation_score}</div>
          {e.caution_flags && e.caution_flags.length > 0 && <div style={{ color: TF.amber }}><b>Caution phrases:</b> {e.caution_flags.slice(0, 6).join(' · ')}</div>}
          {e.tier_source === 'document' && <div>Tone comes from the document text (the exchange feed had not graded this filing).</div>}
          {showFullSignals && e.top_events.length > 0 && <div style={{ ...TFM }}>Events: {e.top_events.join(' · ')}</div>}
        </div>
      </details>
      {/* zzz1219 — one company, one dossier: the company's other documents in this window, as dated evidence records */}
      {e.more_docs && e.more_docs.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ cursor: 'pointer', fontSize: RF.small, color: TF.muted, fontWeight: 800 }}>{e.more_docs.length} more document{e.more_docs.length === 1 ? '' : 's'} from {e.symbol} in this window</summary>
          <div style={{ fontSize: RF.small, color: TF.muted, lineHeight: 1.6, marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {e.more_docs.map((m, i) => (
              <div key={i} style={{ borderLeft: `3px solid ${TF.border}`, paddingLeft: 10 }}>
                <b style={{ color: TF.text2 }}>{(m.filing_datetime || '').slice(0, 10)}</b> · {m.doc_label || 'document'} · {m.evidence_label}{m.best ? ' · ★' : ''}
                {m.evidence_quote && <div style={{ color: TF.text2, fontStyle: 'italic' }}>“{m.evidence_quote.slice(0, 260)}{m.evidence_quote.length > 260 ? '…' : ''}”{m.quote_speaker ? ` — ${m.quote_speaker}` : ''}</div>}
                {m.proof && <div style={{ color: TF.dim }}>{m.proof}</div>}
                {m.attachment_url && <a href={m.attachment_url} target="_blank" rel="noopener noreferrer" style={{ color: TF.cyan, fontWeight: 800 }}>Open filing →</a>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
