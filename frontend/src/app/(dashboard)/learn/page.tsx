'use client';

// zzz-learn-full-v2 — Investing Playbook (learning) tab.
// Content in ./book-data.ts (bundled at build — no fetch, no 404). Carries EVERY
// line from Investing Book 1 + Book 2 (only whole duplicate sections merged; NO
// per-line deletion): 104 sections, ~2,150 sub-sections, ~30,300 lines.
// Reading-optimised: fixed reading column, per-section "what you'll learn" blurb,
// prev/next navigation, progress, sub-section jump list, full-text search.

import React, { useMemo, useState, useEffect, useRef } from 'react';
import { BOOK, type Part } from './book-data';
import { FIRST_PRINCIPLES, FP_INTRO, FP_TAG_META } from './learn-intro';
import { LEARN_EXAMPLES, type LearnExample } from './learn-examples';

// zzz407 — real-world example callouts, colored by teaching intent.
const EX_TAG_META: Record<LearnExample['tag'], { label: string; color: string; icon: string }> = {
  worked: { label: 'WORKED EXAMPLE', color: '#22C55E', icon: '🧮' },
  scenario: { label: 'REAL SCENARIO', color: '#06B6D4', icon: '🎯' },
  pitfall: { label: 'COMMON PITFALL', color: '#F59E0B', icon: '⚠' },
};

const C = {
  bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937',
  text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B',
  cyan: '#06B6D4', gold: '#FBBF24', purple: '#A78BFA', green: '#22C55E', amber: '#F59E0B',
};

function partLines(p: Part): number {
  return (p.paras?.length || 0) + p.subs.reduce((n, s) => n + s.paras.length + 1, 0);
}

// zzz402 — the two Books (1, 2) the parts group under.
const ALL_BOOKS = Array.from(new Set(BOOK.map(p => p.book)));

// Persist reading position (active section + expanded sections) across visits.
const LS_PROGRESS = 'mc:learn:progress:v1';

// Map each real-world example to the most relevant live tool route.
const TOOL_ROUTES = {
  valuation: { href: '/valuation-calc', label: 'Valuation calculator' },
  screener: { href: '/screener', label: 'Screener' },
  multibagger: { href: '/multibagger', label: 'Multibagger finder' },
  returns: { href: '/historical-returns', label: 'Historical returns' },
  journey: { href: '/journey', label: 'Investor journey' },
} as const;
function pickToolRoute(ex: LearnExample): { href: string; label: string } {
  const hay = (ex.title + ' ' + ex.body.join(' ') + ' ' + (ex.numbers?.map(n => n.label + ' ' + n.value).join(' ') || '')).toLowerCase();
  const has = (kws: string[]) => kws.some(k => hay.includes(k));
  if (has(['multibagger', 'multi-bagger', 'bagger', '10x', '100x', '10-bagger', 'hundred-bagger', 'tenbagger'])) return TOOL_ROUTES.multibagger;
  if (has(['valuation', 'intrinsic', 'dcf', 'p/e', 'pe ratio', 'fair value', 'discount rate', 'multiple', 'ev/ebitda', 'price to', 'overvalu', 'undervalu', 'margin of safety'])) return TOOL_ROUTES.valuation;
  if (has(['screen', 'filter', 'roe', 'roce', 'debt', 'balance sheet', 'ratio', 'cash flow', 'quality', 'red flag', 'promoter', 'pledge', 'metric', 'margin'])) return TOOL_ROUTES.screener;
  if (has(['cagr', 'index', 'nifty', 'nasdaq', 'return', 'sip', 'historical', 'decade', 'rolling', 'compound'])) return TOOL_ROUTES.returns;
  if (has(['portfolio', 'allocation', 'journey', 'goal', 'plan', 'diversif', 'position siz', 'rebalanc', 'asset'])) return TOOL_ROUTES.journey;
  return TOOL_ROUTES.screener;
}

export default function InvestingPlaybookPage() {
  const [activePart, setActivePart] = useState<number>(0);
  const [activeSub, setActiveSub] = useState<number>(-1);
  const [q, setQ] = useState<string>('');
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set()); // zzz401 — PART-XX sub-list collapsed by default
  const [collapsedBooks, setCollapsedBooks] = useState<Set<number>>(new Set(ALL_BOOKS)); // zzz402 — all Books collapsed by default
  const [view, setView] = useState<'intro' | 'book'>('intro'); // zzz407 — First Principles is the default landing page
  const mainRef = useRef<HTMLDivElement>(null);

  const totalLines = useMemo(() => BOOK.reduce((n, p) => n + partLines(p), 0), []);
  const totalSubs = useMemo(() => BOOK.reduce((n, p) => n + p.subs.length, 0), []);

  // Scroll content to top whenever the active section/sub changes.
  useEffect(() => { if (mainRef.current) mainRef.current.scrollTop = 0; }, [activePart, activeSub]);

  // Restore persisted reading position on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_PROGRESS);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.activePart === 'number' && s.activePart >= 0 && s.activePart < BOOK.length) setActivePart(s.activePart);
      if (Array.isArray(s.expandedParts)) setExpandedParts(new Set(s.expandedParts.filter((n: unknown) => typeof n === 'number') as number[]));
    } catch { /* ignore */ }
  }, []);

  // Persist reading position whenever it changes.
  useEffect(() => {
    try { localStorage.setItem(LS_PROGRESS, JSON.stringify({ activePart, expandedParts: Array.from(expandedParts) })); } catch { /* ignore */ }
  }, [activePart, expandedParts]);

  const searchHits = useMemo(() => {
    if (!q.trim()) return null;
    const needle = q.trim().toLowerCase();
    const hits: Array<{ partIdx: number; subIdx: number; snippet: string; title: string }> = [];
    for (let pi = 0; pi < BOOK.length; pi++) {
      const p = BOOK[pi];
      for (const para of p.paras || []) {
        if (para.toLowerCase().includes(needle)) {
          hits.push({ partIdx: pi, subIdx: -1, snippet: para.slice(0, 180), title: p.title });
          if (hits.length >= 250) return hits;
        }
      }
      for (let si = 0; si < p.subs.length; si++) {
        const s = p.subs[si];
        if (s.title.toLowerCase().includes(needle)) hits.push({ partIdx: pi, subIdx: si, snippet: s.title, title: p.title + ' · ' + s.title });
        for (const para of s.paras) {
          if (para.toLowerCase().includes(needle)) {
            hits.push({ partIdx: pi, subIdx: si, snippet: para.slice(0, 180), title: p.title + ' · ' + s.title });
            if (hits.length >= 250) return hits;
          }
        }
      }
    }
    return hits;
  }, [q]);

  const currentPart = BOOK[activePart];
  const displayedSubs = activeSub >= 0 ? [currentPart.subs[activeSub]] : currentPart.subs;
  const go = (pi: number, si: number = -1) => {
    setView('book');
    setActivePart(pi); setActiveSub(si);
    setExpandedParts(prev => { if (prev.has(pi)) return prev; const e = new Set(prev); e.add(pi); return e; });
    // reveal the containing Book so search / prev-next navigation isn't hidden
    setCollapsedBooks(prev => { const b = BOOK[pi].book; if (!prev.has(b)) return prev; const e = new Set(prev); e.delete(b); return e; });
  };
  const toggleExpand = (pi: number) => setExpandedParts(prev => { const e = new Set(prev); if (e.has(pi)) e.delete(pi); else e.add(pi); return e; });
  const toggleBook = (b: number) => setCollapsedBooks(prev => { const e = new Set(prev); if (e.has(b)) e.delete(b); else e.add(b); return e; });
  const anyBookOpen = ALL_BOOKS.some(b => !collapsedBooks.has(b));
  const collapseAll = () => setCollapsedBooks(new Set(ALL_BOOKS));
  const expandAll = () => setCollapsedBooks(new Set());

  let lastBook = -1;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', display: 'flex' }}>
      <style>{`
        .lp-row:not(.lp-active):hover { background: ${C.panel2}; }
        .lp-chev:hover span { color: ${C.cyan}; }
        .lp-title:hover > span:first-child { color: ${C.cyan}; }
        .lp-sub:hover { background: ${C.cyan}12; color: ${C.text}; }
        .lp-ctrl:hover { border-color: ${C.cyan}; color: ${C.cyan}; }
        .lp-book:hover { background: ${C.panel2}; }
      `}</style>
      <aside style={{ width: 360, minWidth: 360, background: C.panel, borderRight: '1px solid ' + C.border, height: '100vh', overflowY: 'auto', position: 'sticky', top: 0 }}>
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid ' + C.border }}>
          <div style={{ fontSize: 11, color: C.text3, letterSpacing: '0.5px', marginBottom: 4 }}>INVESTING PLAYBOOK</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>📚 Master Learning Tab</h1>
          <div style={{ fontSize: 11, color: C.text2, marginTop: 4 }}>{BOOK.length} sections · {totalSubs.toLocaleString()} sub-sections · {totalLines.toLocaleString()} lines</div>
        </div>
        <div style={{ padding: '12px 14px' }}>
          <input type="text" placeholder="🔍 Search entire book…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: C.panel2, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, fontSize: 13, outline: 'none' }} />
        </div>
        <div style={{ padding: '0 14px 10px', display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={anyBookOpen ? collapseAll : expandAll} className="lp-ctrl" style={{ background: C.panel2, border: '1px solid ' + C.border, borderRadius: 6, color: C.text2, fontSize: 11.5, fontWeight: 700, padding: '6px 10px', cursor: 'pointer' }}>
            {anyBookOpen ? '⊟ Collapse all' : '⊞ Expand all'}
          </button>
          <span style={{ fontSize: 10.5, color: C.text3 }}>{ALL_BOOKS.length - collapsedBooks.size} of {ALL_BOOKS.length} books open</span>
        </div>
        <nav style={{ paddingBottom: 40 }}>
          {/* zzz407 — pinned flagship lesson */}
          <button onClick={() => { setView('intro'); setQ(''); }} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', background: view === 'intro' ? C.gold + '15' : 'transparent', borderLeft: view === 'intro' ? '3px solid ' + C.gold : '3px solid transparent', borderTop: 'none', borderRight: 'none', borderBottom: '1px solid ' + C.border, color: view === 'intro' ? C.gold : C.text, fontSize: 12.5, fontWeight: 800, cursor: 'pointer', textAlign: 'left' }}>
            ⭐ First Principles <span style={{ fontSize: 9.5, color: C.text3, fontWeight: 600 }}>· start here</span>
          </button>
          {BOOK.map((p, pi) => {
            const active = pi === activePart;
            const expanded = expandedParts.has(pi);
            const showBookHdr = p.book !== lastBook;
            lastBook = p.book;
            return (
              <div key={pi}>
                {showBookHdr && (
                  <button onClick={() => toggleBook(p.book)} className="lp-book" style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px 8px', fontSize: 11, color: C.gold, fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', borderTop: pi > 0 ? '1px solid ' + C.border : 'none', marginTop: pi > 0 ? 6 : 0, background: 'transparent', border: 'none', cursor: 'pointer' }}>
                    <span style={{ display: 'inline-block', fontSize: 9, transition: 'transform .15s ease', transform: collapsedBooks.has(p.book) ? 'rotate(0deg)' : 'rotate(90deg)' }}>▶</span>
                    <span style={{ flex: 1, textAlign: 'left' }}>Book {p.book}</span>
                    <span style={{ fontSize: 9.5, color: C.text3, fontWeight: 600 }}>{BOOK.filter(x => x.book === p.book).length} parts</span>
                  </button>
                )}
                {!collapsedBooks.has(p.book) && (<>
                <div className={'lp-row' + (active ? ' lp-active' : '')} style={{ display: 'flex', alignItems: 'stretch', background: active ? C.cyan + '15' : 'transparent', borderLeft: active ? '3px solid ' + C.cyan : '3px solid transparent' }}>
                  {p.subs.length > 0 ? (
                    <button aria-label="toggle section" onClick={() => toggleExpand(pi)} className="lp-chev" style={{ flex: '0 0 30px', background: 'transparent', border: 'none', color: C.text3, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ display: 'inline-block', fontSize: 9, transition: 'transform .15s ease', transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
                    </button>
                  ) : (
                    <span style={{ flex: '0 0 30px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text3, fontSize: 9 }}>·</span>
                  )}
                  <button onClick={() => go(pi, -1)} className="lp-title" style={{ flex: 1, minWidth: 0, textAlign: 'left', padding: '9px 14px 9px 2px', background: 'transparent', border: 'none', color: active ? C.cyan : C.text, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.title}</span>
                    {p.subs.length > 0 && <span style={{ fontSize: 10, color: C.text3, fontWeight: 600, background: C.panel2, borderRadius: 10, padding: '1px 7px', flex: '0 0 auto' }} title={`${p.subs.length} sub-sections`}>{p.subs.length}</span>}
                  </button>
                </div>
                {expanded && p.subs.length > 0 && (
                  <div style={{ background: C.panel2, borderLeft: '3px solid ' + C.border }}>
                    <button onClick={() => go(pi, -1)} className="lp-sub" style={{ width: '100%', textAlign: 'left', padding: '6px 20px', background: activeSub === -1 && activePart === pi ? C.cyan + '11' : 'transparent', border: 'none', color: activeSub === -1 && activePart === pi ? C.cyan : C.text2, fontSize: 11.5, cursor: 'pointer', fontStyle: 'italic' }}>⇢ Read full section</button>
                    {p.subs.map((s, si) => (
                      <button key={si} onClick={() => go(pi, si)} className="lp-sub" style={{ width: '100%', textAlign: 'left', padding: '5px 20px', background: activeSub === si && activePart === pi ? C.cyan + '11' : 'transparent', border: 'none', color: activeSub === si && activePart === pi ? C.cyan : C.text2, fontSize: 11.5, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title.slice(0, 48)}</button>
                    ))}
                  </div>
                )}
                </>)}
              </div>
            );
          })}
        </nav>
      </aside>
      <main ref={mainRef} style={{ flex: 1, padding: '30px 40px 90px', overflow: 'auto', minWidth: 0 }}>
        {searchHits ? (
          <div style={{ maxWidth: 820, margin: '0 auto' }}>
            <div style={{ fontSize: 13, color: C.text2, marginBottom: 12 }}>{searchHits.length}{searchHits.length >= 250 ? '+' : ''} results for "{q}"</div>
            {searchHits.map((h, i) => (
              <div key={i} onClick={() => { go(h.partIdx, h.subIdx); setQ(''); }} style={{ padding: '12px 14px', background: C.panel, border: '1px solid ' + C.border, borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}>
                <div style={{ fontSize: 11, color: C.cyan, fontWeight: 700, marginBottom: 4 }}>{h.title}</div>
                <div style={{ fontSize: 13, color: C.text }} dangerouslySetInnerHTML={{ __html: highlight(h.snippet, q) + '…' }} />
              </div>
            ))}
          </div>
        ) : view === 'intro' ? (
          <article style={{ maxWidth: 880, margin: '0 auto' }}>
            <div style={{ fontSize: 11, color: C.gold, letterSpacing: '0.5px', marginBottom: 6, fontWeight: 800 }}>⭐ START HERE · THE OPERATING RULES</div>
            <h1 style={{ fontSize: 32, fontWeight: 800, marginTop: 0, marginBottom: 14, letterSpacing: '-0.5px', lineHeight: 1.12 }}>First Principles</h1>
            <div style={{ background: C.gold + '12', border: '1px solid ' + C.gold + '33', borderRadius: 10, padding: '14px 18px', marginBottom: 28, fontSize: 15, lineHeight: 1.65, color: C.text }}>{FP_INTRO}</div>
            {FIRST_PRINCIPLES.map((g, gi) => (
              <section key={gi} style={{ marginBottom: 34 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: C.cyan, marginBottom: 4 }}>{g.heading}</h2>
                <div style={{ fontSize: 13.5, color: C.text2, marginBottom: 16, lineHeight: 1.6 }}>{g.blurb}</div>
                {g.cards.map((c) => {
                  const meta = FP_TAG_META[c.tag];
                  return (
                    <div key={c.n} style={{ background: C.panel, border: '1px solid ' + C.border, borderLeft: '3px solid ' + meta.color, borderRadius: 10, padding: '16px 18px', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, fontWeight: 800, color: C.text3 }}>{c.n}.</span>
                        <span style={{ fontSize: 16.5, fontWeight: 800, color: C.text }}>{c.title}</span>
                        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.5px', color: meta.color, background: meta.color + '18', border: '1px solid ' + meta.color + '40', borderRadius: 5, padding: '2px 7px' }}>{meta.label}</span>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: meta.color, lineHeight: 1.5, marginBottom: 10 }}>▶ {c.rule}</div>
                      <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, marginBottom: 8 }}><span style={{ color: C.text3, fontWeight: 700 }}>Why it works. </span>{c.why}</div>
                      <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, marginBottom: c.pitfall ? 8 : 0, background: C.green + '0c', border: '1px solid ' + C.green + '22', borderRadius: 8, padding: '9px 12px' }}><span style={{ color: C.green, fontWeight: 700 }}>🎯 Example. </span>{c.example}</div>
                      {c.pitfall && <div style={{ fontSize: 14, color: C.text, lineHeight: 1.7, background: C.amber + '0c', border: '1px solid ' + C.amber + '22', borderRadius: 8, padding: '9px 12px' }}><span style={{ color: C.amber, fontWeight: 700 }}>⚠ Common mistake. </span>{c.pitfall}</div>}
                    </div>
                  );
                })}
              </section>
            ))}
            <div style={{ marginTop: 20, paddingTop: 20, borderTop: '1px solid ' + C.border }}>
              <button onClick={() => go(0, -1)} style={{ padding: '12px 18px', background: C.cyan + '15', border: '1px solid ' + C.cyan + '40', borderRadius: 8, color: C.cyan, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>Start the full playbook → {BOOK[0].title}</button>
            </div>
          </article>
        ) : (
          <article style={{ maxWidth: 820, margin: '0 auto' }}>
            <div style={{ fontSize: 11, color: C.text3, letterSpacing: '0.5px', marginBottom: 6 }}>
              BOOK {currentPart.book} · Section {activePart + 1} of {BOOK.length}
            </div>
            <h1 style={{ fontSize: 30, fontWeight: 800, marginTop: 0, marginBottom: 14, letterSpacing: '-0.5px', lineHeight: 1.15 }}>{currentPart.title}</h1>
            {(currentPart as any).summary && (
              <div style={{ background: C.cyan + '10', border: '1px solid ' + C.cyan + '33', borderRadius: 8, padding: '12px 16px', marginBottom: 24, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <span style={{ fontSize: 15 }}>📖</span>
                <div>
                  <div style={{ fontSize: 10.5, color: C.cyan, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 3 }}>PREVIEW</div>
                  <div style={{ fontSize: 14, color: C.text, lineHeight: 1.5 }}>{(currentPart as any).summary}</div>
                </div>
              </div>
            )}
            {activeSub === -1 && currentPart.subs.length > 0 && (
              <div style={{ background: C.panel, border: '1px solid ' + C.border, borderRadius: 8, padding: '12px 16px', marginBottom: 26 }}>
                <div style={{ fontSize: 10.5, color: C.text3, fontWeight: 800, letterSpacing: '0.5px', marginBottom: 8 }}>IN THIS SECTION ({currentPart.subs.length})</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {currentPart.subs.map((s, si) => (
                    <button key={si} onClick={() => go(activePart, si)} style={{ background: C.panel2, border: '1px solid ' + C.border, borderRadius: 5, color: C.text2, fontSize: 11.5, padding: '4px 9px', cursor: 'pointer', textAlign: 'left' }}>{s.title.slice(0, 46)}</button>
                  ))}
                </div>
              </div>
            )}
            {currentPart.paras && currentPart.paras.length > 0 && (
              <section style={{ marginBottom: 30 }}>
                {currentPart.paras.map((p, i) => renderPara(p, i))}
              </section>
            )}
            {displayedSubs.map((s, i) => (
              <section key={i} style={{ marginBottom: 30 }}>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: C.cyan, marginBottom: 14, paddingBottom: 8, borderBottom: '2px solid ' + C.cyan + '33' }}>{s.title}</h2>
                {s.paras.map((p, j) => renderPara(p, j))}
              </section>
            ))}
            {/* zzz407 — real-world examples for this section (full-section view only) */}
            {activeSub === -1 && (LEARN_EXAMPLES[activePart]?.length ?? 0) > 0 && (
              <section style={{ marginTop: 34, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 10, borderBottom: '2px solid ' + C.gold + '33' }}>
                  <span style={{ fontSize: 20 }}>🎯</span>
                  <h2 style={{ fontSize: 20, fontWeight: 800, color: C.gold, margin: 0 }}>Real-World Examples</h2>
                  <span style={{ fontSize: 10.5, color: C.text3, fontWeight: 600, background: C.panel2, borderRadius: 10, padding: '2px 8px' }}>{LEARN_EXAMPLES[activePart].length}</span>
                </div>
                {LEARN_EXAMPLES[activePart].map((ex, ei) => {
                  const meta = EX_TAG_META[ex.tag] || EX_TAG_META.scenario;
                  const route = pickToolRoute(ex);
                  return (
                    <div key={ei} style={{ background: C.panel, border: '1px solid ' + C.border, borderLeft: '3px solid ' + meta.color, borderRadius: 10, padding: '16px 18px', marginBottom: 14 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: '0.5px', color: meta.color, background: meta.color + '18', border: '1px solid ' + meta.color + '40', borderRadius: 5, padding: '2px 7px' }}>{meta.icon} {meta.label}</span>
                        {ex.company && <span style={{ fontSize: 10.5, fontWeight: 700, color: C.text2, background: C.panel2, border: '1px solid ' + C.border, borderRadius: 5, padding: '2px 8px' }}>{ex.company}</span>}
                      </div>
                      <div style={{ fontSize: 16.5, fontWeight: 800, color: C.text, lineHeight: 1.4, marginBottom: 10 }}>{ex.title}</div>
                      {ex.body.map((para, pj) => (
                        <p key={pj} style={{ fontSize: 14.5, lineHeight: 1.75, color: C.text, margin: '0 0 9px' }}>{para}</p>
                      ))}
                      {ex.numbers && ex.numbers.length > 0 && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                          {ex.numbers.map((n, ni) => (
                            <div key={ni} style={{ background: meta.color + '0d', border: '1px solid ' + meta.color + '2a', borderRadius: 8, padding: '7px 12px', minWidth: 90 }}>
                              <div style={{ fontSize: 9.5, color: C.text3, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase', marginBottom: 2 }}>{n.label}</div>
                              <div style={{ fontSize: 15, color: meta.color, fontWeight: 800, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{n.value}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <a href={route.href} style={{ display: 'inline-block', marginTop: 13, fontSize: 12.5, fontWeight: 700, color: meta.color, textDecoration: 'none', background: meta.color + '14', border: '1px solid ' + meta.color + '44', borderRadius: 6, padding: '6px 12px' }}>▶ Try it live · {route.label}</a>
                    </div>
                  );
                })}
              </section>
            )}
            {/* Prev / Next navigation */}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 40, paddingTop: 20, borderTop: '1px solid ' + C.border }}>
              <button disabled={activePart === 0} onClick={() => go(activePart - 1, -1)} style={{ flex: 1, textAlign: 'left', padding: '12px 16px', background: activePart === 0 ? 'transparent' : C.panel, border: '1px solid ' + C.border, borderRadius: 8, color: activePart === 0 ? C.text3 : C.text, cursor: activePart === 0 ? 'default' : 'pointer', opacity: activePart === 0 ? 0.4 : 1 }}>
                <div style={{ fontSize: 10.5, color: C.text3 }}>← Previous</div>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activePart > 0 ? BOOK[activePart - 1].title : ''}</div>
              </button>
              <button disabled={activePart === BOOK.length - 1} onClick={() => go(activePart + 1, -1)} style={{ flex: 1, textAlign: 'right', padding: '12px 16px', background: activePart === BOOK.length - 1 ? 'transparent' : C.panel, border: '1px solid ' + C.border, borderRadius: 8, color: activePart === BOOK.length - 1 ? C.text3 : C.text, cursor: activePart === BOOK.length - 1 ? 'default' : 'pointer', opacity: activePart === BOOK.length - 1 ? 0.4 : 1 }}>
                <div style={{ fontSize: 10.5, color: C.text3 }}>Next →</div>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activePart < BOOK.length - 1 ? BOOK[activePart + 1].title : ''}</div>
              </button>
            </div>
          </article>
        )}
      </main>
    </div>
  );
}

function renderPara(p: string, key: React.Key): React.ReactNode {
  const trimmed = p.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*') || /^\d+\.\s/.test(trimmed)) {
    return <div key={key} style={{ padding: '5px 0 5px 20px', fontSize: 15.5, lineHeight: 1.75, color: C.text }}>{trimmed}</div>;
  }
  if (trimmed.length < 80 && trimmed.endsWith(':') && trimmed[0] === trimmed[0].toUpperCase()) {
    return <div key={key} style={{ padding: '12px 0 4px', fontSize: 15.5, fontWeight: 700, color: C.gold }}>{trimmed}</div>;
  }
  // Arrow-chain / formula lines get a subtle mono treatment for readability.
  if (/[→↓↑]/.test(trimmed) && trimmed.length < 120) {
    return <div key={key} style={{ padding: '6px 0', fontSize: 14.5, lineHeight: 1.7, color: C.purple, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{trimmed}</div>;
  }
  return <p key={key} style={{ fontSize: 15.5, lineHeight: 1.8, color: C.text, margin: '11px 0' }}>{trimmed}</p>;
}

function highlight(text: string, q: string): string {
  if (!q.trim()) return escapeHtml(text);
  const parts = text.split(new RegExp('(' + escapeRegExp(q) + ')', 'gi'));
  return parts.map(p => p.toLowerCase() === q.toLowerCase() ? '<mark style="background:#FBBF24;color:#0B0E14;padding:1px 3px;border-radius:2px">' + escapeHtml(p) + '</mark>' : escapeHtml(p)).join('');
}
function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
