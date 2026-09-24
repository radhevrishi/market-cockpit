'use client';
// One research-queue card: what changed, why it deserves research time, what
// to check next. Numbers of the score live only behind "Score details".
//                                                                   (zzz770)

import React, { useState } from 'react';
import type { EarningsMini, ResearchItem } from '@/lib/ai-gainers/research-view';
import { Btn, CatalystChips, CatalystForBadge, FactLine, FlagChips, Move, Name, OlderContextBadge, RelevanceBadge, ScanNote, SourceBadge, StatusPill, TriagePill } from './Badges';
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

// ── zzz785 C: compact card, expandable sections ──────────────────────────
// Always visible: what happened, what changed, why research, and anything else
// on file for the company (a negative next to a positive — VIKRAN). Detail sits
// behind six sections: Evidence · Economic mechanism · Catalyst timeline ·
// Persistence · Research next · Source details. Plain English; no trade words.

type SectionKey = 'evidence' | 'mechanism' | 'timeline' | 'persistence' | 'next' | 'source';
const SECTIONS: Array<{ k: SectionKey; title: string }> = [
  { k: 'evidence', title: 'EVIDENCE' }, { k: 'mechanism', title: 'ECONOMIC MECHANISM' }, { k: 'timeline', title: 'CATALYST TIMELINE' },
  { k: 'persistence', title: 'PERSISTENCE' }, { k: 'next', title: 'RESEARCH NEXT' }, { k: 'source', title: 'SOURCE DETAILS' },
];
const row: React.CSSProperties = { fontSize: 13, lineHeight: 1.5, color: C.dim };
const kv = (k: string, v: React.ReactNode) => (
  <div style={row}><span style={{ ...label, marginRight: 6 }}>{k}</span><span style={{ color: C.text }}>{v}</span></div>
);

function AlsoOnFile({ it }: { it: ResearchItem }) {
  const others = (it.catalysts || []).slice(1).filter((c) => c.polarity !== 'neutral' || c.kind === 'resale_registration');
  if (!others.length) return null;
  return (
    <div data-testid="also-on-file" style={{ fontSize: 13, lineHeight: 1.5, background: C.bg2, borderRadius: 6, padding: '5px 9px' }}>
      <div style={label}>ALSO ON FILE FOR THIS COMPANY</div>
      {others.slice(0, 4).map((c) => (
        <div key={c.id} style={{ color: C.dim }}>
          <b style={{ color: c.polarity === 'negative' ? C.red : c.polarity === 'positive' ? C.green : C.faint }}>{c.polarity === 'negative' ? '▼ Negative' : c.polarity === 'positive' ? '▲ Positive' : '◆'}</b>{' '}
          <span style={{ color: C.text }}>{txt(c.title, c.kindWord)}</span>
          {c.materialityText && <span> — {c.materialityText}</span>}
          <span style={{ color: C.faint }}> · {c.state.toLowerCase()} · {c.verification}</span>
        </div>
      ))}
    </div>
  );
}

function Evidence({ it }: { it: ResearchItem }) {
  const unknowns = (it.unknowns || []).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {it.quote ? <div style={{ ...row, color: C.text, fontStyle: 'italic' }}>“{it.quote}”</div> : <div style={row}>No verbatim quote on file.</div>}
      {it.evidenceBreadth && kv('BREADTH', it.evidenceBreadth.text)}
      {kv('MATERIALITY', `${it.materiality?.label || 'UNKNOWN'} — ${txt(it.materiality?.explanation, 'Not disclosed')}`)}
      {(it.materiality?.ratios || []).map((r, i) => <div key={i} style={{ ...row, color: C.faint }}>= {r.text}</div>)}
      {it.evidenceGap && kv(it.evidenceGap.label.toUpperCase(), it.evidenceGap.text)}
      {unknowns.length > 0 && (
        <div style={row}><div style={label}>UNKNOWN (NOT NEGATIVE)</div>{unknowns.map((u, i) => <div key={i}>· {u}</div>)}</div>
      )}
    </div>
  );
}

function Mechanism({ it }: { it: ResearchItem }) {
  const pt = it.persistenceTest;
  const chain = (it.transmissionChain || []).slice(1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {kv('HOW IT REACHES PROFIT', txt(pt?.mechanism, 'Not described in the filing'))}
      {chain.length > 0 && <div style={row}>{chain.map((c, i) => <div key={i}>→ {c}</div>)}</div>}
      {kv('MOVE VS CHANGE', txt(it.expectationGap?.text, 'Unknown'))}
      {it.materiality?.label === 'UNKNOWN' && <div style={{ ...row, color: C.faint }}>No pricing assessment: the event&rsquo;s economics are unknown. Price is context only.</div>}
    </div>
  );
}

function Timeline({ it }: { it: ResearchItem }) {
  const tl = it.timeline || [];
  const cs = it.catalysts || [];
  if (!tl.length && !cs.length) return <div style={row}>No catalyst record yet — nothing beyond this card is on file.</div>;
  return (
    <div data-testid="catalyst-timeline" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {tl.map((t, i) => (
        <div key={i} style={{ ...row, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ color: C.faint, minWidth: 78 }}>{txt(t.date, 'undated')}</span>
          <span style={{ fontWeight: 800, color: t.status === 'official' ? C.cyan : C.amber }}>{t.kindWord}</span>
          {t.url ? <a href={t.url} target="_blank" rel="noopener noreferrer" style={{ color: C.text, textDecoration: 'none', flex: '1 1 200px' }}>{t.title}</a> : <span style={{ color: C.text, flex: '1 1 200px' }}>{t.title}</span>}
          <span style={{ color: C.faint }}>{t.status}</span>
        </div>
      ))}
      {cs.map((c) => (
        <div key={c.id} style={{ ...row, borderTop: `1px dashed ${C.border}`, paddingTop: 3 }}>
          <b style={{ color: C.text }}>{txt(c.title, c.kindWord)}</b> — {c.stateWord}{c.previousState && c.previousState !== c.state ? ` (was ${c.previousState.toLowerCase()})` : ''}
          {c.duplicatesMerged > 0 && <span style={{ color: C.faint }}> · {c.duplicatesMerged} repeat{c.duplicatesMerged === 1 ? '' : 's'} merged</span>}
          {c.latestEvidence && <div>Latest evidence: {c.latestEvidence}</div>}
          {c.nextMilestone && <div>Next milestone: {c.nextMilestone}</div>}
          {c.invalidation && <div style={{ color: C.faint }}>Would weaken it: {c.invalidation}</div>}
        </div>
      ))}
    </div>
  );
}

function PersistenceSection({ it }: { it: ResearchItem }) {
  const pt = it.persistenceTest;
  const pc = it.persistentCatalyst;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {pt ? (
        <>
          <div style={{ ...row, color: C.text }}><b>{pt.grade}</b> — {pt.why}</div>
          {kv('POTENTIAL (BY TYPE)', pt.potential)}
          {kv('SUPPORTED BY EVIDENCE', txt(pt.evidenceSupported, 'Not established'))}
          {kv('EXPECTED DURATION', pt.expectedDuration)}
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(110px, auto) 1fr', gap: '2px 10px', fontSize: 12.5, color: C.dim }}>
            {([['Mechanism', pt.mechanism], ['Runway', pt.runway], ['Evidence', pt.evidence], ['Repeatability', pt.repeatability], ['Duration', pt.duration], ['Milestone', pt.milestone], ['Invalidation', pt.invalidation]] as Array<[string, string | null]>).map(([k, v]) => (
              <React.Fragment key={k}><span style={{ color: C.faint }}>{k}</span><span style={{ color: v ? C.text : C.faint }}>{txt(v, k === 'Duration' ? 'Not disclosed' : 'Not established')}</span></React.Fragment>
            ))}
          </div>
        </>
      ) : <div style={row}>No persistence test — no event to test.</div>}
      {pc && pc.kind === 'PROJECT_PIPELINE' && (
        <div data-testid="tracked-potential" style={{ ...row, border: `1px dashed ${C.cyan}`, borderRadius: 6, padding: '5px 8px' }}>
          <b style={{ color: C.cyan }}>◌ Tracked potential catalyst — enabling step</b>
          <div>{pc.mechanism}</div>
          {pc.nextMilestone && <div style={{ color: C.text }}>Next milestone: <b>{pc.nextMilestone}</b></div>}
          <div style={{ color: C.faint }}>{pc.runway}</div>
        </div>
      )}
      {pc && pc.kind !== 'PROJECT_PIPELINE' && (pc.confidence === 'HIGH' || pc.confidence === 'MEDIUM' || pc.specialFocus) && (
        <div data-testid="persistent-catalyst" style={{ ...row, border: `1px solid ${C.amber}`, borderRadius: 6, padding: '5px 8px' }}>
          <b style={{ color: C.amber }}>🔥 {pc.specialFocus ? 'Special Focus · persistent catalyst' : 'Persistent catalyst candidate'}</b> <span style={{ color: C.text, fontWeight: 800 }}>{pc.label}</span>
          <div>{pc.mechanism}</div>
          <div style={{ color: C.faint }}>Runway: {pc.runway}{pc.ledgerBacked ? ' · with the evidence ledger' : ' · this filing only'}</div>
        </div>
      )}
      {it.links && (
        <div style={{ ...row, color: C.faint }}>
          {it.links.thesis && <a href={it.links.thesis} style={{ color: C.cyan, fontWeight: 800, marginRight: 12 }}>Thesis ledger →</a>}
          {it.links.specialFocus && <a href={it.links.specialFocus} style={{ color: C.amber, fontWeight: 800, marginRight: 12 }}>Special Focus →</a>}
          <div>{it.links.note}</div>
        </div>
      )}
    </div>
  );
}

function SourceDetails({ it, rank }: { it: ResearchItem; rank: number }) {
  const reasons = (it.priorityReasons || []).filter(Boolean);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {kv('SOURCE', it.sourceUrl ? <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>open ↗</a> : 'No source link')}
      {it.filedDate && kv('FILED', it.filedDate.slice(0, 10))}
      {it.verification && kv('VERIFICATION', it.verification)}
      {(it.catalysts || []).map((c) => <div key={c.id} style={{ ...row, color: C.faint }}>{c.kindWord}: {c.documents} document{c.documents === 1 ? '' : 's'}{c.duplicatesMerged ? `, ${c.duplicatesMerged} repeat${c.duplicatesMerged === 1 ? '' : 's'} merged` : ''} · first seen {txt(c.firstSeen, 'Unknown')}</div>)}
      {reasons.length > 0 && <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.5 }}><span style={{ ...label, marginRight: 6 }}>WHY RESEARCH PRIORITY #{rank}</span>{reasons.join(' · ')}</div>}
    </div>
  );
}

/** `older`: rendered inside the "Older filings" section — carries the OLDER
 *  CONTEXT badge so the card is never mistaken for this move's catalyst. (zzz771) */
export function ResearchCard({ it, rank, onOpen, older }: { it: ResearchItem; rank: number; onOpen: (it: ResearchItem) => void; older?: boolean }) {
  const [score, setScore] = useState(false);
  const [open, setOpen] = useState<Set<SectionKey>>(() => new Set());
  const toggle = (k: SectionKey) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const meta = CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST;
  const unverified = it.sourceConfidence === 'UNVERIFIED';
  const unknowns = (it.unknowns || []).filter(Boolean);
  const next = (it.researchNext || []).filter(Boolean);
  const count: Partial<Record<SectionKey, number>> = { timeline: (it.timeline || []).length, next: next.length };
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
        <CatalystChips it={it} />
        {it.filedDate && <span style={{ fontSize: 11, color: C.faint }}>filed {it.filedDate.slice(0, 10)}</span>}
      </div>

      <WhatChanged it={it} />
      <FactLine it={it} />

      <div style={{ fontSize: 13, lineHeight: 1.5, color: C.text }}>
        <span style={{ ...label, marginRight: 6 }}>WHY RESEARCH</span>{txt(it.whyResearch, 'Not established')}
      </div>
      <AlsoOnFile it={it} />
      {it.news?.narrative && (
        <div style={{ fontSize: 12, color: C.dim }}>
          <span style={{ ...label, marginRight: 6 }}>RUNNING STORY</span>{it.news.narrative.label} · covered on {it.news.narrative.days} days ({it.news.narrative.firstDate} → {it.news.narrative.lastDate}) · press, secondary · verification required — “{it.news.narrative.lead}”
        </div>
      )}
      {unknowns.length > 0 && (
        <div style={{ fontSize: 13, lineHeight: 1.5, color: C.dim }} title={unknowns.join('\n')}>
          <span style={{ ...label, marginRight: 6 }}>KEY UNKNOWN</span>{unknowns[0]}
          {unknowns.length > 1 && <span style={{ color: C.faint }}> · +{unknowns.length - 1} more</span>}
        </div>
      )}
      {it.portfolio?.relevance && it.portfolio.relevance !== 'UNRELATED' && (
        <div style={{ fontSize: 13, color: C.dim, background: tint(C.cyan, 6), borderRadius: 6, padding: '5px 9px' }}>
          <span style={{ ...label, marginRight: 6 }}>{it.portfolio.relevance === 'HOLDING' ? 'YOUR BOOK' : 'THEME'}</span>
          {it.portfolio.thesisVariable && <b style={{ color: C.text }}>{it.portfolio.thesisVariable}. </b>}
          {txt(it.portfolio.note, '')}
        </div>
      )}

      <div role="tablist" style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
        {SECTIONS.map(({ k, title }) => (
          <button key={k} type="button" aria-expanded={open.has(k)} onClick={() => toggle(k)} style={{
            all: 'unset', cursor: 'pointer', fontSize: 11, fontWeight: 800, letterSpacing: 0.4, padding: '3px 8px', borderRadius: 4,
            border: `1px solid ${open.has(k) ? C.cyan : C.border}`, color: open.has(k) ? C.cyan : C.dim, background: open.has(k) ? tint(C.cyan, 8) : 'transparent',
          }}>{open.has(k) ? '▾' : '▸'} {title}{count[k] ? ` (${count[k]})` : ''}</button>
        ))}
      </div>
      {SECTIONS.filter(({ k }) => open.has(k)).map(({ k, title }) => (
        <section key={k} aria-label={title} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>
          <div style={{ ...label, marginBottom: 3 }}>{title}</div>
          {k === 'evidence' && <Evidence it={it} />}
          {k === 'mechanism' && <Mechanism it={it} />}
          {k === 'timeline' && <Timeline it={it} />}
          {k === 'persistence' && <PersistenceSection it={it} />}
          {k === 'next' && (next.length ? <div style={row}>{next.map((q, i) => <div key={i}>→ {q}</div>)}</div> : <div style={row}>No open questions listed.</div>)}
          {k === 'source' && <SourceDetails it={it} rank={rank} />}
        </section>
      ))}

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <Btn onClick={() => onOpen(it)} color={C.cyan}>OPEN EVENT</Btn>
        {it.sourceUrl ? <Btn href={it.sourceUrl}>SOURCE ↗</Btn> : <span style={{ fontSize: 12, color: C.faint, alignSelf: 'center' }}>No source link</span>}
        <Btn onClick={() => setScore((s) => !s)}>{score ? 'HIDE SCORE DETAILS' : 'SCORE DETAILS'}</Btn>
      </div>
      {score && <ScoreDetails it={it} />}
    </article>
  );
}
