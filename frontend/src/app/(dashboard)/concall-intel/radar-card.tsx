'use client';
// zzz1214 — one compact Transformation Radar card. The owner: "lot of text is crazy". The card now answers four
// questions in four short lines — what kind of change, is it in the numbers, is it priced in, what proves it — and
// folds everything else (ledger, next check, keyword chips, events) into "Details".
import type { TransformScreenEntry } from './types';
import type { ConvictionEntry } from '@/lib/conviction-beats';
import { TF, TFM, CONV_TIER_COLOR } from './constants';
import { radarDecision } from '@/lib/concall-radar-decision';

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
  if (tr.tier === 'WATCH') return 'Potential transformation: a structural change with something still unknown (see the ? checks). Research it; it is not proven.';
  return fallback;
}
const GATE_ICON: Record<string, string> = { PASS: '✓', FAIL: '✗', UNKNOWN: '?' };
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

function Fact({ title, verdict, text }: { title: string; verdict: string; text: string }) {
  const c = VERDICT_COLOR[verdict] || TF.dim;
  return (
    <div title={text} style={{ flex: '1 1 180px', minWidth: 0, background: TF.card2, border: `1px solid ${TF.border}`, borderTop: `2px solid ${c}`, borderRadius: 6, padding: '6px 9px' }}>
      <div style={{ fontSize: 9.5, color: TF.dim, fontWeight: 800, letterSpacing: '0.4px' }}>{title}</div>
      <div style={{ fontSize: 12, fontWeight: 800, color: c }}>{WORD[verdict] || verdict.toLowerCase()}</div>
      <div style={{ fontSize: 10.5, color: TF.muted, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{text}</div>
    </div>
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
  return (
    <div style={{ background: TF.card, border: `1px solid ${TF.border}`, borderLeft: `4px solid ${lane.color}`, borderRadius: 10, padding: '12px 14px' }}>
      {/* line 1 — who, which lane, how good */}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 900, color: TF.dim, ...TFM }}>#{rank}</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: TF.text }}>{e.symbol}</span>
          <span style={{ fontSize: 11.5, color: TF.muted, maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.company_name}</span>
          {/* zzz1226 — ONE label per card, from the tier: never "confirmed" on a name that is only on the research watch */}
          <span title={tierTip(tr, lane.tip)} style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: tr?.tier === 'CONFIRMED' ? '#7C2D12' : '#fff', background: tr?.tier === 'CONFIRMED' ? '#FDE68A' : tr?.tier === 'WATCH' ? '#8B5CF6' : lane.color }}>{tierLabel(tr, lane.label)}</span>
          {ins?.promising && <span title="Passes every best rule except one: the document has a contradiction (a positive and a negative statement) that must be read and reconciled first" style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 999, color: '#92400E', border: '1px solid #F59E0B' }}>◐ Promising — reconcile first</span>}
          {e.tone && <span title={`Management tone read from the document: ${e.tone_pos ?? 0} positive and ${e.tone_neg ?? 0} negative phrases`} style={{ fontSize: 10, fontWeight: 800, color: TONE_COLOR[e.tone] || TF.dim }}>● {e.tone.toLowerCase()} tone</span>}
          {inBook && <span style={{ fontSize: 9.5, fontWeight: 900, padding: '1px 6px', borderRadius: 3, border: '1px solid #34D399', color: '#047857' }}>📗 in my book</span>}
          {bench && <a href="/conviction-beats" style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 6px', borderRadius: 3, border: `1px solid ${CONV_TIER_COLOR[bench.tier] || TF.green}`, color: CONV_TIER_COLOR[bench.tier] || TF.green, textDecoration: 'none' }}>🏆 {bench.tier}</a>}
          <span style={{ fontSize: 10, color: TF.dim, ...TFM }}>{capCr != null ? `₹${Math.round(capCr).toLocaleString('en-IN')} Cr` : 'size n/a'}</span>
          {st != null && <span title="Weekly Stage Analysis (completed weeks)" style={{ fontSize: 10, fontWeight: 800, color: st === 2 ? TF.green : st === 4 ? TF.red : TF.dim }}>Stage {st}</span>}
        </div>
        {tr && (
          <div style={{ textAlign: 'right' }} title="Confidence in this reading: HIGH when every eligibility gate passes, MEDIUM with one unknown, LOW otherwise. The list is ranked by research state, then size, then confidence — not a score.">
            <div style={{ fontSize: 12, fontWeight: 900, color: lane.color, lineHeight: 1.1 }}>{tr.confidence.toLowerCase()} confidence</div>
            <div style={{ fontSize: 9, color: TF.dim }}>{tr.proofStage ? `proof stage: ${tr.proofStage}` : 'no proof stage'}</div>
          </div>
        )}
      </div>

      {/* zzz1224 — the card starts with the thesis and the evidence, in plain words */}
      {tr ? (
        <div style={{ marginTop: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ fontSize: 12, color: TF.text2, lineHeight: 1.5 }}>
            <b style={{ color: TF.text }}>Transformation thesis:</b> {tr.mechanismWord}. {tr.thesis.whatChanges}{' '}
            <span style={{ color: TF.muted }}>Earnings impact: {tr.thesis.earningsImpact}</span>
          </div>
          <div style={{ fontSize: 11.5, color: TF.text2, lineHeight: 1.5 }}>
            <b style={{ color: TF.text }}>Evidence:</b> “{tr.evidence.quote.length > 260 ? `${tr.evidence.quote.slice(0, 260)}…` : tr.evidence.quote}”
            <span style={{ color: TF.dim, fontSize: 10.5 }}> — {e.quote_speaker ? `${e.quote_speaker}, ` : ''}{ROLE_WORD[role] || 'speaker unknown'} · {date || 'date n/a'} · {tr.evidence.actual === 'ACTUAL' ? 'achieved' : 'plan'} · {tr.evidence.scope === 'UNKNOWN' ? 'scope not stated' : tr.evidence.scope.toLowerCase().replace('_', ' ')}</span>
            {tr.evidence.entity.ok !== true && <div style={{ color: TF.amber, fontSize: 10.5 }}>{tr.evidence.entity.note}</div>}
          </div>
          {tr.state !== 'ROUTINE' && tr.state !== 'INSUFFICIENT' && (
            <div style={{ fontSize: 10.5, color: TF.muted, lineHeight: 1.5 }}>
              <b style={{ color: TF.red }}>Key risk:</b> {tr.thesis.keyRisk} · <b style={{ color: TF.cyan }}>Next milestone:</b> {tr.thesis.nextMilestone}
              {tr.thesis.sectorCheck && <div style={{ color: TF.dim }}>{tr.thesis.sectorCheck}</div>}
            </div>
          )}
          {tr.contradiction && <div style={{ fontSize: 10.5, color: TF.amber }}>⚠ {tr.contradiction}</div>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tr.gates.map((g) => (
              <span key={g.key} title={g.note} style={{ fontSize: 9.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, border: `1px solid ${TF.border}`,
                color: g.result === 'PASS' ? TF.green : g.result === 'FAIL' ? TF.red : TF.amber }}>{GATE_ICON[g.result]} {g.label}</span>
            ))}
          </div>
        </div>
      ) : ins && <div style={{ fontSize: 12, color: TF.text2, marginTop: 6, lineHeight: 1.5 }}>{ins.headline}</div>}

      {/* line 3 — the three checks against market data */}
      {ins && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          <Fact title="RESULTS" verdict={ins.results.verdict} text={ins.results.text} />
          <Fact title="GUIDANCE" verdict={ins.guidance.verdict} text={ins.guidance.text} />
          <Fact title="VALUATION (context)" verdict={ins.valuation.gap} text={ins.valuation.text} />
        </div>
      )}
      {/* zzz1216 — three separate facts, never inferred from each other, plus how big the order is */}
      {!tr && ins?.checks && (
        <div style={{ fontSize: 10.5, color: TF.muted, marginTop: 6, lineHeight: 1.5 }}>
          <span style={{ color: ins.checks.transformation ? TF.green : TF.dim }}>{ins.checks.transformation ? '✓' : '✗'} business change seen</span>
          {' · '}<span style={{ color: ins.checks.growth ? TF.green : TF.dim }}>{ins.checks.growth ? '✓' : '✗'} growth in reported results</span>
          {' · '}<span style={{ color: TF.dim }}>✗ link between the two not proven</span>
          {ins.proof && <div title="Does the quoted sentence itself prove the named business event? A keyword elsewhere in the document is not proof." style={{ color: ins.proof.kind === 'MILESTONE' ? TF.green : TF.amber }}>{ins.proof.kind === 'MILESTONE' ? '✓' : '✗'} Proof sentence: {ins.proof.reason}</div>}
          {ins.materiality && <div title="Order value against annual sales (market cap ÷ P/S). Only an amount in the proof sentence is sized. Orders are not revenue until delivered.">{ins.materiality.text}</div>}
        </div>
      )}

      {/* line 4 — the proof, with who said it (zzz1224: only when the thesis block above is missing — older cached scans) */}
      {tr ? null : e.evidence_quote && quoteUsable && role !== 'ANALYST' ? (
        <div style={{ fontSize: 11.5, color: TF.text2, marginTop: 8, lineHeight: 1.5, borderLeft: `2px solid ${TF.cyan}`, paddingLeft: 8 }}>
          “<span style={{ display: '-webkit-inline-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.evidence_quote}</span>”
          <span style={{ color: TF.dim, fontSize: 10.5 }}> — {e.quote_speaker ? `${e.quote_speaker}, ` : ''}{ROLE_WORD[role] || 'speaker unknown'}{e.evidence_record?.fiscal_period ? ` · ${e.evidence_record.fiscal_period}` : ''}</span>
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: TF.dim, marginTop: 8 }}>
          {role === 'ANALYST' ? 'The strongest line was an analyst question — not used as proof.' : 'No clean management sentence to quote (slide table or broken text) — open the filing.'}
        </div>
      )}

      {/* zzz1226 — the business change and the results are two separate facts; the link is never assumed */}
      {tr && ins && (
        <div style={{ fontSize: 10.5, color: TF.muted, marginTop: 6 }}>
          Reported results: <span style={{ color: ins.checks.growth ? TF.green : TF.amber, fontWeight: 700 }}>{ins.checks.growth ? 'growing' : 'not growing'}</span>
          {' · '}link between the change and the results: <span style={{ color: TF.dim }}>not proven</span>
        </div>
      )}

      {/* line 5 — blockers, links */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 8, fontSize: 10.5 }}>
        {/* zzz1215 — a "best" card never carries a contradicting headline label; its open questions read as checks */}
        {tr
          ? (() => { const open = tr.gates.find((g) => g.result !== 'PASS'); return open ? <span title={open.note} style={{ fontWeight: 800, color: open.result === 'FAIL' ? TF.red : TF.amber }}>Next check: {open.label.toLowerCase()}</span> : <span style={{ fontWeight: 800, color: TF.green }}>All checks pass</span>; })()
          : ins?.best
            ? (d.queue === 'RECONCILE' || d.queue === 'RISK' ? <span title={d.reason} style={{ fontWeight: 800, color: TF.amber }}>Check: {(e.caution_flags || []).slice(0, 2).join(', ') || d.reason}</span> : null)
            : <span title={d.reason} style={{ fontWeight: 800, color: dColor }}>{d.label}</span>}
        {ins && ins.blockers.length > 0 && <span style={{ color: TF.dim }}>Holding back: {ins.blockers.slice(0, 3).join(' · ')}</span>}
        <span style={{ color: TF.dim }}>{e.doc_label ? `📄 ${e.doc_label}` : ''}{date ? ` · ${date}` : ''}</span>
        {e.attachment_url && <a href={e.attachment_url} target="_blank" rel="noopener noreferrer" style={{ color: TF.cyan, fontWeight: 800 }}>Open filing →</a>}
        <a href={`/company-lab?add=IN:${encodeURIComponent(e.symbol)}`} style={{ color: TF.cyan, fontWeight: 800 }}>Company Lab →</a>
      </div>

      <details style={{ marginTop: 6 }} open={showFullSignals}>
        <summary style={{ cursor: 'pointer', fontSize: 10.5, color: TF.dim, fontWeight: 700 }}>Details</summary>
        <div style={{ fontSize: 10.5, color: TF.muted, lineHeight: 1.6, marginTop: 6 }}>
          {!tr && <div><b style={{ color: TF.text2 }}>Review queue:</b> {d.label} — {d.reason}</div>}
          <div><b style={{ color: TF.text2 }}>Next check:</b> {d.nextCheck}</div>
          {tr && tr.evidence.quote !== e.evidence_quote && e.evidence_quote && <div><b style={{ color: TF.text2 }}>Keyword proof sentence:</b> “{e.evidence_quote.slice(0, 240)}”</div>}
          {e.change_lines && e.change_lines.length > 0 && <div><b style={{ color: TF.text2 }}>Change lines read from management text:</b>{e.change_lines.slice(0, 5).map((l, i) => <div key={i} style={{ paddingLeft: 8 }}>• {l.slice(0, 220)}{l.length > 220 ? '…' : ''}</div>)}</div>}
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
        <details style={{ marginTop: 4 }}>
          <summary style={{ cursor: 'pointer', fontSize: 10.5, color: TF.dim, fontWeight: 700 }}>{e.more_docs.length} more document{e.more_docs.length === 1 ? '' : 's'} from {e.symbol} in this window</summary>
          <div style={{ fontSize: 10.5, color: TF.muted, lineHeight: 1.55, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {e.more_docs.map((m, i) => (
              <div key={i} style={{ borderLeft: `2px solid ${TF.border}`, paddingLeft: 8 }}>
                <b style={{ color: TF.text2 }}>{(m.filing_datetime || '').slice(0, 10)}</b> · {m.doc_label || 'document'} · {m.evidence_label}{m.best ? ' · ★' : ''}
                {m.evidence_quote && <div style={{ color: TF.text2 }}>“{m.evidence_quote.slice(0, 220)}{m.evidence_quote.length > 220 ? '…' : ''}”{m.quote_speaker ? ` — ${m.quote_speaker}` : ''}</div>}
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
