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

import React, { useCallback, useMemo, useState } from 'react';
import { useUrlParam } from '@/lib/use-url-param';
import { exchangeStamp } from '@/lib/ai-gainers/research-present';
import { EXTREME_MOVE_PCT, PARTITION_META, type ResearchItem, type ResearchView } from '@/lib/ai-gainers/research-view';
import { ScoreChip } from './ScoreBox';
import { BandChip, Btn, CatalystForBadge, DirectionChip, Move, Name, Pill, ScanNote, SectionHead, SourceBadge, StatusPill, TriagePill, UsCatalystList, InCatalystList, materialWord } from './Badges';
import { EventDrawer } from './EventDrawer';
import { AlsoIn, ResearchCard } from './ResearchCard';
import { WatchDetail, OlderDetail, NoCatalystDetail, NegativeDetail, TechnicalDetail } from './RowDetail';
import { C, CLASS_META, CURRENCY, PRICE_COMMENTARY_LABEL, isPriceCommentary, MATERIAL_COLOR, exchangeClock, moveColor, pct, sessionDate, tint, txt } from './tokens';

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
  /** zzz800: "⬇ Download PDF", shown next to RESCAN. */
  pdfAction?: React.ReactNode;
  /** zzz835: the moment the data on screen was loaded (ISO). Shown on the market's own clock. */
  loadedAt?: string | null;
}

const FILTERS = ['all', 'verified', 'unverified', 'negative', 'book', 'this_move'] as const;
const SORTS = ['rank', 'move', 'name'] as const;
type FilterKey = (typeof FILTERS)[number];
type SortKey = (typeof SORTS)[number];
const FILTER_LABEL: Record<FilterKey, string> = { all: 'All', verified: 'Verified events', unverified: 'Unverified / impact unknown', negative: 'Negative', book: 'In my book', this_move: 'Filed for this move' };
const SORT_LABEL: Record<SortKey, string> = { rank: 'Research rank', move: 'Biggest move first', name: 'Name A-Z' };

function passes(it: ResearchItem, f: FilterKey): boolean {
  switch (f) {
    case 'verified': return it.eventClass === 'CONFIRMED_MATERIAL' || it.eventClass === 'CONFIRMED_LOW_MATERIALITY';
    case 'unverified': return it.eventClass === 'POTENTIAL_UNVERIFIED';
    case 'negative': return it.eventClass === 'NEGATIVE';
    case 'book': return it.portfolio?.relevance === 'HOLDING' || it.portfolio?.relevance === 'WATCHLIST';
    case 'this_move': return it.catalystFor === 'THIS_MOVE';
    default: return true;
  }
}
/** Stable: ties (and missing moves) keep the ranked order, so a sort never shuffles equal items or invents a move. */
function sortItems(items: ResearchItem[], k: SortKey): ResearchItem[] {
  const idx = new Map(items.map((it, i) => [it, i] as const));
  const out = [...items];
  if (k === 'move') out.sort((a, b) => {
    const x = typeof a.move1d === 'number' && Number.isFinite(a.move1d) ? a.move1d : null;
    const y = typeof b.move1d === 'number' && Number.isFinite(b.move1d) ? b.move1d : null;
    if (x === null && y === null) return idx.get(a)! - idx.get(b)!;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x || idx.get(a)! - idx.get(b)!;
  });
  else if (k === 'name') out.sort((a, b) => (txt(a.companyName, '') || a.ticker).localeCompare(txt(b.companyName, '') || b.ticker) || idx.get(a)! - idx.get(b)!);
  return out;
}

const box: React.CSSProperties = { background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '11px 13px', minWidth: 0 };

function Header({ view, market, onRescan, rescanning, toolbar, sessionNote, pdfAction, loadedAt }: Pick<ResearchTriageProps, 'view' | 'onRescan' | 'rescanning' | 'toolbar' | 'sessionNote' | 'pdfAction' | 'loadedAt'> & { market: 'IN' | 'US' }) {
  const s = view.session || { date: null, scanAt: null, status: 'unknown', cached: false };
  // zzz835: every time is on the MARKET's clock (New York for the US, India for India) - never the browser's.
  const generated = exchangeStamp(market, s.generatedAt || s.scanAt);
  const asOf = exchangeStamp(market, s.dataAsOf || s.generatedAt || s.scanAt);
  const loaded = loadedAt ? exchangeClock(market, new Date(loadedAt)) : null;
  const live = s.sessionStatus ? s.sessionStatus === 'live' : /live/i.test(String(s.status || ''));
  const provisional = s.isFinal === false;
  const statusText = live ? 'Live' : /unknown/i.test(String(s.status || '')) || !s.status ? 'Unknown' : s.status;
  const cur = CURRENCY[market];
  const k: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint };
  const v: React.CSSProperties = { fontSize: 13, fontWeight: 800, color: C.text };
  return (
    <header style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '2px 12px' }}>
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: 0.8, color: C.text }}>AI DAILY GAINERS</h1>
        <span title={cur.note} data-testid="currency-badge" style={{ fontSize: 11, fontWeight: 800, color: C.dim, border: `1px solid ${C.border}`, borderRadius: 4, padding: '1px 6px' }}>{market === 'US' ? 'USA' : 'INDIA'} · {cur.symbol} {cur.code}</span>
        <span style={{ fontSize: 13, color: C.dim }}>Fundamental events filed around unusual moves - ranked by research value, not return.</span>
      </div>
      {provisional && (
        <div role="status" data-testid="provisional-banner" style={{ padding: '6px 11px', borderRadius: 8, border: `1px solid ${C.amber}`, background: tint(C.amber, 12), color: C.text, fontSize: 13, lineHeight: 1.45 }}>
          <b style={{ color: C.amber, letterSpacing: 0.5 }}>PROVISIONAL</b> - {txt(s.runReason, 'The session has not closed, so these moves and rankings can still change.').replace(/^\s*PROVISIONAL\s*[-—–:]*\s*/i, '')} Do not treat the ranking as final.
        </div>
      )}
      <div data-testid="session-block" style={{
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '3px 14px', padding: '6px 11px', borderRadius: 8,
        background: C.bg, border: `1px solid ${live ? C.cyan : C.border}`,
      }}>
        <span><span style={k}>SESSION DATE </span><span style={v}>{sessionDate(s.sessionDate || s.date) || 'Unknown'}</span></span>
        <span title="When this scan was generated, on the exchange's clock."><span style={k}>GENERATED </span><span style={v}>{generated || 'Unknown'}</span></span>
        {asOf && asOf !== generated && <span title="When the prices were read."><span style={k}>DATA AS OF </span><span style={v}>{asOf}</span></span>}
        {loaded && <span title="When this page last loaded the data, on the exchange's clock."><span style={k}>LOADED </span><span style={v}>{loaded}</span></span>}
        <span><span style={k}>STATUS </span><span style={{ ...v, color: live ? C.cyan : provisional ? C.amber : C.text }}>{statusText}{provisional ? ' · PROVISIONAL' : s.isFinal ? ' · final' : ''}</span></span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span style={k}>DATA</span>
          <span style={{ fontSize: 13, color: s.cached ? C.dim : C.green, fontWeight: s.cached ? 400 : 700 }}>{s.cached ? 'Cached' : '✓ Live scan completed'}</span>
          {onRescan && <Btn onClick={onRescan} title="Re-reads the gainers screen now and any new exchange announcements (AI reads, only on this click).">{rescanning ? 'SCANNING…' : '↻ RESCAN'}</Btn>}
          {pdfAction}
        </span>
        {sessionNote && <span style={{ fontSize: 12, color: C.faint, flexBasis: '100%' }}>{sessionNote}</span>}
        {view.scanCriteria && <span data-testid="scan-criteria" style={{ fontSize: 12, color: C.dim, flexBasis: '100%' }}><span style={k}>SCAN CRITERIA </span>{view.scanCriteria}</span>}
        {!live && !provisional && s.date && /last|previous|closed/i.test(String(s.status)) && (
          <span style={{ fontSize: 12, color: C.amber, flexBasis: '100%' }}>These are the last completed session&rsquo;s moves - not today&rsquo;s.</span>
        )}
      </div>
      {toolbar && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>{toolbar}</div>}
    </header>
  );
}

/** Banner counts: the numbers the reader checks first (both markets). */
function BannerCounts({ view }: { view: ResearchView }) {
  const b = view.banner;
  if (!b) return null;
  // zzz836: ONE partition line - every scanned name in exactly one bucket, the counts add up to the scanned total.
  if (view.partition) {
    const p = view.partition;
    const shown = p.buckets.filter((x) => PARTITION_META[x.key].core || x.count > 0);
    return (
      <div data-testid="partition-line" style={{ ...box, padding: '6px 11px', display: 'flex', flexWrap: 'wrap', gap: '3px 10px', alignItems: 'baseline' }}>
        <b style={{ fontSize: 17, color: C.text }}>{p.scanned}</b><span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>SCANNED =</span>
        {shown.map((x, i) => (
          <span key={x.key} title={`${x.meaning}${x.tickers.length ? `\n${x.tickers.slice(0, 40).join(', ')}` : ''}`} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
            {i > 0 && <span style={{ color: C.faint }}>+</span>}
            <b style={{ fontSize: 16, color: x.count > 0 ? (x.key === 'confirmed' ? C.green : x.key === 'negative' ? C.red : x.key === 'identified_impact_unknown' || x.key === 'secondary_unverified' || x.key === 'data_unavailable' ? C.amber : C.text) : C.faint }}>{x.count}</b>
            <span style={{ fontSize: 12, color: C.dim }}>{x.label.toLowerCase()}</span>
          </span>
        ))}
        {b.provisional && <span style={{ fontSize: 11, fontWeight: 900, color: C.amber, letterSpacing: 0.5 }}>PROVISIONAL</span>}
      </div>
    );
  }
  const cells: Array<{ n: number; l: string; color?: string; title: string }> = [
    { n: b.scanned, l: 'Scanned', title: 'Names on this session’s board.' },
    { n: b.verified, l: 'Verified', color: C.green, title: 'Event verified from the filing and its size judged.' },
    { n: b.unverified, l: 'Unverified', color: C.amber, title: 'An event was found, but its impact or its source is not verified.' },
    { n: b.conflicts, l: 'Conflicts', color: C.red, title: 'Names where a headline value and a filed value disagree. Zero when none was flagged - not proof there are none.' },
    { n: b.noMaterialCatalyst, l: 'No material catalyst', title: 'No catalyst found, price-band / technical only, or only an older filing. Not negative.' },
  ];
  return (
    <div data-testid="banner-counts" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', alignItems: 'baseline', ...box, padding: '6px 11px' }}>
      {cells.map((c) => (
        <span key={c.l} title={c.title} style={{ display: 'inline-flex', alignItems: 'baseline', gap: 5 }}>
          <b style={{ fontSize: 17, color: c.n > 0 ? (c.color || C.text) : C.faint }}>{Number.isFinite(c.n) ? c.n : 0}</b>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>{c.l.toUpperCase()}</span>
        </span>
      ))}
      {b.provisional && <span style={{ fontSize: 11, fontWeight: 900, color: C.amber, letterSpacing: 0.5 }}>PROVISIONAL</span>}
    </div>
  );
}

function Summary({ view }: { view: ResearchView }) {
  const s = view.summary;
  // Hover breakdown: which names sit behind each tile (same lists as the sections below).
  const all = new Map<string, ResearchItem>();
  for (const it of [...(view.queue || []), ...(view.watch || []), ...(view.negative || []), ...(view.immaterialNegative || []), ...(view.noCatalyst || []), ...(view.dataQuality || []), ...(view.context || []), ...(view.needsReading || [])]) if (!all.has(it.ticker)) all.set(it.ticker, it);
  const names = (pred: (it: ResearchItem) => boolean) => {
    const t = [...all.values()].filter(pred).map((i) => txt(i.displayTicker, '') || i.ticker);
    return t.length ? `\n${t.slice(0, 40).join(', ')}${t.length > 40 ? ', …' : ''}` : '';
  };
  const cards: Array<{ n: number; l: string; color?: string; title: string }> = view.partition ? [] : [
    { n: s.scanned, l: 'Gainers scanned', title: 'Names on this session’s board.' },
    { n: s.confirmed, l: 'Verified events', color: C.green, title: 'Event verified from the filing AND its size judged (material or small). Verified ≠ a confirmed catalyst for the move.' + names((it) => it.eventClass === 'CONFIRMED_MATERIAL' || it.eventClass === 'CONFIRMED_LOW_MATERIALITY') },
    { n: s.potential, l: 'Impact unknown / unverified', color: C.amber, title: 'Either the event is filed but its size / materiality is not established, or the source itself is not verified.' + names((it) => it.eventClass === 'POTENTIAL_UNVERIFIED') },
    { n: s.negative, l: 'Negative evidence', color: C.red, title: 'Genuine negative filings (tax demands, departures, cancellations) or a company denial — kept even though the stock rose.' + names((it) => it.eventClass === 'NEGATIVE') },
    { n: s.noCatalyst, l: 'No clear catalyst', title: 'Checked: no credible event found.' + names((it) => it.eventClass === 'NO_CATALYST' || it.eventClass === 'MARKET_MOVE_ONLY') },
    { n: s.queue, l: 'Research queue', color: C.cyan, title: 'Names that deserve research time today.' },
    { n: s.portfolioMatches, l: 'Portfolio matches', color: C.cyan, title: 'Names in or related to your book.' },
  ];
  if (view.partition) {
    // zzz836: the tiles ARE the partition (mutually exclusive, adding up to scanned); queue / book / conflicts are overlays, shown apart.
    const p = view.partition;
    const colors: Record<string, string | undefined> = { confirmed: C.green, identified_impact_unknown: C.amber, secondary_unverified: C.amber, negative: C.red, data_unavailable: C.amber };
    for (const b of p.buckets) if (PARTITION_META[b.key].core || b.count > 0) cards.push({ n: b.count, l: b.label, color: colors[b.key], title: `${b.meaning}${b.tickers.length ? `\n${b.tickers.slice(0, 40).join(', ')}` : ''}` });
  }
  if (!view.partition && s.dataUnavailable > 0) cards.push({ n: s.dataUnavailable, l: 'Data unavailable', color: C.amber, title: 'Sources failed — not the same as “no catalyst”.' });
  // zzz771: older filings are counted once, here, and nowhere else — they are
  // not confirmed events and not in the queue. Hidden when the pipeline did
  // not supply the count (older cached views).
  if (!view.partition && typeof s.context === 'number' && s.context > 0) cards.push({ n: s.context, l: 'Older context', title: 'Names whose only event is older than the move window — context, not this move’s catalyst.' });
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
      {view.partition && (
        <div data-testid="overlays" style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint, marginRight: 6 }}>OVERLAYS - TAGS, NOT STATUSES (they cut across the counts above)</span>
          Research queue <b style={{ color: C.text }}>{view.partition.overlays.queue}</b> · Watch <b style={{ color: C.text }}>{view.partition.overlays.watch}</b> · Portfolio match <b style={{ color: C.text }}>{view.partition.overlays.portfolio}</b> · Conflicts <b style={{ color: view.partition.overlays.conflicts ? C.red : C.text }}>{view.partition.overlays.conflicts}</b>
        </div>
      )}
      <CatalystCategories view={view} />
    </section>
  );
}

/** zzz801/835 (both markets): the catalysts found across the board, by category -
 *  names with a filed catalyst vs press only. */
function CatalystCategories({ view }: { view: ResearchView }) {
  const u = view.summary?.catalysts || view.summary?.usCatalysts;
  if (!u) return null;
  return (
    <div data-testid="catalyst-categories" style={{ ...box, padding: '7px 11px', marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'baseline', fontSize: 12.5, color: C.dim }}>
      <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.5, color: C.faint }}>CATALYSTS FOUND BY CATEGORY</span>
      {u.byCategory.map((c) => (
        <span key={c.category} title={`${c.tickers.join(', ')}${c.press ? ` — ${c.press} name${c.press === 1 ? '' : 's'} from the press only (not verified in a filing)` : ''}`}>
          <b style={{ color: C.text }}>{c.category}</b> {c.names}{c.press ? <span style={{ color: C.amber }}> ({c.press} press only)</span> : null}
        </span>
      ))}
      <span style={{ color: C.faint, flexBasis: '100%' }}>{u.found} name{u.found === 1 ? '' : 's'} with a catalyst found in {(u as { market?: string }).market === 'IN' ? 'exchange filings or news' : 'filings or news'} · {u.none} with none found (not negative — nothing in the filings or news names one).</span>
    </div>
  );
}

function Top3({ items, onOpen, provisional }: { items: ResearchItem[]; onOpen: (it: ResearchItem) => void; provisional?: boolean }) {
  if (!items.length) return null;
  return (
    <section aria-label="Top 3 research priorities">
      <SectionHead title="TOP 3 RESEARCH PRIORITIES" right={provisional ? <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.5, color: C.amber }}>PROVISIONAL</span> : undefined} />
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
            {it.rankReason && <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.45 }}>Rank basis: {it.rankReason}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
              <TriagePill it={it} />
              <ScoreChip it={it} />
              <Pill color={MATERIAL_COLOR[it.materiality?.label || 'UNKNOWN']} title={it.materiality?.explanation || ''}>{materialWord(it)}</Pill>
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
export function OneLiner({ it, onOpen, extra, kind }: { it: ResearchItem; onOpen?: (it: ResearchItem) => void; extra?: React.ReactNode; kind?: 'nocat' | 'technical' }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 9px', alignItems: 'baseline', padding: '4px 0', borderTop: `1px solid ${C.border}`, fontSize: 13, minWidth: 0 }}>
      <Name it={it} max={160} />
      <span style={{ fontWeight: 800, color: moveColor(it.move1d) }}>{pct(it.move1d)}</span>
      <span style={{ color: C.dim, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 220px' }} title={it.headline}>{txt(it.headline, 'No meaningful filing')}</span>
      {it.eventClass === 'NO_CATALYST' && it.flags?.denial && <StatusPill it={it} />}
      {/* zzz785: No catalyst / Evidence incomplete / Unclassified are three different answers. */}
      {it.evidenceGap && !(it.eventClass === 'NO_CATALYST' && it.flags?.denial) && <Pill color={it.evidenceGap.code === 'NO_CATALYST' ? C.faint : C.amber} title={it.evidenceGap.text}>{it.evidenceGap.label.toUpperCase()}</Pill>}
      <CatalystForBadge it={it} />
      {extra}
      {onOpen && <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, color: C.cyan }}>details</button>}
      {it.eventClass === 'NO_CATALYST' && it.scanNote && <div style={{ flexBasis: '100%' }}><ScanNote it={it} /></div>}
      {it.market === 'US' && it.usCard?.catalysts && <div style={{ flexBasis: '100%' }}><UsCatalystList it={it} compact /></div>}
      {it.market === 'IN' && it.inCard && <div style={{ flexBasis: '100%' }}><InCatalystList it={it} compact /></div>}
      {it.news?.narrative && <div style={{ flexBasis: '100%', fontSize: 12, color: C.dim }}>{isPriceCommentary(it.news.narrative.label) ? PRICE_COMMENTARY_LABEL : 'Press (unverified)'}: <b style={{ color: C.text }}>{it.news.narrative.label}</b> story over {it.news.narrative.days} days ({it.news.narrative.firstDate} → {it.news.narrative.lastDate}) — “{it.news.narrative.lead}”</div>}
      {/* zzz841: what was searched, the plain "not negative", any press seen; large moves get the facts and the open question. */}
      {kind === 'nocat' && <div style={{ flexBasis: '100%' }}><NoCatalystDetail it={it} /></div>}
      {kind === 'technical' && <div style={{ flexBasis: '100%' }}><TechnicalDetail it={it} /></div>}
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

function Book({ items, onOpen, checked, market }: { items: ResearchItem[]; onOpen: (it: ResearchItem) => void; checked?: { held: number; watch: number } | null; market: 'IN' | 'US' }) {
  if (!items.length) {
    // Same section in both markets: say what was checked. Zero supplied names means no match was possible - not "nothing matched".
    if (!checked) return null;
    const none = checked.held + checked.watch === 0;
    return (
      <section aria-label="Your book" data-testid="book-empty" style={{ ...box, padding: '7px 12px' }}>
        <SectionHead title="YOUR BOOK" count={0} />
        <div style={{ fontSize: 12.5, color: C.dim }}>
          {none
            ? `No ${market === 'US' ? 'US' : 'India'} holdings or watchlist names are on file, so no gainer could be matched to your book. Add them in the Book page.`
            : `Checked ${checked.held} held and ${checked.watch} watched ${market === 'US' ? 'US' : 'India'} name${checked.held + checked.watch === 1 ? '' : 's'}: none is on today's board.`}
        </div>
      </section>
    );
  }
  const th: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint, textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { fontSize: 13, color: C.dim, padding: '6px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };
  return (
    <section aria-label="Your book" style={box}>
      <SectionHead title="YOUR BOOK" count={items.length} sub="Position reviews against your thesis — not trade instructions." />
      <div style={{ overflowX: 'auto' }}>
        <table className="mc-sticky-first" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 680 }}>
          <thead><tr><th style={th}>Name</th><th style={th}>1D</th><th style={th}>Event</th><th style={th}>Thesis variable</th><th style={th}>Materiality</th><th style={th}>Research next</th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.ticker}>
                <td style={td}>
                  <span style={{ color: C.cyan, fontWeight: 900, marginRight: 5 }} title={it.portfolio?.relevance === 'HOLDING' ? 'In your book' : txt(it.portfolio?.relevance, '')}>{it.portfolio?.relevance === 'HOLDING' ? '✓' : '◇'}</span>
                  <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 900, color: C.text }}>{txt(it.displayTicker, '') || it.ticker}</button>
                </td>
                <td style={{ ...td, color: moveColor(it.move1d), fontWeight: 800 }}>{pct(it.move1d)}</td>
                <td style={{ ...td, minWidth: 220 }}><div style={{ color: C.text }}>{txt(it.headline, 'No event')}</div><div style={{ marginTop: 3 }}><StatusPill it={it} /></div><AlsoIn it={it} here="Your book" /></td>
                <td style={td}>{txt(it.portfolio?.thesisVariable, 'Not mapped')}</td>
                <td style={{ ...td, color: MATERIAL_COLOR[it.materiality?.label || 'UNKNOWN'], fontWeight: 800 }} title={it.materiality?.explanation}>{materialWord(it)}</td>
                <td style={{ ...td, minWidth: 200 }}>{(it.researchNext || []).slice(0, 2).map((q, i) => <div key={i}>→ {q}</div>)}{!(it.researchNext || []).length && <span style={{ color: C.faint }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Controls({ filter, setFilter, sort, setSort, shown, total }: { filter: FilterKey; setFilter: (v: FilterKey) => void; sort: SortKey; setSort: (v: SortKey) => void; shown: number; total: number }) {
  const sel: React.CSSProperties = { fontSize: 12, padding: '3px 6px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.bg, color: C.text };
  return (
    <div data-testid="controls" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', fontSize: 12, color: C.dim }}>
      <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>Show
        <select aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value as FilterKey)} style={sel}>
          {FILTERS.map((f) => <option key={f} value={f}>{FILTER_LABEL[f]}</option>)}
        </select>
      </label>
      <label style={{ display: 'inline-flex', gap: 5, alignItems: 'center' }}>Sort by
        <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} style={sel}>
          {SORTS.map((f) => <option key={f} value={f}>{SORT_LABEL[f]}</option>)}
        </select>
      </label>
      {(filter !== 'all' || sort !== 'rank') && (
        <>
          <span style={{ color: C.faint }}>{shown} of {total} names in the queue and watch list{sort === 'move' ? ' (sorted by move - the research rank number stays on each card)' : ''}</span>
          <button type="button" onClick={() => { setFilter('all'); setSort('rank'); }} style={{ all: 'unset', cursor: 'pointer', color: C.cyan, fontWeight: 800 }}>reset</button>
        </>
      )}
    </div>
  );
}

const thS: React.CSSProperties = { fontSize: 11, fontWeight: 800, letterSpacing: 0.4, color: C.faint, textAlign: 'left', padding: '4px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
const tdS: React.CSSProperties = { fontSize: 13, color: C.dim, padding: '5px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };

/** OLDER FILINGS as a table - same columns for India and the US. Horizontally scrollable on a phone. */
export function OlderTable({ rows, items, onOpen }: { rows: NonNullable<ResearchView['olderFilings']>; items: ResearchItem[]; onOpen: (it: ResearchItem) => void }) {
  const byT = new Map(items.map((i) => [i.ticker, i] as const));
  return (
    <div style={{ overflowX: 'auto' }} data-testid="older-table">
      <table className="mc-sticky-first" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 700 }}>
        <thead><tr><th style={thS}>Company</th><th style={thS}>Move</th><th style={thS}>Filed</th><th style={thS}>Age</th><th style={thS}>Event</th><th style={thS}>Size</th><th style={thS}>Source</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const it = byT.get(r.ticker);
            return (
              <tr key={r.ticker}>
                <td style={tdS}><b style={{ color: C.text }}>{txt(r.company, r.name)}</b>{r.name && r.name !== r.company ? <span style={{ color: C.faint, fontSize: 12 }}> {r.name}</span> : null}</td>
                <td style={{ ...tdS, color: moveColor(r.movePct), fontWeight: 800 }}>{pct(r.movePct)}</td>
                <td style={tdS}>{txt(r.filedDate ? r.filedDate.slice(0, 10) : null, 'Not disclosed')}</td>
                <td style={tdS}>{r.ageDays != null ? `${r.ageDays} days` : 'Not disclosed'}</td>
                <td style={{ ...tdS, minWidth: 200 }}>{txt(r.eventLabel || r.event, 'Not disclosed')}{it && <OlderDetail it={it} />}{it && <> <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, color: C.cyan }}>details</button></>}</td>
                <td style={tdS}>{txt(r.material, 'Not disclosed')}</td>
                <td style={tdS}>{r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan, textDecoration: 'none' }}>open filing</a> : <span style={{ color: C.faint }}>no link</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const NOTE_KIND: Record<string, string> = { new_listing: 'NEW LISTING', spac: 'SPAC / SHELL', adr: 'ADR / FOREIGN', extreme_move: 'EXTREME MOVE', band_move: 'PRICE-BAND MOVE' };
function DataNotesTable({ rows }: { rows: NonNullable<ResearchView['dataNotes']> }) {
  return (
    <div style={{ overflowX: 'auto', marginBottom: 6 }} data-testid="data-notes-table">
      <table className="mc-sticky-first" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
        <thead><tr><th style={thS}>Company</th><th style={thS}>Move</th><th style={thS}>Note</th><th style={thS}>Why it is flagged</th></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.ticker}:${r.kind}:${i}`}>
              <td style={tdS}><b style={{ color: C.text }}>{txt(r.company, r.name)}</b></td>
              <td style={{ ...tdS, color: moveColor(r.movePct), fontWeight: 800 }}>{pct(r.movePct)}</td>
              <td style={tdS}><Pill color={C.faint}>{NOTE_KIND[r.kind] || r.kind}</Pill></td>
              <td style={{ ...tdS, minWidth: 240 }}>{r.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResearchTriage(props: ResearchTriageProps) {
  const { view, notice, technical } = props;
  const [openItem, setOpenItem] = useState<ResearchItem | null>(null);
  const onOpen = useCallback((it: ResearchItem) => setOpenItem(it), []);
  const onClose = useCallback(() => setOpenItem(null), []);
  // zzz835: filter and sort live in the URL (?show=…&sort=…), the same controls in both markets.
  const [filter, setFilter] = useUrlParam<FilterKey>('show', 'all', FILTERS);
  const [sort, setSort] = useUrlParam<SortKey>('sort', 'rank', SORTS);
  const rankOf = useMemo(() => new Map((view.queue || []).map((i, n) => [i.ticker, n + 1] as const)), [view.queue]);
  const queueShown = useMemo(() => sortItems((view.queue || []).filter((i) => passes(i, filter)), sort), [view.queue, filter, sort]);
  const watchShown = useMemo(() => sortItems((view.watch || []).filter((i) => passes(i, filter)), sort), [view.watch, filter, sort]);
  const provisional = view.session?.isFinal === false;

  const isBand = (it: ResearchItem) => it.eventClass === 'MARKET_MOVE_ONLY';
  const noCat = (view.noCatalyst || []).filter((it) => !isBand(it));
  const bands = [...(view.noCatalyst || []), ...(view.dataQuality || [])].filter(isBand);
  const dq = (view.dataQuality || []).filter((it) => !isBand(it));
  const listings = dq.filter((it) => it.eventClass === 'LISTING' || it.flags?.listing);
  const notes = view.dataNotes || [];
  const bandNotes = notes.filter((n) => n.kind === 'extreme_move' || n.kind === 'band_move');
  const listNotes = notes.filter((n) => n.kind === 'new_listing' || n.kind === 'spac' || n.kind === 'adr');
  // A name in a notes table is not repeated as a one-liner in the same section.
  const bandNoteT = new Set(bandNotes.map((n) => n.ticker));
  const listNoteT = new Set(listNotes.map((n) => n.ticker));
  const bandsRest = bands.filter((i) => !bandNoteT.has(i.ticker));
  const dqRest = dq.filter((i) => !listNoteT.has(i.ticker));
  const nListings = new Set([...listings.map((i) => i.ticker), ...listNotes.filter((n) => n.kind === 'new_listing').map((n) => n.ticker)]).size;
  const fails = view.sourceFailures || [];
  const partial = view.partialFailures || [];
  const context = view.context || [];   // zzz771: absent on older cached views → section hidden
  const empty = (view.summary?.scanned || 0) === 0;
  // zzz789: a needs-reading event already shown in the queue / watch is referenced, not listed twice.
  const shownAbove = new Set([...(view.queue || []), ...(view.watch || [])].map((i) => i.ticker));
  const needsOnly = (view.needsReading || []).filter((i) => !shownAbove.has(i.ticker));
  const needsElsewhere = (view.needsReading || []).filter((i) => shownAbove.has(i.ticker));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
      <Header {...props} market={props.market} />
      {notice}

      {empty ? (
        <div style={{ ...box, fontSize: 13, color: C.dim }}>
          No gainers on this board for this session. That is a real answer for this scan, not a loading state — press ↻ Rescan to read the screen again.
        </div>
      ) : (
        <>
          <BannerCounts view={view} />
          <Summary view={view} />
          <Top3 items={view.top3 || []} onOpen={onOpen} provisional={provisional} />

          <section aria-label="Research queue">
            <SectionHead title="RESEARCH QUEUE" count={(view.queue || []).length} sub="Ranked by research value. Price is context, never the ranking."
              right={provisional ? <span data-testid="queue-provisional" title={view.session?.runReason || 'The session has not closed.'} style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.5, color: C.amber, border: `1px solid ${C.amber}`, borderRadius: 4, padding: '1px 6px' }}>PROVISIONAL RANKING</span> : undefined} />
            <div style={{ marginBottom: 8 }}><Controls filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} shown={queueShown.length + watchShown.length} total={(view.queue || []).length + (view.watch || []).length} /></div>
            {(view.queue || []).length > 0 && queueShown.length === 0 ? (
              <div style={{ ...box, fontSize: 13, color: C.dim }}>No queue name matches this filter. Choose “All” to see the whole queue.</div>
            ) : (view.queue || []).length === 0 ? (
              <div style={{ ...box, fontSize: 13, color: C.dim }}>
                No name on this board carries an event that deserves research time — a valid result, not an empty page.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))', gap: 10 }}>
                {queueShown.map((it) => <ResearchCard key={it.ticker} it={it} rank={rankOf.get(it.ticker) || 0} onOpen={onOpen} section="Research queue" />)}
              </div>
            )}
          </section>

          <Book items={view.portfolio || []} onOpen={onOpen} checked={view.bookChecked} market={props.market} />

          {/* zzz785: unknown economics are never sorted away silently — every one is listed, ranked, labelled. */}
          {/* zzz789: one canonical event per card — a name already shown in the queue / watch is REFERENCED here, not repeated. */}
          {needsOnly.length === 0 && needsElsewhere.length > 0 && (
            <div data-testid="needs-reading-refs" style={{ fontSize: 12, color: C.faint }}>
              Events with unknown size are all shown above ({needsElsewhere.length}); none is listed only here.
            </div>
          )}
          {needsOnly.length > 0 && (
            <section aria-label="Unknown — needs reading" data-testid="needs-reading" style={box}>
              <SectionHead title="UNKNOWN — NEEDS READING" count={needsOnly.length} sub="Events whose size is not established yet. Unknown is not negative: each needs its document read." />
              {needsElsewhere.length > 0 && (
                <div data-testid="needs-reading-refs" style={{ fontSize: 12, color: C.faint, padding: '2px 0 4px' }}>
                  Same events, shown above (not repeated): {needsElsewhere.map((it, i) => <span key={it.ticker}>{i ? ' · ' : ''}<button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 800, color: C.dim }}>{txt(it.displayTicker, '') || it.ticker}</button> ({(it.surfacedIn || []).filter((x) => x !== 'Unknown — needs reading' && x !== 'Your book').join(', ')})</span>)}
                </div>
              )}
              {needsOnly.map((it) => (
                <div key={it.ticker} style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 9px', alignItems: 'baseline', padding: '4px 0', borderTop: `1px solid ${C.border}`, fontSize: 13, minWidth: 0 }}>
                  <Name it={it} max={150} />
                  <Move it={it} />
                  <span style={{ color: C.text, flex: '1 1 240px', minWidth: 0 }}>{txt(it.headline, 'Headline not available')}</span>
                  <span style={{ color: C.faint, fontSize: 12 }}>{it.economicsUnknown?.missing.length ? `missing: ${it.economicsUnknown.missing.join(', ')}` : 'size not stated'}</span>
                  <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: C.cyan }}>OPEN</button>
                </div>
              ))}
            </section>
          )}

          {watchShown.length > 0 && (
            <section aria-label="Watch / investigate" style={box}>
              <SectionHead title="WATCH / INVESTIGATE" count={watchShown.length} sub="Real but smaller, or not yet verified." />
              {watchShown.map((it) => (
                <div key={it.ticker} style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 9px', alignItems: 'baseline', padding: '5px 0', borderTop: `1px solid ${C.border}`, opacity: it.sourceConfidence === 'UNVERIFIED' ? 0.82 : 1, minWidth: 0 }}>
                  <Name it={it} max={150} />
                  <Move it={it} />
                  <span style={{ fontSize: 13, color: C.text, flex: '1 1 260px', minWidth: 0 }}>{txt(it.headline, 'Headline not available')}</span>
                  <span style={{ display: 'inline-flex', gap: 5, flexWrap: 'wrap' }}>
                    <Pill color={(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).color} title={(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).meaning}>{(CLASS_META[it.eventClass] || CLASS_META.NO_CATALYST).short.toUpperCase()}</Pill>
                    <CatalystForBadge it={it} />
                    <DirectionChip it={it} />
                    <SourceBadge it={it} />
                    <BandChip it={it} />
                    {it.persistentCatalyst && (it.persistentCatalyst.specialFocus || it.persistentCatalyst.confidence === 'HIGH' || it.persistentCatalyst.confidence === 'MEDIUM') && (
                      <Pill color={C.amber} title={`${it.persistentCatalyst.label}: ${it.persistentCatalyst.mechanism}. Runway: ${it.persistentCatalyst.runway}`}>🔥 {it.persistentCatalyst.specialFocus ? 'SPECIAL FOCUS' : 'PERSISTENT?'}</Pill>
                    )}
                    {it.economicsUnknown && <Pill color={C.amber} title={it.economicsUnknown.missing.length ? `Missing: ${it.economicsUnknown.missing.join(', ')}` : 'Size not stated'}>NEEDS READING</Pill>}
                  </span>
                  {it.market === 'US' && it.usCard?.catalysts && <div style={{ flexBasis: '100%' }}><UsCatalystList it={it} compact /></div>}
      {it.market === 'IN' && it.inCard && <div style={{ flexBasis: '100%' }}><InCatalystList it={it} compact /></div>}
                  <WatchDetail it={it} />
                  <div style={{ flexBasis: '100%' }}><AlsoIn it={it} here="Watch / investigate" /></div>
                  <button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 800, color: C.cyan }}>OPEN</button>
                </div>
              ))}
            </section>
          )}

          {(view.immaterialNegative || []).length > 0 && (
            <div style={{ fontSize: 12.5, color: C.faint, padding: '2px 4px' }}>
              ⚪ Immaterial tax / penalty items (under 0.25% of market cap — recorded, not ranked as negative evidence):{' '}
              {view.immaterialNegative!.map((it, i) => (
                <span key={it.ticker}>{i ? ' · ' : ''}<button type="button" onClick={() => onOpen(it)} style={{ all: 'unset', cursor: 'pointer', fontWeight: 800, color: C.dim }}>{it.ticker}</button> ({it.materiality?.ratios?.[0]?.text || 'size not stated'})</span>
              ))}
            </div>
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
                  <div style={{ marginTop: 2, paddingLeft: 12 }}><NegativeDetail it={it} /></div>
                </div>
              ))}
            </section>
          )}

          {/* zzz771: real filings older than the move window. Shown apart, collapsed,
              never counted as confirmed and never in the queue — the owner saw a
              47-day-old result presented as the event behind today's move. */}
          {context.length > 0 && (
            <Collapsible testid="older-context" paren title="Older filings — context, not this move’s catalyst" count={context.length}
              sub="Real events filed before the move window. Never the catalyst, never counted as confirmed.">
              {(view.olderFilings || []).length > 0
                ? <OlderTable rows={view.olderFilings!} items={context} onOpen={onOpen} />
                : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 560px), 1fr))', gap: 10 }}>
                    {context.map((it, i) => <ResearchCard key={it.ticker} it={it} rank={i + 1} onOpen={onOpen} older />)}
                  </div>
                )}
            </Collapsible>
          )}

          <Collapsible testid="no-catalyst" title="NO IDENTIFIED CATALYST" count={noCat.length} sub="Checked: nothing meaningful filed in the window.">
            <ShowAll items={noCat} first={15} render={(it) => <OneLiner key={it.ticker} it={it} onOpen={onOpen} kind="nocat" />} />
          </Collapsible>

          {(bandsRest.length > 0 || bandNotes.length > 0) && (
            <Collapsible testid="band-prints" title={props.market === 'US' ? 'LARGE / TECHNICAL MOVES' : 'PRICE-BAND MOVES'} count={bandsRest.length + bandNoteT.size}
              sub={props.market === 'US' ? `Moves of ${EXTREME_MOVE_PCT}% or more, or price-only prints with no filing. Size of move does not establish demand.` : 'Price-band movement. Does not establish demand.'}>
              {bandNotes.length > 0 && <DataNotesTable rows={bandNotes} />}
              <ShowAll items={bandsRest} first={15} render={(it) => <OneLiner key={it.ticker} it={it} onOpen={onOpen} extra={<BandChip it={it} />} kind="technical" />} />
            </Collapsible>
          )}

          {(dqRest.length > 0 || listNotes.length > 0) && (
            <Collapsible testid="data-quality" title="DATA QUALITY / NEW LISTINGS" count={dqRest.length + listNoteT.size}
              sub={nListings ? `${nListings} recent listing${nListings === 1 ? '' : 's'} excluded from fundamental comparison` : undefined}>
              {listNotes.length > 0 && <DataNotesTable rows={listNotes} />}
              <ShowAll items={dqRest} first={15} render={(it) => <OneLiner key={it.ticker} it={it} onOpen={onOpen} extra={<StatusPill it={it} />} />} />
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
