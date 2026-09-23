'use client';
// Small presentational pieces of the research triage UI.            (zzz770)

import React from 'react';
import type { ResearchItem } from '@/lib/ai-gainers/research-view';
import {
  C, CLASS_META, GAP_META, MATERIAL_COLOR, PERSIST_META, RELEVANCE_META, SOURCE_META, STAGE_META, TRANSMIT_META,
  materialityHover, money, moveColor, pct, tint, triageLabel, txt,
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
  return <Pill color={m.color} title={m.meaning}>{denial ? '🔴 COMPANY DENIAL' : m.pill}</Pill>;
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
      {it.flags?.dilution && <Pill color={C.amber} title="The event adds shares (warrants, preferential, QIP, offering). Per-share economics may dilute.">DILUTION</Pill>}
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
      <Fact k="MATERIAL" v={`${ml}${ml !== 'UNKNOWN' ? ' ⓘ' : ''}`} color={MATERIAL_COLOR[ml]} title={materialityHover(it)} />
      <Fact k="TRANSMIT" v={tr.label} title={tr.hover} />
      <Fact k="PERSIST" v={pe.label} title={pe.hover} />
      <Fact k="PRICED" v={gap.label} color={gap.color} title={txt(it.expectationGap?.text, 'Expectation gap unknown')} />
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
  const href = it.market === 'IN' ? `https://www.screener.in/company/${encodeURIComponent(it.ticker)}/` : null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 7, minWidth: 0, maxWidth: '100%' }}>
      {href
        ? <a href={href} target="_blank" rel="noopener noreferrer" title={`Open ${it.ticker} on screener.in`} style={{ fontSize: 14, fontWeight: 900, color: C.text, textDecoration: 'none' }}>{it.ticker}</a>
        : <b style={{ fontSize: 14, fontWeight: 900, color: C.text }}>{it.ticker}</b>}
      {it.company && (
        <span title={it.company} style={{ fontSize: 12, color: C.dim, maxWidth: max, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{it.company}</span>
      )}
    </span>
  );
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
