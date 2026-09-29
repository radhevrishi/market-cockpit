'use client';
// Small presentational pieces of the research triage UI.            (zzz770)

import React from 'react';
import type { ResearchItem } from '@/lib/ai-gainers/research-view';
import { stateWordFor } from '@/lib/ai-gainers/catalyst-timeline';
import {
  C, CATALYST_META, CLASS_META, GAP_META, MATERIAL_COLOR, PERSIST_META, RELEVANCE_META, SOURCE_META, STAGE_META, TRANSMIT_META,
  ageText, displayName, materialityHover, money, moveColor, pct, tint, triageLabel, txt,
} from './tokens';

export function Pill({ color, title, children, solid }: { color: string; title?: string; children: React.ReactNode; solid?: boolean }) {
  return (
    <span title={title} style={{
      display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 800, letterSpacing: 0.3,
      padding: '2px 7px', borderRadius: 4, whiteSpace: 'nowrap', lineHeight: 1.4,
      border: `1px solid ${color}`, background: tint(color, solid ? 22 : 10), color,
    }}>{children}</span>
  );
}

export function StatusPill({ it }: { it: ResearchItem }) {
  const m = CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST;
  const denial = it.eventClass === 'NEGATIVE' && it.flags?.denial;
  // zzz771: an exchange "no undisclosed information" clarification is the
  // company answering the exchange, not a denial of anything. It sits under
  // NO_CATALYST with flags.denial and is shown neutral — the owner read the
  // red NEGATIVE/DENIAL pill as bad news about the company.
  if (it.eventClass === 'NEGATIVE' && it.immaterialNegative) {
    return <Pill color={C.faint} title={it.materiality?.explanation || 'A tax / penalty item under 0.25% of market cap.'}>⚪ IMMATERIAL NEGATIVE</Pill>;
  }
  if (it.eventClass === 'NO_CATALYST' && it.flags?.denial) {
    return <Pill color={C.faint} title="The company told the exchange it has no undisclosed information behind the price move. A clarification, not negative evidence.">⚪ COMPANY: NO UNDISCLOSED INFO</Pill>;
  }
  // zzz776: the event can be verified while its SIGNIFICANCE is not — say
  // which of the two is open instead of calling a filed award "unverified".
  if (it.eventClass === 'POTENTIAL_UNVERIFIED') {
    const filed = it.sourceConfidence === 'VERIFIED_DOCUMENT' || it.sourceConfidence === 'VERIFIED_FILING';
    return filed
      ? <Pill color={m.color} title="The event is on file with the exchange; its size / materiality — and whether it explains the move — is not established.">🟡 EVENT FILED · IMPACT UNKNOWN</Pill>
      : <Pill color={m.color} title="Only a secondary summary or subject line — the event itself is not verified from a primary document.">🟡 POTENTIAL · SOURCE UNVERIFIED</Pill>;
  }
  return <Pill color={m.color} title={m.meaning}>{denial ? '🔴 COMPANY DENIAL' : m.pill}</Pill>;
}

/** zzz771: THIS MOVE / RECENT (9d) / CONTEXT (47d). Absent field → nothing:
 *  a stored finding from before the field existed must not be guessed at. */
export function CatalystForBadge({ it }: { it: ResearchItem }) {
  const k = it.catalystFor;
  const m = k ? CATALYST_META[k] : null;
  if (!m) return null;
  const age = ageText(it);
  const label = k === 'THIS_MOVE' ? m.label : age ? `${m.label} (${age})` : m.label;
  return <Pill color={m.color} title={m.hover}>{label}</Pill>;
}

/** zzz771: the card-level marker for the "Older filings" section — the reader
 *  must never mistake one of these for the event behind today's move. */
export function OlderContextBadge({ it }: { it: ResearchItem }) {
  const age = ageText(it);
  return <Pill color={C.faint} solid title="A real filing, but older than the move window. Context for the name, not the catalyst for this move.">OLDER CONTEXT{age ? ` · ${age}` : ''}</Pill>;
}

export function TriagePill({ it }: { it: ResearchItem }) {
  const t = triageLabel(it);
  return <Pill color={t.color} solid title="What kind of attention this deserves. Not a trade instruction.">{t.label.toUpperCase()}</Pill>;
}

export function SourceBadge({ it }: { it: ResearchItem }) {
  // zzz798 (US): one source label per card, read from the SEC documents —
  // "VERIFIED DOCUMENT (SEC 8-K, filed …)" or "PRESS ONLY — no SEC filing found yet".
  const us = it.market === 'US' ? it.usCard : null;
  if (us && us.source.tier !== 'NONE') {
    const sec = us.source.tier === 'SEC';
    return <Pill color={sec ? C.green : C.amber} title={sec ? `Read from the SEC filing itself (no AI).${us.source.doc ? ` Figures from: ${us.source.doc}.` : ''}` : 'Only press / news coverage. No 8-K, 6-K, 10-Q, offering or 13D was found on SEC EDGAR for this event yet.'}>SOURCE: {us.source.label}</Pill>;
  }
  const s = SOURCE_META[it.sourceConfidence] || SOURCE_META.UNVERIFIED;
  return <Pill color={s.color} title={s.hover}>SOURCE: {s.label}</Pill>;
}

/** zzz798: the materiality word the owner reads — HIGH / MODERATE / SMALL on US cards. */
export const materialWord = (it: ResearchItem): string => {
  const l = it.materiality?.label || 'UNKNOWN';
  return it.market === 'US' && it.usCard && l === 'SIGNIFICANT' ? 'HIGH' : l;
};

export function RelevanceBadge({ it }: { it: ResearchItem }) {
  const r = RELEVANCE_META[it.portfolio?.relevance || 'UNRELATED'];
  if (!r) return null;
  return <Pill color={r.color} title={txt(it.portfolio?.note, 'Portfolio relevance')}>{r.label}</Pill>;
}

export function BandChip({ it }: { it: ResearchItem }) {
  if (it.flags?.band == null) return null;
  const turnover = it.flags.turnover != null ? ` · AVG ${money(it.flags.turnover, it.market)}/day` : '';
  return <Pill color={C.faint} title="Price-band movement. Does not establish demand.">BAND {it.flags.band}%{turnover}</Pill>;
}

export function FlagChips({ it }: { it: ResearchItem }) {
  return (
    <>
      <BandChip it={it} />
      {/* zzz771: colour follows the event class — a preferential allotment to a named fund is a
          POTENTIAL / low-materiality financing, not a red negative. */}
      {it.flags?.dilution && <Pill color={(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).color} title="The event adds shares (warrants, preferential, QIP, offering). Per-share economics may dilute.">DILUTION</Pill>}
      {it.flags?.listing && <Pill color={C.faint} title="Recent listing — no comparable prior close; the size of the move is unreliable.">RECENT LISTING</Pill>}
    </>
  );
}

/** Label: VALUE with a hover — the compact fact line on a card. */
export function Fact({ k, v, color, title }: { k: string; v: React.ReactNode; color?: string; title?: string }) {
  return (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5, fontSize: 12, whiteSpace: 'nowrap', cursor: title ? 'help' : undefined }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>{k}</span>
      <span style={{ fontWeight: 800, color: color || C.text }}>{v}</span>
    </span>
  );
}

// zzz787: "Medium" is one filing period of evidence; "Strong" needs two or more.
const PERSIST_EV_WORD: Record<string, string> = {
  STRONG: 'STRONG', EVIDENCE: 'MEDIUM', EARLY: 'EARLY', UNPROVEN: 'UNPROVEN', NOT_PERSISTENT: 'NOT PERSISTENT', NONE: '—',
};
const POT_WORD: Record<string, string> = { YEARS: 'MULTI-YEAR', QUARTER: 'ONE PERIOD', DAYS: 'DAYS', UNKNOWN: 'NOT ESTABLISHED' };

export function FactLine({ it }: { it: ResearchItem }) {
  const st = STAGE_META[it.stage] || STAGE_META.UNKNOWN;
  const tr = TRANSMIT_META[it.transmission] || TRANSMIT_META.NONE;
  const pe = PERSIST_META[it.persistence] || PERSIST_META.UNKNOWN;
  const gap = GAP_META[it.expectationGap?.level || 'UNKNOWN'] || GAP_META.UNKNOWN;
  const ml = it.materiality?.label || 'UNKNOWN';
  const usCard = it.market === 'US' ? it.usCard : null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'baseline' }}>
      <Fact k="EVENT" v={it.eventLabel || it.eventType} />
      <Fact k="STAGE" v={usCard?.stageText ? `${st.label} · ${usCard.stageText.toUpperCase()}` : st.label} title={st.hover} />
      {usCard
        ? <Fact k="MATERIAL" v={`${materialWord(it)} · ⓘ how computed`} color={MATERIAL_COLOR[ml]} title={materialityHover(it)} />
        : <Fact k="MATERIAL" v={`${ml}${ml !== 'UNKNOWN' ? ' ⓘ' : it.materiality?.verification === 'PENDING' ? ' — PENDING DOCUMENT VERIFICATION' : ''}`} color={MATERIAL_COLOR[ml]} title={it.materiality?.verification === 'PENDING' ? it.materiality.explanation : materialityHover(it)} />}
      <Fact k="TRANSMIT" v={tr.label} title={tr.hover} />
      {/* zzz787: four duration concepts, never merged — contractual (only when stated),
          potential economic duration (NOT evidence), persistence evidence, catalyst state. */}
      {it.durations?.contractual && <Fact k="CONTRACTUAL DURATION" v={/runway: ([^(]+)/i.exec(it.durations.contractual)?.[1]?.trim().toUpperCase() || 'STATED'} color={C.cyan} title={it.durations.contractual} />}
      <Fact k="POTENTIAL ECONOMIC DURATION" v={`${it.potentialDuration ? POT_WORD[it.potentialDuration.value] || pe.label : pe.label}${it.potentialDuration?.basis === 'TYPE' ? ' (BY TYPE)' : ''}`} color={C.faint}
        title={`${it.potentialDuration?.text || pe.hover} — what the nature of the event COULD support. Not evidence that it will.${it.durations?.guard ? ` ${it.durations.guard}` : ''}`} />
      {it.persistenceEvidence && it.persistenceEvidence.level !== 'NONE' && (
        <Fact k="PERSISTENCE EVIDENCE" v={PERSIST_EV_WORD[it.persistenceEvidence.level]} color={it.persistenceEvidence.level === 'STRONG' ? C.green : it.persistenceEvidence.level === 'EVIDENCE' ? C.cyan : it.persistenceEvidence.level === 'NOT_PERSISTENT' ? C.faint : C.amber} title={it.persistenceEvidence.text} />
      )}
      {it.durations?.catalystState && <Fact k="CATALYST STATE" v={it.durations.catalystState.split(' (')[0].split(' — ')[0].toUpperCase()} title={it.durations.catalystState} />}
      {/* zzz785: a pricing assessment only when the event's economics are known. */}
      {it.pricing && ml === 'UNKNOWN'
        ? <Fact k="PRICED" v="NOT ASSESSED" color={C.faint} title="The event's size is unknown, so the price reaction is not compared with anything. Price is context only." />
        : it.pricing
        ? <Fact k="PRICED" v={it.pricing.label} color={it.pricing.state === 'REACTION_SMALL_VS_SIZE' ? C.green : it.pricing.state === 'REACTION_EXCEEDS_SIZE' || it.pricing.state === 'RAN_UP_BEFORE_FILING' ? C.amber : undefined} title={it.pricing.text} />
        : <Fact k="PRICED" v={gap.label} color={gap.color} title={txt(it.expectationGap?.text, 'Expectation gap unknown')} />}
    </div>
  );
}

export function Move({ it, big }: { it: ResearchItem; big?: boolean }) {
  const r = it.returns || { w1: null, m1: null, m3: null };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap' }}>
      <span title="1-day move — context only, never the ranking" style={{ fontSize: big ? 15 : 13, fontWeight: 900, color: moveColor(it.move1d) }}>{pct(it.move1d)}</span>
      <span style={{ fontSize: 11, color: C.faint, whiteSpace: 'nowrap' }}>
        1W {pct(r.w1)} · 1M {pct(r.m1)} · 3M {pct(r.m3)}
      </span>
    </span>
  );
}

export function Name({ it, max = 220 }: { it: ResearchItem; max?: number }) {
  // zzz771: title is displayTicker || ticker (a BSE scrip code is never the
  // title when the pipeline supplied the name); the code sits small beside it.
  const { title, code, company } = displayName(it);
  const href = it.market === 'IN' ? `https://www.screener.in/company/${encodeURIComponent(it.ticker)}/` : null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, minWidth: 0, maxWidth: '100%' }}>
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer" title={`Open ${it.ticker} on screener.in`} style={{ fontSize: 14, fontWeight: 900, color: C.text, textDecoration: 'none' }}>{title}</a>
        : <b style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{title}</b>}
      {code && <span title="Exchange scrip code" style={{ fontSize: 11, fontWeight: 700, color: C.faint, letterSpacing: 0.3 }}>{code}</span>}
      {company && (
        <span title={company} style={{ fontSize: 12, color: C.dim, maxWidth: max, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{company}</span>
      )}
    </span>
  );
}

/** zzz771: for NO_CATALYST rows — what was actually scanned, so "no catalyst"
 *  is never read as "nothing happened". Absent → nothing. */
export function ScanNote({ it }: { it: ResearchItem }) {
  const n = txt(it.scanNote, '');
  if (!n) return null;
  return <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.45 }}><span style={{ fontWeight: 800, letterSpacing: 0.4, marginRight: 6 }}>SCANNED</span>{n}</div>;
}

export function Btn({ onClick, href, children, title, color }: { onClick?: () => void; href?: string | null; children: React.ReactNode; title?: string; color?: string }) {
  const style: React.CSSProperties = {
    fontSize: 12, fontWeight: 800, letterSpacing: 0.3, padding: '4px 10px', borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${color || C.border}`, background: 'transparent', color: color || C.dim, textDecoration: 'none',
    whiteSpace: 'nowrap', display: 'inline-block', lineHeight: 1.4,
  };
  if (href) return <a href={href} target="_blank" rel="noopener noreferrer" title={title || href} style={style}>{children}</a>;
  return <button type="button" onClick={onClick} title={title} style={style}>{children}</button>;
}

export function SectionHead({ title, count, sub, right }: { title: string; count?: number; sub?: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 900, letterSpacing: 0.6, color: C.text }}>
        {title}{typeof count === 'number' ? <span style={{ color: C.faint }}> · {count}</span> : null}
      </h2>
      {sub && <span style={{ fontSize: 12, color: C.faint }}>{sub}</span>}
      {right && <span style={{ marginLeft: 'auto' }}>{right}</span>}
    </div>
  );
}

/** zzz785: the plain-English status chips a card adds — verification,
 *  evidence gap, unknown economics, catalyst state, persistence grade. */
const GRADE_COLOR: Record<string, string> = { HIGH: C.green, MEDIUM: C.cyan, EARLY: C.amber, TEMPORARY: C.faint };
const STATE_COLOR: Record<string, string> = { IDENTIFIED: C.amber, DOCUMENTED: C.cyan, EXECUTING: C.cyan, CONFIRMED: C.green, WEAKENING: C.amber, DISPROVED: C.red };
const STAGE_BADGE_COLOR: Record<string, string> = { PROPOSED: C.amber, SIGNED: C.cyan, AWARDED: C.cyan, EXECUTED: C.green, COMPLETED: C.green };
const STAGE_HOVER: Record<string, string> = {
  PROPOSED: 'Proposed / non-binding / subject to approval - not firm, not booked.', SIGNED: 'Agreement signed; economics may still be pending.',
  AWARDED: 'Order / contract awarded; execution ahead.', EXECUTED: 'Done, not proposed.', COMPLETED: 'The transaction has completed.',
};
export function CatalystChips({ it }: { it: ResearchItem }) {
  const primary = it.catalysts?.[0];
  const pt = it.persistenceTest;
  return (
    <>
      {it.verification && /verification required/i.test(it.verification) && !(it.market === 'US' && it.usCard) && <Pill color={C.amber} title="Only a secondary source (press / summary) says this. It becomes evidence when an official filing confirms it.">SECONDARY · VERIFICATION REQUIRED</Pill>}
      {it.evidenceGap && <Pill color={it.evidenceGap.code === 'NO_CATALYST' ? C.faint : C.amber} title={it.evidenceGap.text}>{it.evidenceGap.label.toUpperCase()}</Pill>}
      {it.economicsUnknown && <Pill color={C.amber} title={it.economicsUnknown.missing.length ? `Missing: ${it.economicsUnknown.missing.join(', ')}` : 'The size of this event is not stated.'}>{it.economicsUnknown.label.toUpperCase()}</Pill>}
      {it.conflicts && it.conflicts.length > 0 && (
        <Pill color={C.red} solid title={`${it.conflicts.join('\n')}\nImpact is unknown until the values are confirmed. Unknown is not negative.`}>VALUES CONFLICT</Pill>
      )}
      {it.stageBadge && <Pill color={STAGE_BADGE_COLOR[it.stageBadge] || C.faint} title={STAGE_HOVER[it.stageBadge]}>{it.stageBadge}</Pill>}
      {it.contextOnly && <Pill color={C.faint} solid title={it.causalLabel || 'Older than the causal window: context for the name, not this move’s catalyst.'}>CONTEXT ONLY</Pill>}
      {it.catalystConfirmation && (
        <Pill color={it.catalystConfirmation === 'confirmed_in_official_filing' ? C.green : it.catalystConfirmation === 'filed_document_unread' ? C.cyan : it.catalystConfirmation === 'press_unconfirmed' ? C.amber : C.faint} title="Is the event in an official filing that was read? Reading the document and confirming the event are two separate facts.">{(it.catalystConfirmationLabel || it.catalystConfirmation).toUpperCase()}</Pill>
      )}
      {primary && <Pill color={STATE_COLOR[primary.state] || C.faint} title={`${stateWordFor(primary.stateWord, it.catalystConfirmation)}${primary.previousState ? ` (was ${primary.previousState.toLowerCase()})` : ''}`}>CATALYST: {primary.state}{primary.previousState && primary.previousState !== primary.state ? ` (was ${primary.previousState})` : ''}</Pill>}
      {/* zzz789: EARLY reads as Early / unproven — never a verdict, never negative. */}
      {pt && <Pill color={GRADE_COLOR[pt.grade] || C.faint} title={pt.why}>PERSISTENCE: {pt.grade === 'EARLY' ? 'EARLY / UNPROVEN' : pt.grade}</Pill>}
      {it.persistentCatalyst && it.persistentCatalyst.specialFocus && <Pill color={C.amber} title={it.persistentCatalyst.mechanism}>🔥 SPECIAL FOCUS</Pill>}
    </>
  );
}

// ── zzz801 (US only): CATALYSTS FOUND ─────────────────────────────────────
// The event taxonomy's list: label · category · source (SEC / press only) ·
// date, the evidence sentence, and a figure only when the sentence states it.
// The arrow is a direction HINT for the reader, never a trade instruction.
// v1 cards (no list) render nothing; an empty list says so plainly.

const DIR_MARK: Record<string, { mark: string; color: string; word: string }> = {
  positive: { mark: '▲', color: C.green, word: 'reads positive' },
  negative: { mark: '▼', color: C.red, word: 'reads negative' },
  mixed: { mark: '◆', color: C.amber, word: 'mixed' },
  neutral: { mark: '◆', color: C.faint, word: 'neutral' },
};

export function UsCatalystList({ it, compact, max = 5 }: { it: ResearchItem; compact?: boolean; max?: number }) {
  const us = it.market === 'US' ? it.usCard : null;
  if (!us || !Array.isArray(us.catalysts)) return null;
  const cs = us.catalysts;
  const k: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint };
  if (!cs.length) {
    return <div data-testid="us-catalysts-none" style={{ fontSize: 12, color: C.faint }}>No catalyst found in filings or news.</div>;
  }
  if (compact) {
    return (
      <div data-testid="us-catalysts-compact" style={{ fontSize: 12, color: C.dim }}>
        <span style={{ ...k, marginRight: 6 }}>FOUND</span>
        {cs.slice(0, 3).map((c, i) => (
          <span key={c.id} title={`“${c.sentence}”`}>{i ? ' · ' : ''}<b style={{ color: C.text }}>{c.label}</b> ({c.source === 'SEC' ? 'SEC' : 'press only'}{c.figures[0] ? `, ${c.figures[0]}` : ''})</span>
        ))}
        {cs.length > 3 && <span style={{ color: C.faint }}> · +{cs.length - 3} more</span>}
      </div>
    );
  }
  return (
    <div data-testid="us-catalysts" style={{ background: C.bg2, borderRadius: 6, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={k}>CATALYSTS FOUND ({cs.length})</div>
      {cs.slice(0, max).map((c) => {
        const d = DIR_MARK[c.direction] || DIR_MARK.neutral;
        return (
          <div key={c.id} style={{ fontSize: 12.5, lineHeight: 1.45, color: C.dim, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 7px', alignItems: 'baseline' }}>
              <span title={`Direction hint: ${d.word} — not a trade instruction.`} style={{ color: d.color, fontWeight: 900 }}>{d.mark}</span>
              <b style={{ color: C.text }}>{c.label}{c.planned ? ' (planned)' : ''}</b>
              <span style={{ color: C.faint }}>{c.category}</span>
              <Pill color={c.source === 'SEC' ? C.cyan : C.amber} title={c.sourceLabel}>{c.source === 'SEC' ? 'SEC' : 'PRESS ONLY — NOT VERIFIED IN A FILING'}</Pill>
              {c.date && <span style={{ color: C.faint, fontSize: 11 }}>{c.date}</span>}
              {c.figures.length > 0 && <span style={{ color: C.text, fontWeight: 700 }}>stated: {c.figures.join(', ')}</span>}
            </div>
            <div style={{ fontStyle: 'italic', overflowWrap: 'anywhere' }}>
              {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: C.dim, textDecoration: 'none' }}>“{c.sentence}”</a> : <>“{c.sentence}”</>}
            </div>
          </div>
        );
      })}
      {cs.length > max && <div style={{ fontSize: 11.5, color: C.faint }}>+{cs.length - max} more in OPEN EVENT</div>}
    </div>
  );
}

// ── zzz803 (India only): CATALYSTS FOUND ──────────────────────────────────
// The India taxonomy's list: label · category · source (exchange filing vs
// "reported, not confirmed by the company") · date, the evidence sentence,
// and a figure only when the sentence states it. The latest quarterly result
// is shown as the BACKDROP (dated); a price / volume clarification as the
// event it is; routine filings are named, never counted as catalysts. The
// arrow is a direction HINT, never a trade instruction. An empty card says
// plainly "No catalyst found in filings or news".

export function InCatalystList({ it, compact, max = 5 }: { it: ResearchItem; compact?: boolean; max?: number }) {
  const card = it.market === 'IN' ? it.inCard : null;
  if (!card || !Array.isArray(card.catalysts)) return null;
  const cs = card.catalysts.filter((c) => c.id !== 'price_clarification' && c.id !== 'exchange_query');
  const bd = card.backdrop;
  const cl = card.clarification;
  const k: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint };
  // A sentence the card already shows (headline / WHAT CHANGED / quote) is not printed again — one event, one rendering.
  const shownAlready = `${it.headline || ''} ${it.whatChanged || ''} ${it.quote || ''}`;
  const repeated = (sentence: string) => sentence.length >= 20 && shownAlready.includes(sentence.slice(0, 50).replace(/…$/, ''));
  const srcPill = (c: { source: string; confirmedByFiling: boolean; sourceLabel: string }) => (
    <Pill color={c.source === 'FILING' ? C.cyan : c.confirmedByFiling ? C.cyan : C.amber} title={c.sourceLabel}>
      {c.source === 'FILING' ? 'EXCHANGE FILING' : c.confirmedByFiling ? 'PRESS · ALSO FILED' : 'REPORTED, NOT CONFIRMED BY THE COMPANY'}
    </Pill>
  );
  if (!cs.length && !bd && !cl) {
    return (
      <div data-testid="in-catalysts-none" style={{ fontSize: 12, color: C.faint }}>
        No catalyst found in filings or news.{card.routine.length > 0 && <> Routine only: {Array.from(new Set(card.routine.map((r) => r.label.toLowerCase()))).slice(0, 3).join(', ')}.</>}
      </div>
    );
  }
  if (compact) {
    return (
      <div data-testid="in-catalysts-compact" style={{ fontSize: 12, color: C.dim }}>
        <span style={{ ...k, marginRight: 6 }}>FOUND</span>
        {cs.slice(0, 3).map((c, i) => (
          <span key={`${c.source}-${c.id}`} title={repeated(c.sentence) ? undefined : `“${c.sentence}”`}>{i ? ' · ' : ''}<b style={{ color: C.text }}>{c.label}</b> ({c.source === 'FILING' ? 'filed' : c.confirmedByFiling ? 'press, also filed' : 'reported, not confirmed'}{c.figures[0] ? `, ${c.figures[0]}` : ''})</span>
        ))}
        {cs.length > 3 && <span style={{ color: C.faint }}> · +{cs.length - 3} more</span>}
        {bd && <span title={bd.lead && !repeated(bd.lead.sentence) ? `“${bd.lead.sentence}”` : undefined}>{cs.length ? ' · ' : ''}<b style={{ color: C.text }}>Backdrop:</b> {bd.label}</span>}
        {cl && !cs.length && <span>{bd ? ' · ' : ''}<b style={{ color: C.text }}>Exchange clarification</b> — company says no undisclosed information</span>}
      </div>
    );
  }
  return (
    <div data-testid="in-catalysts" style={{ background: C.bg2, borderRadius: 6, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <div style={k}>CATALYSTS FOUND ({cs.length})</div>
      {cs.slice(0, max).map((c) => {
        const d = DIR_MARK[c.direction] || DIR_MARK.neutral;
        return (
          <div key={`${c.source}-${c.id}`} style={{ fontSize: 12.5, lineHeight: 1.45, color: C.dim, minWidth: 0 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 7px', alignItems: 'baseline' }}>
              <span title={`Direction hint: ${d.word} — not a trade instruction.`} style={{ color: d.color, fontWeight: 900 }}>{d.mark}</span>
              <b style={{ color: C.text }}>{c.label}{c.planned ? (c.source === 'PRESS' ? ' (reported plan)' : ' (proposed)') : ''}</b>
              <span style={{ color: C.faint }}>{c.category}</span>
              {srcPill(c)}
              {c.date && <span style={{ color: C.faint, fontSize: 11 }}>{c.date}</span>}
              {c.figures.length > 0 && <span style={{ color: C.text, fontWeight: 700 }}>stated: {c.figures.join(', ')}</span>}
              {c.note && <span style={{ color: C.amber, fontSize: 11.5 }}>{c.note}</span>}
            </div>
            {!repeated(c.sentence) && (
              <div style={{ fontStyle: 'italic', overflowWrap: 'anywhere' }}>
                {c.url ? <a href={c.url} target="_blank" rel="noopener noreferrer" style={{ color: C.dim, textDecoration: 'none' }}>“{c.sentence}”</a> : <>“{c.sentence}”</>}
              </div>
            )}
          </div>
        );
      })}
      {cs.length > max && <div style={{ fontSize: 11.5, color: C.faint }}>+{cs.length - max} more in OPEN EVENT</div>}
      {bd && (
        <div data-testid="in-backdrop" style={{ fontSize: 12.5, lineHeight: 1.45, color: C.dim }}>
          <span style={{ ...k, marginRight: 6 }}>BACKDROP</span><b style={{ color: C.text }}>{bd.label}</b>
          {bd.lead && <> — {bd.lead.source === 'PRESS' ? 'press: ' : ''}{!repeated(bd.lead.sentence) && <i>“{bd.lead.sentence}”</i>}{bd.lead.figures.length > 0 && <b style={{ color: C.text }}> stated: {bd.lead.figures.join(', ')}</b>}{bd.lead.note && <span style={{ color: C.amber }}> ({bd.lead.note})</span>}</>}
        </div>
      )}
      {cl && (
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: C.dim }}>
          <span style={{ ...k, marginRight: 6 }}>EXCHANGE CLARIFICATION</span>{cl.date ? `${cl.date} — ` : ''}company says no undisclosed information. <i>“{cl.sentence}”</i>
        </div>
      )}
      {card.routine.length > 0 && <div style={{ fontSize: 11.5, color: C.faint }}>Routine (not catalysts): {Array.from(new Set(card.routine.map((r) => r.label.toLowerCase()))).slice(0, 4).join(', ')}</div>}
    </div>
  );
}

// ── zzz835: the card facts, market-agnostic ────────────────────────────────
// Conflicting values (both named), clusters (one earnings filing = one cluster
// with child facts), clinical facts, acquisition economics, the litigation
// caveat, the causal-window verdict and what was searched. Every block renders
// only when the item carries it; a missing field is named "Not stated", never
// blank, never zero.

const kS: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint };
const NS = 'Not stated';
function KV({ rows }: { rows: Array<[string, string | null | undefined]> }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 320 }}><tbody>
        {rows.map(([k, v]) => (
          <tr key={k}><td style={{ ...kS, padding: '2px 10px 2px 0', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{k.toUpperCase()}</td><td style={{ fontSize: 12.5, color: v ? C.text : C.faint, padding: '2px 0', overflowWrap: 'anywhere' }}>{txt(v, NS)}</td></tr>
        ))}
      </tbody></table>
    </div>
  );
}

export function CardFacts({ it }: { it: ResearchItem }) {
  const conf = it.conflicts && it.conflicts.length ? it.conflicts : null;
  const cl = it.clinical;
  const ac = it.acquisition;
  const cs = it.clusters;
  const box: React.CSSProperties = { background: C.bg2, borderRadius: 6, padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 };
  return (
    <>
      {conf && (
        <div data-testid="conflict-box" style={{ ...box, border: `1px solid ${C.red}`, background: tint(C.red, 8) }}>
          <div style={{ ...kS, color: C.red }}>VALUES CONFLICT - IMPACT UNKNOWN</div>
          {conf.map((c, i) => <div key={i} style={{ fontSize: 12.5, color: C.text, lineHeight: 1.45 }}>{c}</div>)}
          {it.conflictValues && it.conflictValues.length > 0 && (
            <div style={{ fontSize: 12, color: C.dim }}>Values seen: {it.conflictValues.map((v) => `${v.text} (${v.source})`).join(' vs ')}. Neither is used for sizing until confirmed. Unknown is not negative.</div>
          )}
        </div>
      )}
      {it.contextOnly && (
        <div data-testid="context-only" style={{ fontSize: 12.5, color: C.dim }}><span style={{ ...kS, marginRight: 6 }}>CONTEXT ONLY</span>{txt(it.causalLabel, 'Older than the causal window.')} It is not shown as this move’s catalyst.</div>
      )}
      {!it.contextOnly && it.causalLabel && <div style={{ fontSize: 12, color: C.faint }}>{it.causalLabel}</div>}
      {it.litigationNote && (
        <div data-testid="litigation-note" style={{ fontSize: 12.5, color: C.amber, lineHeight: 1.45 }}><span style={{ ...kS, marginRight: 6 }}>LITIGATION</span>{it.litigationNote}{it.litigation && <> Appeal: {txt(it.litigation.appeal, NS)}. Collectability: {txt(it.litigation.collectability, NS)}. Company’s share: {txt(it.litigation.entitlement, NS)}.</>}</div>
      )}
      {cl && (
        <div data-testid="clinical-facts" style={box}>
          <div style={kS}>CLINICAL FACTS{cl.result ? ` · RESULT: ${cl.result.toUpperCase()}` : ''}</div>
          <KV rows={[['Indication', cl.indication], ['Phase', cl.phase], ['Primary endpoint', cl.primaryEndpoint], ['Endpoint met', cl.endpointMet === 'not_stated' ? null : cl.endpointMet.replace('_', ' ')], ['Effect size', cl.effectSize], ['p-value', cl.pValue], ['Confidence interval', cl.confidenceInterval], ['Sample size', cl.sampleSize], ['Comparator', cl.comparator], ['Dosing', cl.dosingInterval], ['Safety', cl.safety], ['Next step', cl.nextStep]]} />
        </div>
      )}
      {ac && (
        <div data-testid="acquisition-economics" style={box}>
          <div style={kS}>ACQUISITION ECONOMICS</div>
          <KV rows={[['Purchase price', ac.purchasePrice], ['Upfront cash', ac.upfrontCash], ['Contingent', ac.contingentConsideration], ['Assumed liabilities', ac.assumedLiabilities], ['Financing', ac.financing], ['Expected contribution', ac.expectedContribution]]} />
        </div>
      )}
      {cs && cs.length > 0 && (
        <div data-testid="clusters" style={box}>
          <div style={kS}>{cs.length === 1 ? 'ONE FILING · ONE EVENT' : `${cs.length} EVENTS`} (child facts grouped under their filing)</div>
          {cs.map((k) => (
            <div key={k.clusterId} style={{ fontSize: 12.5, color: C.dim, lineHeight: 1.45, minWidth: 0 }}>
              <b style={{ color: C.text }}>{k.label}</b> <span style={{ color: C.faint }}>· {k.independentSources} independent source{k.independentSources === 1 ? '' : 's'}</span>
              {k.children.length > 0 && (
                <ul style={{ margin: '2px 0 0', paddingLeft: 16 }}>
                  {k.children.slice(0, 6).map((c, i) => <li key={i}><b style={{ color: C.text }}>{c.label}</b>{c.figures.length ? <span> - stated: {c.figures.join(', ')}</span> : null}</li>)}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}
      {it.catalystStatusSentence && (
        <div data-testid="catalyst-status" style={{ fontSize: 12, color: C.faint, lineHeight: 1.45 }}>
          <span style={{ ...kS, marginRight: 6 }}>SEARCHED</span>{it.catalystStatusSentence}
          {it.searched && it.searched.sources.length > 0 && !it.catalystStatusSentence.includes(it.searched.sources[0]) && <> Sources: {it.searched.sources.join(', ')}{it.searched.lookbackDays != null ? `, last ${it.searched.lookbackDays} days` : ''}.</>}
        </div>
      )}
    </>
  );
}
