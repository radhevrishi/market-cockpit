'use client';
// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE RESEARCH TRIAGE VIEW.                      (zzz770)
//
// Renders ONLY from ResearchView (src/lib/ai-gainers/research-view.ts). The
// reader scans ten names in a minute and knows which two or three deserve
// deep research. Order of the page is the order of attention:
//   header + session → market summary → top 3 → RESEARCH QUEUE (dominant) →
//   your book → watch / investigate → negative / denied → collapsed: older
//   filings (context, not this move's catalyst — zzz771), no catalyst,
//   price-band moves, data quality / listings, source failures.
// Score arithmetic, full filing lists and long explanations are reachable
// behind expanders and never on the default screen.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useCallback, useState } from 'react';
import type { ResearchItem, ResearchView } from '@/lib/ai-gainers/research-view';
import { BandChip, Btn, CatalystForBadge, Move, Name, Pill, ScanNote, SectionHead, SourceBadge, StatusPill, TriagePill } from './Badges';
import { EventDrawer } from './EventDrawer';
import { ResearchCard } from './ResearchCard';
import { C, CLASS_META, MATERIAL_COLOR, istClock, moveColor, pct, sessionDate, tint, txt } from './tokens';

export interface ResearchTriageProps {
  view: ResearchView;
  market: 'IN' | 'US';
  /** Page controls (market switch, ▶ Research, status text). */
  toolbar?: React.ReactNode;
  /** A line above the summary (research not run yet, re-score note, errors). */
  notice?: React.ReactNode;
  onRescan?: () => void;
  rescanning?: boolean;
  /** Extra session context, e.g. the US export's "as of" label. */
  sessionNote?: string | null;
  /** Rendered last, collapsed: the raw evidence tables. */
  technical?: React.ReactNode;
}

const box: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px', minWidth: 0 };

function Header({ view, onRescan, rescanning, toolbar, sessionNote }: Pick<ResearchTriageProps, 'view' | 'onRescan' | 'rescanning' | 'toolbar' | 'sessionNote'>) {
  const s = view.session || { date: null, scanAt: null, status: 'unknown', cached: false };
  const scan = istClock(s.scanAt);
  const live = /live/i.test(String(s.status || ''));
  const statusText = live ? 'Live' : /unknown/i.test(String(s.status || '')) || !s.status ? 'Unknown' : s.status;
  const k: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint };
  const v: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: C.text };
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: 0.8, color: C.text }}>AI DAILY GAINERS</h1>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
          Fundamental events behind today&rsquo;s unusual moves — ranked by research value, not return.
        </div>
      </div>
      <div data-testid="session-block" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '4px 14px', padding: '7px 11px', borderRadius: 8,
        background: C.bg, border: `1px solid ${live ? C.cyan : C.border}`,
      }}>
        <span><span style={k}>SESSION </span><span style={v}>{sessionDate(s.date) || 'Unknown'}</span></span>
        <span><span style={k}>SCAN </span><span style={v}>{scan || 'Unknown'}</span></span>
        <span><span style={k}>STATUS </span><span style={{ ...v, color: live ? C.cyan : C.text }}>{statusText}</span></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={k}>DATA</span>
          {s.cached
            ? <><span style={{ fontSize: 13, color: C.dim }}>Cached {scan || ''}</span>{onRescan && <Btn onClick={onRescan} title="Re-reads the gainers screen now and any new exchange announcements (AI reads, only on this click).">{rescanning ? 'SCANNING…' : '↻ RESCAN'}</Btn>}</>
            : <><span style={{ fontSize: 13, color: C.green, fontWeight: 700 }}>✓ Live scan completed</span>{onRescan && <Btn onClick={onRescan} title="Re-reads the gainers screen now and any new exchange announcements (AI reads, only on this click).">{rescanning ? 'SCANNING…' : '↻ RESCAN'}</Btn>}</>}
        </span>
        {sessionNote && <span style={{ fontSize: 12, color: C.faint, flexBasis: '100%' }}>{sessionNote}</span>}
        {!live && s.date && /last|previous|closed/i.test(String(s.status)) && (
          <span style={{ fontSize: 12, color: C.amber, flexBasis: '100%' }}>These are the last completed session&rsquo;s moves — not today&rsquo;s.</span>
        )}
      </div>
      {toolbar && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{toolbar}</div>}
    </header>
  );
}

function Summary({ view }: { view: ResearchView }) {
  const s = view.summary;
  const cards: Array<{ n: number; l: string; color?: string; title: string }> = [
    { n: s.scanned, l: 'Gainers scanned', title: 'Names on this session’s board.' },
    { n: s.confirmed, l: 'Confirmed events', color: C.green, title: 'Verified events (material or small).' },
    { n: s.potential, l: 'Potential', color: C.amber, title: 'Something exists but is not verified.' },
    { n: s.negative, l: 'Negative / denied', color: C.red, title: 'Negative, contrary or company-denied.' },
    { n: s.noCatalyst, l: 'No clear catalyst', title: 'Checked: no credible event found.' },
    { n: s.queue, l: 'Research queue', color: C.cyan, title: 'Names that deserve research time today.' },
    { n: s.portfolioMatches, l: 'Portfolio matches', color: C.cyan, title: 'Names in or related to your book.' },
  ];
  if (s.dataUnavailable > 0) cards.push({ n: s.dataUnavailable, l: 'Data unavailable', color: C.amber, title: 'Sources failed — not the same as “no catalyst”.' });
  // zzz771: older filings are counted once, here, and nowhere else — they are
  // not confirmed events and not in the queue. Hidden when the pipeline did
  // not supply the count (older cached views).
  if (typeof s.context === 'number' && s.context > 0) cards.push({ n: s.context, l: 'Older context', title: 'Names whose only event is older than the move window — context, not this move’s catalyst.' });
  return (
    <section aria-label="Market summary">
      <SectionHead title="MARKET SUMMARY" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 8 }}>
        {cards.map((c) => (
          <div key={c.l} title={c.title} style={{ ...box, padding: '8px 10px' }}>
            <div style={{ fontSize: 20, fontWeight: 900, color: c.n > 0 ? (c.color || C.text) : C.faint, lineHeight: 1.1 }}>{Number.isFinite(c.n) ? c.n : 0}</div>
            <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginTop: 2 }}>{c.l.toUpperCase()}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Top3({ items, onOpen }: { items: ResearchItem[]; onOpen: (it: ResearchItem) => void }) {
  if (!items.length) return null;
  return (
    <section aria-label="Top 3 research priorities">
      <SectionHead title="TOP 3 RESEARCH PRIORITIES" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 8 }}>
        {items.slice(0, 3).map((it, i) => (
          <div key={it.ticker} style={{ ...box, borderLeft: `3px solid ${(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).color}`, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, minWidth: 0 }}>
              <span style={{ fontSize: 13, fontWeight: 900, color: C.faint }}>#{i + 1}</span>
              <Name it={it} max={140} />
              <span style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 900, color: moveColor(it.move1d) }}>{pct(it.move1d)}</span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 800, color: C.text, lineHeight: 1.4 }}>{txt(it.headline, 'Headline not available')}</div>
            <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.45 }}>{txt(it.whyResearch, '')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
              <TriagePill it={it} />
              <Pill color={MATERIAL_COLOR[it.materiality?.label || 'UNKNOWN']} title={it.materiality?.explanation || ''}>{it.materiality?.label || 'UNKNOWN'}</Pill>
              <span style={{ marginLeft: 'auto' }}><Btn onClick={() => onOpen(it)} color={C.cyan}>OPEN</Btn></span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Collapsible({ title, count, sub, children, color, testid, paren }: { title: string; count: number; sub?: string; children: React.ReactNode; color?: string; testid?: string; paren?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <section data-testid={testid} data-open={open ? '1' : '0'} style={{ ...box, padding: '8px 12px' }}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        style={{ all: 'unset', cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', width: '100%' }}>
        <span style={{ fontSize: 12, color: C.faint, width: 12 }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 13, fontWeight: 900, letterSpacing: 0.5, color: color || C.dim }}>{paren ? `${title} (${count})` : `${title} — ${count}`}</span>
        {sub && <span style={{ fontSize: 12, color: C.faint }}>{sub}</span>}
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </section>
  );
}

/** "SECZ +17.9% No meaningful filing" — the compressed one-liner. */
function OneLiner({ it, onOpen, extra }: { it: ResearchItem; onOpen?: (it: ResearchItem) => void; extra?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 9px', alignItems: 'baseline', padding: '4px 0', borderTop: `1px solid ${C.border}`, fontSize: 13, minWidth: 0 }}>
      <Name it={it} max={160} />
      <span style={{ fontWeight: 800, color: moveColor(it.move1d) }}>{pct(it.move1d)}</span>
      <span style={{ color: C.dim, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 220px' }} title={it.headline}>{txt(it.headline, 'No meaningful filing')}</span>
      {it.eventClass === 'NO_CATALYST' && it.flags?.denial && <StatusPill it={it} />}
      <CatalystForBadge it={it} />
      {extra}
      {onOpen && <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, color: C.cyan }}>details</button>}
      {it.eventClass === 'NO_CATALYST' && it.scanNote && <div style={{ flexBasis: '100%' }}><ScanNote it={it} /></div>}
      {it.news?.narrative && <div style={{ flexBasis: '100%', fontSize: 12, color: C.dim }}>Press (unverified): <b style={{ color: C.text }}>{it.news.narrative.label}</b> story over {it.news.narrative.days} days ({it.news.narrative.firstDate} → {it.news.narrative.lastDate}) — “{it.news.narrative.lead}”</div>}
    </div>
  );
}

function ShowAll({ items, first, render }: { items: ResearchItem[]; first: number; render: (it: ResearchItem) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, first);
  return (
    <>
      {shown.map(render)}
      {items.length > first && (
        <button type="button" onClick={() => setAll((a) => !a)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: C.cyan, marginTop: 6 }}>
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </>
  );
}

function Book({ items, onOpen }: { items: ResearchItem[]; onOpen: (it: ResearchItem) => void }) {
  if (!items.length) return null;
  const th: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint, textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { fontSize: 13, color: C.dim, padding: '6px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };
  return (
    <section aria-label="Your book" style={box}>
      <SectionHead title="YOUR BOOK" count={items.length} sub="Position reviews against your thesis — not trade instructions." />
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
          <thead><tr><th style={th}>Name</th><th style={th}>1D</th><th style={th}>Event</th><th style={th}>Thesis variable</th><th style={th}>Materiality</th><th style={th}>Research next</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.ticker}>
                <td style={td}>
                  <span style={{ color: C.cyan, fontWeight: 900, marginRight: 5 }} title={it.portfolio?.relevance === 'HOLDING' ? 'In your book' : txt(it.portfolio?.relevance, '')}>{it.portfolio?.relevance === 'HOLDING' ? '✓' : '◇'}</span>
                  <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 900, color: C.text }}>{txt(it.displayTicker, '') || it.ticker}</button>
                </td>
                <td style={{ ...td, color: moveColor(it.move1d), fontWeight: 800 }}>{pct(it.move1d)}</td>
                <td style={{ ...td, minWidth: 220 }}><div style={{ color: C.text }}>{txt(it.headline, 'No event')}</div><div style={{ marginTop: 3 }}><StatusPill it={it} /></div></td>
                <td style={td}>{txt(it.portfolio?.thesisVariable, 'Not mapped')}</td>
                <td style={{ ...td, color: MATERIAL_COLOR[it.materiality?.label || 'UNKNOWN'], fontWeight: 800 }} title={it.materiality?.explanation}>{it.materiality?.label || 'UNKNOWN'}</td>
                <td style={{ ...td, minWidth: 200 }}>{(it.researchNext || []).slice(0, 2).map((q, i) => <div key={i}>→ {q}</div>)}{!(it.researchNext || []).length && <span style={{ color: C.faint }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function ResearchTriage(props: ResearchTriageProps) {
  const { view, notice, technical } = props;
  const [openItem, setOpenItem] = useState<ResearchItem | null>(null);
  const onOpen = useCallback((it: ResearchItem) => setOpenItem(it), []);
  const onClose = useCallback(() => setOpenItem(null), []);

  const isBand = (it: ResearchItem) => it.eventClass === 'MARKET_MOVE_ONLY';
  const noCat = (view.noCatalyst || []).filter((it) => !isBand(it));
  const bands = [...(view.noCatalyst || []), ...(view.dataQuality || [])].filter(isBand);
  const dq = (view.dataQuality || []).filter((it) => !isBand(it));
  const listings = dq.filter((it) => it.eventClass === 'LISTING' || it.flags?.listing);
  const fails = view.sourceFailures || [];
  const partial = view.partialFailures || [];
  const context = view.context || [];   // zzz771: absent on older cached views → section hidden
  const empty = (view.summary?.scanned || 0) === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <Header {...props} />
      {notice}

      {empty ? (
        <div style={{ ...box, fontSize: 13, color: C.dim }}>
          No gainers on this board for this session. That is a real answer for this scan, not a loading state — press ↻ Rescan to read the screen again.
        </div>
      ) : (
        <>
          <Summary view={view} />
          <Top3 items={view.top3 || []} onOpen={onOpen} />

          <section aria-label="Research queue">
            <SectionHead title="RESEARCH QUEUE" count={(view.queue || []).length} sub="Ranked by research value. Price is context, never the ranking." />
            {(view.queue || []).length === 0 ? (
              <div style={{ ...box, fontSize: 13, color: C.dim }}>
                No name on this board carries an event that deserves research time — a valid result, not an empty page.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))', gap: 10 }}>
                {view.queue.map((it, i) => <ResearchCard key={it.ticker} it={it} rank={i + 1} onOpen={onOpen} />)}
              </div>
            )}
          </section>

          <Book items={view.portfolio || []} onOpen={onOpen} />

          {(view.watch || []).length > 0 && (
            <section aria-label="Watch / investigate" style={box}>
              <SectionHead title="WATCH / INVESTIGATE" count={view.watch.length} sub="Real but smaller, or not yet verified." />
              {view.watch.map((it) => (
                <div key={it.ticker} style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 9px', alignItems: 'baseline', padding: '5px 0', borderTop: `1px solid ${C.border}`, opacity: it.sourceConfidence === 'UNVERIFIED' ? 0.82 : 1, minWidth: 0 }}>
                  <Name it={it} max={150} />
                  <Move it={it} />
                  <span style={{ fontSize: 13, color: C.text, flex: '1 1 260px', minWidth: 0 }}>{txt(it.headline, 'Headline not available')}</span>
                  <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
                    <Pill color={(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).color} title={(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).meaning}>{(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).short.toUpperCase()}</Pill>
                    <CatalystForBadge it={it} />
                    <SourceBadge it={it} />
                    <BandChip it={it} />
                  </span>
                  <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: C.cyan }}>OPEN</button>
                </div>
              ))}
            </section>
          )}

          {(view.negative || []).length > 0 && (
            <section aria-label="Negative / denied" style={{ ...box, borderColor: tint(C.red, 45) }}>
              <SectionHead title="⚠ NEGATIVE EVIDENCE" count={view.negative.length} sub="Findings, not omissions." />
              {view.negative.map((it) => (
                <div key={it.ticker} style={{ padding: '5px 0', borderTop: `1px solid ${C.border}`, minWidth: 0 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 9px', alignItems: 'baseline' }}>
                    <Name it={it} max={150} />
                    <span style={{ fontWeight: 800, color: moveColor(it.move1d), fontSize: 13 }}>{pct(it.move1d)}</span>
                    <span style={{ fontSize: 11, fontWeight: 900, color: it.flags?.denial ? C.amber : C.red }}>{it.flags?.denial ? 'DENIED' : 'NEGATIVE'}</span>
                    <CatalystForBadge it={it} />
                    <span style={{ fontSize: 13, color: C.text, flex: '1 1 240px', minWidth: 0 }}>{txt(it.headline, 'Not available')}</span>
                    <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: C.cyan }}>OPEN</button>
                  </div>
                  <div style={{ fontSize: 12, color: C.dim, marginTop: 1 }}>↳ {txt(it.whyResearch, txt(it.expectationGap?.text, 'The move is not supported by the filings.'))}</div>
                </div>
              ))}
            </section>
          )}

          {/* zzz771: real filings older than the move window. Shown apart, collapsed,
              never counted as confirmed and never in the queue — the owner saw a
              47-day-old result presented as the event behind today's move. */}
          {context.length > 0 && (
            <Collapsible testid="older-context" paren title="Older filings — context, not this move’s catalyst" count={context.length}
              sub="Real events filed before the move window. Ranked by their own priority; never the catalyst, never counted as confirmed.">
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))', gap: 10 }}>
                {context.map((it, i) => <ResearchCard key={it.ticker} it={it} rank={i + 1} onOpen={onOpen} older />)}
              </div>
            </Collapsible>
          )}

          <Collapsible testid="no-catalyst" title="NO IDENTIFIED CATALYST" count={noCat.length} sub="Checked: nothing meaningful filed in the window.">
            <ShowAll items={noCat} first={15} render={(it) => <OneLiner key={it.ticker} it={it} onOpen={onOpen} />} />
          </Collapsible>

          {bands.length > 0 && (
            <Collapsible testid="band-prints" title="PRICE-BAND MOVES" count={bands.length} sub="Price-band movement. Does not establish demand.">
              <ShowAll items={bands} first={15} render={(it) => <OneLiner key={it.ticker} it={it} onOpen={onOpen} extra={<BandChip it={it} />} />} />
            </Collapsible>
          )}

          {dq.length > 0 && (
            <Collapsible testid="data-quality" title="DATA QUALITY / NEW LISTINGS" count={dq.length}
              sub={listings.length ? `${listings.length} recent listing${listings.length === 1 ? '' : 's'} excluded from fundamental comparison` : undefined}>
              <ShowAll items={dq} first={15} render={(it) => <OneLiner key={it.ticker} it={it} onOpen={onOpen} extra={<StatusPill it={it} />} />} />
            </Collapsible>
          )}

          {fails.length > 0 && (
            <Collapsible testid="source-failures" title={`⚠ DATA-SOURCE FAILURES`} count={fails.length} color={C.amber} sub="DATA UNAVAILABLE ≠ NO DATA FOUND — the filing source did not answer for these names, so their filings were not checked. The research retries them automatically once; the press line is secondary context, not a finding.">
              {fails.map((f, i) => (
                <div key={`${f.ticker}:${i}`} style={{ fontSize: 12, color: C.dim, padding: '4px 0', borderTop: `1px solid ${C.border}` }}>
                  <div title={f.full || f.text} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b style={{ color: C.text }}>{f.ticker}</b> · {txt(f.text, 'source unavailable')}</div>
                  {f.news?.narrative
                    ? <div style={{ color: C.dim, marginTop: 2 }}>Press (unverified): <b style={{ color: C.text }}>{f.news.narrative.label}</b> story, {f.news.narrative.days} days ({f.news.narrative.firstDate} → {f.news.narrative.lastDate}) — “{f.news.narrative.lead}”</div>
                    : f.news?.items?.[0] ? <div style={{ color: C.dim, marginTop: 2 }}>Press (unverified): {f.news.items[0].date} — <a href={f.news.items[0].url} target="_blank" rel="noopener noreferrer" style={{ color: C.text, textDecoration: 'none' }}>{f.news.items[0].title}</a></div> : null}
                </div>
              ))}
            </Collapsible>
          )}
          {partial.length > 0 && (
            <Collapsible testid="partial-failures" title="PARTIAL DATA — price history missing" count={partial.length} sub="Filings WERE checked for these names; only the price history failed, so the market response and pricing assessment are not measured.">
              {partial.map((f, i) => (
                <div key={`${f.ticker}:${i}`} title={f.full} style={{ fontSize: 12, color: C.dim, padding: '3px 0', borderTop: `1px solid ${C.border}` }}>{f.text}</div>
              ))}
            </Collapsible>
          )}
        </>
      )}

      {technical}

      {openItem && <EventDrawer it={openItem} onClose={onClose} />}
    </div>
  );
}
