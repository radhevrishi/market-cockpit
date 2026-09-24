'use client';
// EVENT DETAIL — the full research note for one event, opened on demand.
// Everything unknown says so; the raw evidence sits at the bottom. (zzz770)

import React, { useEffect } from 'react';
import type { ResearchItem } from '@/lib/ai-gainers/research-view';
import { Btn, CatalystForBadge, FlagChips, Move, Name, OlderContextBadge, RelevanceBadge, ScanNote, SourceBadge, StatusPill, TriagePill } from './Badges';
import { EarningsStrip, ScoreDetails, WhatChanged } from './ResearchCard';
import { C, GAP_META, MATERIAL_COLOR, PERSIST_META, SOURCE_META, STAGE_META, TRANSMIT_META, money, pct, txt } from './tokens';

const H = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.6, color: C.faint, marginTop: 14, marginBottom: 4 }}>{children}</div>
);
const P = ({ children, dim }: { children: React.ReactNode; dim?: boolean }) => (
  <div style={{ fontSize: 13, lineHeight: 1.55, color: dim ? C.dim : C.text }}>{children}</div>
);

const CHAIN_STEPS = ['EVENT', 'DRIVER', 'REVENUE', 'MARGIN', 'EPS / FCF', 'VALUATION'];

export function TransmissionChain({ chain }: { chain: string[] }) {
  const steps = CHAIN_STEPS.map((k, i) => ({ k, v: txt(chain?.[i], i === CHAIN_STEPS.length - 1 ? 'TBD' : 'Not disclosed') }));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'stretch' }}>
      {steps.map((s, i) => {
        const unknown = /^(tbd|not disclosed|unknown)/i.test(s.v);
        return (
          <React.Fragment key={s.k}>
            {i > 0 && <span style={{ color: C.faint, alignSelf: 'center', fontWeight: 900 }}>→</span>}
            <div style={{ border: `1px ${unknown ? 'dashed' : 'solid'} ${C.border}`, borderRadius: 6, padding: '4px 8px', minWidth: 0, maxWidth: 220 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.faint, letterSpacing: 0.4 }}>{s.k}</div>
              <div style={{ fontSize: 12, color: unknown ? C.faint : C.text, fontWeight: unknown ? 500 : 700 }}>{s.v}</div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function EventDrawer({ it, onClose }: { it: ResearchItem; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const src = SOURCE_META[it.sourceConfidence] || SOURCE_META.UNVERIFIED;
  const m = it.materiality;
  const ml = m?.label || 'UNKNOWN';
  const gap = GAP_META[it.expectationGap?.level || 'UNKNOWN'] || GAP_META.UNKNOWN;
  const r = it.returns || { w1: null, m1: null, m3: null };

  return (
    <div role="dialog" aria-modal="true" aria-label={`Event detail — ${it.ticker}`}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.55)' }} />
      <div className="mc-drawer-mobile" style={{
        position: 'relative', width: 'min(760px, 100vw)', height: '100%', overflowY: 'auto', overflowX: 'hidden',
        background: C.bg, borderLeft: `1px solid ${C.border}`, padding: '14px 16px 40px', boxSizing: 'border-box',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <Name it={it} max={360} />
            <div style={{ marginTop: 4 }}><Move it={it} big /></div>
          </div>
          <Btn onClick={onClose} title="Close (Esc)">✕ CLOSE</Btn>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {/* zzz771: the drawer carries the same badges as the card, so the
              "older context" / "this move" reading never changes on open. */}
          {it.catalystFor === 'CONTEXT' && <OlderContextBadge it={it} />}
          <StatusPill it={it} /><CatalystForBadge it={it} /><TriagePill it={it} /><SourceBadge it={it} /><RelevanceBadge it={it} /><FlagChips it={it} />
        </div>

        <H>EVENT</H>
        <P><b>{it.eventLabel || it.eventType}</b> · stage <b title={(STAGE_META[it.stage] || STAGE_META.UNKNOWN).hover}>{(STAGE_META[it.stage] || STAGE_META.UNKNOWN).label}</b> · filed {it.filedDate ? it.filedDate.slice(0, 10) : 'date not disclosed'}</P>
        <P dim>Source: {src.label} — {src.hover} {it.sourceUrl && <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>Open source ↗</a>}</P>

        <H>WHAT HAPPENED</H>
        <P>{txt(it.headline, 'Not available')}</P>
        {it.eventClass === 'NO_CATALYST' && <ScanNote it={it} />}

        <H>WHAT CHANGED</H>
        {it.earnings ? <P>{txt(it.whatChanged, 'See earnings detail below')}</P> : <WhatChanged it={it} noLabel />}

        {it.impact && (<><H>IMPACT</H><P dim>{it.impact}</P></>)}

        <H>WHY IT MATTERS</H>
        <P>{txt(it.whyResearch, 'Not established')}</P>
        {it.whyRank && <P dim>Rank basis: {it.whyRank}</P>}

        {/* zzz789: the potential duration is shown as its sentence — "Not established" unless the documents set one. */}
        <H>ECONOMIC TRANSMISSION · {(TRANSMIT_META[it.transmission] || TRANSMIT_META.NONE).label} · POTENTIAL DURATION: {(PERSIST_META[it.persistence] || PERSIST_META.UNKNOWN).label}</H>
        {it.potentialDuration?.text && <P dim>{it.potentialDuration.text} — potential only, not evidence.</P>}
        <TransmissionChain chain={it.transmissionChain || []} />

        <H>MATERIALITY</H>
        <P><b style={{ color: MATERIAL_COLOR[ml] }}>{ml}</b> — {txt(m?.explanation)}</P>
        {(m?.ratios || []).length > 0 && (
          <div style={{ marginTop: 4, fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
            {m.ratios.map((x, i) => <div key={i}>{x.text}</div>)}
          </div>
        )}

        <H>MARKET REACTION</H>
        <P>1D {pct(it.move1d)} · 1W {pct(r.w1)} · 1M {pct(r.m1)} · 3M {pct(r.m3)} · Market cap {money(it.marketCap, it.market)}</P>
        <P dim>Price is context. It is not the ranking and not a signal.</P>

        <H>EXPECTATION GAP</H>
        <P><b style={{ color: gap.color }}>{gap.label}</b> — {txt(it.expectationGap?.text, 'Unknown')}</P>

        <H>WHAT IS UNKNOWN</H>
        {(it.unknowns || []).length ? it.unknowns.map((u, i) => <P key={i} dim>· {u}</P>) : <P dim>No named unknowns recorded.</P>}

        <H>RESEARCH NEXT</H>
        {(it.researchNext || []).length ? it.researchNext.map((q, i) => <P key={i}>→ {q}</P>) : <P dim>No questions recorded.</P>}

        {it.earnings && (<><H>RELATED EARNINGS</H><EarningsStrip e={it.earnings} /></>)}

        <H>PORTFOLIO / THESIS RELEVANCE</H>
        {it.portfolio?.relevance && it.portfolio.relevance !== 'UNRELATED'
          ? <P>{it.portfolio.relevance === 'HOLDING' ? '✓ In your book' : it.portfolio.relevance === 'WATCHLIST' ? 'On your watchlist' : 'Same theme as your book'}{it.portfolio.thesisVariable ? ` · thesis variable: ${it.portfolio.thesisVariable}` : ''}{it.portfolio.note ? ` — ${it.portfolio.note}` : ''}</P>
          : <P dim>Not related to your book.</P>}

        <H>VERBATIM</H>
        {it.quote
          ? <blockquote style={{ margin: 0, padding: '6px 10px', borderLeft: `3px solid ${C.border}`, fontSize: 13, fontStyle: 'italic', color: C.dim, lineHeight: 1.55 }}>“{it.quote}”</blockquote>
          : <P dim>No verbatim quote — the document was not read.</P>}

        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, color: C.dim }}>Evidence / Technical details</summary>
          <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6, marginTop: 6, wordBreak: 'break-word' }}>
            <div>Source URL: {it.sourceUrl ? <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>{it.sourceUrl}</a> : 'none'}</div>
            <div>Source confidence: {it.sourceConfidence} · class {it.eventClass} · market {it.market}{it.catalystFor ? ` · catalyst for: ${it.catalystFor}` : ''}{typeof it.ageDays === 'number' ? ` · age ${it.ageDays}d` : ''}</div>
            <div>Flags: band {it.flags?.band ?? 'none'} · listing {it.flags?.listing ? 'yes' : 'no'} · dilution {it.flags?.dilution ? 'yes' : 'no'} · denial {it.flags?.denial ? 'yes' : 'no'} · turnover {it.flags?.turnover != null ? money(it.flags.turnover, it.market) : 'n/a'}</div>
            {(it.priorityReasons || []).length > 0 && <div>Priority reasons: {it.priorityReasons.join(' · ')}</div>}
            <ScoreDetails it={it} />
          </div>
        </details>
      </div>
    </div>
  );
}
