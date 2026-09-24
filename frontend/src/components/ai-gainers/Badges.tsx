'use client';
// Small presentational pieces of the research triage UI.            (zzz770)

import React from 'react';
import type { ResearchItem } from '@/lib/ai-gainers/research-view';
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
  const s = SOURCE_META[it.sourceConfidence] || SOURCE_META.UNVERIFIED;
  return <Pill color={s.color} title={s.hover}>SOURCE: {s.label}</Pill>;
}

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
const POT_WORD: Record<string, string> = { YEARS: 'MULTI-YEAR', QUARTER: 'ONE PERIOD', DAYS: 'DAYS', UNKNOWN: 'UNKNOWN' };

export function FactLine({ it }: { it: ResearchItem }) {
  const st = STAGE_META[it.stage] || STAGE_META.UNKNOWN;
  const tr = TRANSMIT_META[it.transmission] || TRANSMIT_META.NONE;
  const pe = PERSIST_META[it.persistence] || PERSIST_META.UNKNOWN;
  const gap = GAP_META[it.expectationGap?.level || 'UNKNOWN'] || GAP_META.UNKNOWN;
  const ml = it.materiality?.label || 'UNKNOWN';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'baseline' }}>
      <Fact k="EVENT" v={it.eventLabel || it.eventType} />
      <Fact k="STAGE" v={st.label} title={st.hover} />
      <Fact k="MATERIAL" v={`${ml}${ml !== 'UNKNOWN' ? ' ⓘ' : it.materiality?.verification === 'PENDING' ? ' — PENDING DOCUMENT VERIFICATION' : ''}`} color={MATERIAL_COLOR[ml]} title={it.materiality?.verification === 'PENDING' ? it.materiality.explanation : materialityHover(it)} />
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
export function CatalystChips({ it }: { it: ResearchItem }) {
  const primary = it.catalysts?.[0];
  const pt = it.persistenceTest;
  return (
    <>
      {it.verification && /verification required/i.test(it.verification) && <Pill color={C.amber} title="Only a secondary source (press / summary) says this. It becomes evidence when an official filing confirms it.">SECONDARY · VERIFICATION REQUIRED</Pill>}
      {it.evidenceGap && <Pill color={it.evidenceGap.code === 'NO_CATALYST' ? C.faint : C.amber} title={it.evidenceGap.text}>{it.evidenceGap.label.toUpperCase()}</Pill>}
      {it.economicsUnknown && <Pill color={C.amber} title={it.economicsUnknown.missing.length ? `Missing: ${it.economicsUnknown.missing.join(', ')}` : 'The size of this event is not stated.'}>{it.economicsUnknown.label.toUpperCase()}</Pill>}
      {primary && <Pill color={STATE_COLOR[primary.state] || C.faint} title={`${primary.stateWord}${primary.previousState ? ` (was ${primary.previousState.toLowerCase()})` : ''}`}>CATALYST: {primary.state}{primary.previousState && primary.previousState !== primary.state ? ` (was ${primary.previousState})` : ''}</Pill>}
      {pt && <Pill color={GRADE_COLOR[pt.grade] || C.faint} title={pt.why}>PERSISTENCE: {pt.grade}</Pill>}
      {it.persistentCatalyst && it.persistentCatalyst.specialFocus && <Pill color={C.amber} title={it.persistentCatalyst.mechanism}>🔥 SPECIAL FOCUS</Pill>}
    </>
  );
}
