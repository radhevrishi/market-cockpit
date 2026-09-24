'use client';
// One research-queue card: what changed, why it deserves research time, what
// to check next. Numbers of the score live only behind "Score details".
//                                                                   (zzz770)

import React, { useState } from 'react';
import type { EarningsMini, ResearchItem } from '@/lib/ai-gainers/research-view';
import { Btn, CatalystForBadge, FactLine, FlagChips, Move, Name, OlderContextBadge, RelevanceBadge, ScanNote, SourceBadge, StatusPill, TriagePill } from './Badges';
import { C, CLASS_META, pctND, tint, txt } from './tokens';

const label: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint };

export function WhatChanged({ it, noLabel }: { it: ResearchItem; noLabel?: boolean }) {
  if (it.earnings) return <EarningsStrip e={it.earnings} />;
  const hasBA = !!(it.before || it.after);
  const body = hasBA
    ? (
      <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: C.dim }}>{txt(it.before, 'Before: not disclosed')}</span>
        <span style={{ color: C.faint, fontWeight: 900 }}>→</span>
        <span style={{ color: C.text, fontWeight: 800 }}>{txt(it.after, 'After: not disclosed')}</span>
      </span>
    )
    : <span style={{ color: it.whatChanged ? C.text : C.faint, fontWeight: it.whatChanged ? 700 : 500 }}>{txt(it.whatChanged, 'Financial impact not established from the filing')}</span>;
  return (
    <div style={{ background: C.bg2, borderRadius: 6, padding: '7px 10px', fontSize: 14, lineHeight: 1.5 }}>
      {!noLabel && <span style={{ ...label, marginRight: 8 }}>WHAT CHANGED</span>}
      {body}
      {hasBA && it.whatChanged && <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>{it.whatChanged}</div>}
    </div>
  );
}

const gTxt: Record<EarningsMini['guidance'], string> = { RAISED: 'Raised', MAINTAINED: 'Maintained', CUT: 'Cut', NOT_STATED: 'Not stated' };
const oTxt: Record<EarningsMini['orderBook'], string> = { UP: 'Up', DOWN: 'Down', UNCHANGED: 'Unchanged', NOT_STATED: 'Not stated' };

export function EarningsStrip({ e }: { e: EarningsMini }) {
  const margin = e.marginNow == null ? 'Not disclosed'
    : `${e.marginPrior != null ? `${e.marginPrior.toFixed(1)}% → ` : ''}${e.marginNow.toFixed(1)}%`;
  // zzz771: every missing figure says "Not disclosed" — never "—" beside a
  // "Not disclosed" in the same strip (the owner read the dash as flat/zero).
  const yoyQoq = e.revenueYoY == null && e.revenueQoQ == null ? 'Not disclosed'
    : `${pctND(e.revenueYoY)} YoY · ${pctND(e.revenueQoQ)} QoQ`;
  const cells: Array<[string, string, string?]> = [
    ['REVENUE', yoyQoq],
    ['EBITDA', e.ebitdaYoY == null ? 'Not disclosed' : `${pctND(e.ebitdaYoY)} YoY`],
    ['MARGIN', margin, e.marginNow != null && e.marginPrior != null ? (e.marginNow >= e.marginPrior ? C.green : C.red) : undefined],
    ['PAT', e.patYoY == null ? 'Not disclosed' : `${pctND(e.patYoY)} YoY`],
    ['CFO / PAT', e.cfoToPat == null ? 'Not disclosed' : `${e.cfoToPat.toFixed(2)}×`, e.cfoToPat != null && e.cfoToPat < 0.5 ? C.amber : undefined],
    ['GUIDANCE', gTxt[e.guidance] || 'Not stated', e.guidance === 'RAISED' ? C.green : e.guidance === 'CUT' ? C.red : undefined],
    ['ORDER BOOK', oTxt[e.orderBook] || 'Not stated'],
  ];
  return (
    <div style={{ background: C.bg2, borderRadius: 6, padding: '7px 10px' }}>
      <div style={{ ...label, marginBottom: 4 }}>EARNINGS{e.filedDaysAgo != null ? ` · FILED ${e.filedDaysAgo}D AGO` : ''}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '4px 12px' }}>
        {cells.map(([k, v, col]) => (
          <div key={k} style={{ minWidth: 0 }}>
            <div style={{ ...label, fontSize: 11 }}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: col || C.text }}>{v}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 13, color: C.text, marginTop: 5 }}>
        <span style={{ ...label, marginRight: 6 }}>KEY CHANGE</span>{txt(e.keyChange, 'Not identified')}
      </div>
    </div>
  );
}

export function ScoreDetails({ it }: { it: ResearchItem }) {
  const entries = Object.entries(it.scoreDetails || {}).filter(([, v]) => typeof v === 'number' && Number.isFinite(v));
  return (
    <div style={{ marginTop: 6, paddingTop: 6, borderTop: `1px dashed ${C.border}`, fontSize: 12, color: C.dim }}>
      <div style={{ ...label, marginBottom: 3 }}>RESEARCH PRIORITY {Number.isFinite(it.priority) ? Math.round(it.priority) : '—'}/100 · HOW IT WAS BUILT</div>
      {entries.length === 0
        ? <div style={{ color: C.faint }}>No component scores recorded.</div>
        : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 14px' }}>
            {entries.map(([k, v]) => <span key={k}><span style={{ color: C.faint }}>{k}</span> <b style={{ color: C.text }}>{Math.abs(v) < 10 && !Number.isInteger(v) ? v.toFixed(2) : Math.round(v)}</b></span>)}
          </div>
        )}
      <div style={{ color: C.faint, marginTop: 3 }}>Priority is research value, never the size of the move.</div>
    </div>
  );
}

/** `older`: rendered inside the "Older filings" section — carries the OLDER
 *  CONTEXT badge so the card is never mistaken for this move's catalyst. (zzz771) */
export function ResearchCard({ it, rank, onOpen, older }: { it: ResearchItem; rank: number; onOpen: (it: ResearchItem) => void; older?: boolean }) {
  const [score, setScore] = useState(false);
  const meta = CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST;
  const unverified = it.sourceConfidence === 'UNVERIFIED';
  const unknowns = (it.unknowns || []).filter(Boolean);
  const next = (it.researchNext || []).filter(Boolean).slice(0, 5);
  const reasons = (it.priorityReasons || []).filter(Boolean);
  return (
    <article data-testid="research-card" style={{
      background: C.bg, borderRadius: 10, padding: '11px 13px', minWidth: 0,
      border: `1px ${unverified ? 'dashed' : 'solid'} ${C.border}`,
      borderLeft: `3px ${unverified ? 'dashed' : 'solid'} ${unverified ? C.border : meta.color}`,
      opacity: unverified ? 0.82 : 1, display: 'flex', flexDirection: 'column', gap: 7,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap', minWidth: 0 }}>
        <span title="Research priority rank" style={{ fontSize: 13, fontWeight: 900, color: C.faint, minWidth: 22 }}>#{rank}</span>
        <Name it={it} />
        <Move it={it} big />
        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', marginLeft: 'auto' }}>
          {older && <OlderContextBadge it={it} />}
          <StatusPill it={it} />
          <CatalystForBadge it={it} />
          <TriagePill it={it} />
        </span>
      </div>

      <div style={{ fontSize: 14, fontWeight: 800, color: C.text, lineHeight: 1.45 }}>{txt(it.headline, 'Headline not available')}</div>
      {it.eventClass === 'NO_CATALYST' && <ScanNote it={it} />}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <SourceBadge it={it} />
        <RelevanceBadge it={it} />
        <FlagChips it={it} />
        {it.filedDate && <span style={{ fontSize: 11, color: C.faint }}>filed {it.filedDate.slice(0, 10)}</span>}
      </div>

      <WhatChanged it={it} />
      <FactLine it={it} />

      <div style={{ fontSize: 13, lineHeight: 1.5, color: C.text }}>
        <span style={{ ...label, marginRight: 6 }}>WHY RESEARCH</span>{txt(it.whyResearch, 'Not established')}
      </div>
      {it.news?.narrative && (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
          <span style={{ ...label, marginRight: 6 }}>RUNNING STORY</span>{it.news.narrative.label} · covered on {it.news.narrative.days} days ({it.news.narrative.firstDate} → {it.news.narrative.lastDate}) · press, unverified — “{it.news.narrative.lead}”
        </div>
      )}
      {unknowns.length > 0 && (
        <div style={{ fontSize: 13, lineHeight: 1.5, color: C.dim }} title={unknowns.join('\n')}>
          <span style={{ ...label, marginRight: 6 }}>KEY UNKNOWN</span>{unknowns[0]}
          {unknowns.length > 1 && <span style={{ color: C.faint }}> · +{unknowns.length - 1} more</span>}
        </div>
      )}
      {next.length > 0 && (
        <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
          <div style={label}>RESEARCH NEXT</div>
          {next.map((q, i) => <div key={i}>→ {q}</div>)}
        </div>
      )}
      {it.portfolio?.relevance && it.portfolio.relevance !== 'UNRELATED' && (
        <div style={{ fontSize: 13, color: C.dim, background: tint(C.cyan, 6), borderRadius: 6, padding: '5px 9px' }}>
          <span style={{ ...label, marginRight: 6 }}>{it.portfolio.relevance === 'HOLDING' ? 'YOUR BOOK' : 'THEME'}</span>
          {it.portfolio.thesisVariable && <b style={{ color: C.text }}>{it.portfolio.thesisVariable}. </b>}
          {txt(it.portfolio.note, '')}
        </div>
      )}
      {reasons.length > 0 && (
        <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
          <span style={{ ...label, marginRight: 6 }}>WHY RESEARCH PRIORITY #{rank}</span>{reasons.join(' · ')}
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn onClick={() => onOpen(it)} color={C.cyan}>OPEN EVENT</Btn>
        {it.sourceUrl ? <Btn href={it.sourceUrl}>SOURCE ↗</Btn> : <span style={{ fontSize: 12, color: C.faint, alignSelf: 'center' }}>No source link</span>}
        <Btn onClick={() => setScore((s) => !s)}>{score ? 'HIDE SCORE DETAILS' : 'SCORE DETAILS'}</Btn>
      </div>
      {score && <ScoreDetails it={it} />}
    </article>
  );
}
