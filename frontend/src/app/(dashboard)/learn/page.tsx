'use client';

// zzz-learn-full — Investing Playbook (learning) tab.
// Content moved to ./book-data.ts (bundled at build time — no /data fetch, no 404).
// Now carries EVERY line from Investing Book 1 + Book 2 (exact-duplicate lines
// removed): 110 sections, 2070 subsections, ~20,250 content lines.
// Left sidebar TOC (grouped by book, collapsible) + subsection nav + content
// viewer + full-text search across the entire corpus.

import React, { useMemo, useState } from 'react';
import { BOOK, type Part } from './book-data';

const C = {
  bg: '#0B0E14', panel: '#11151F', panel2: '#161B27', border: '#1F2937',
  text: '#E5E7EB', text2: '#94A3B8', text3: '#64748B',
  cyan: '#06B6D4', gold: '#FBBF24', purple: '#A78BFA', green: '#22C55E', amber: '#F59E0B',
};

function partLines(p: Part): number {
  return (p.paras?.length || 0) + p.subs.reduce((n, s) => n + s.paras.length + 1, 0);
}

export default function InvestingPlaybookPage() {
  const [activePart, setActivePart] = useState<number>(0);
  const [activeSub, setActiveSub] = useState<number>(-1);
  const [q, setQ] = useState<string>('');
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set([0]));

  const totalLines = useMemo(() => BOOK.reduce((n, p) => n + partLines(p), 0), []);
  const totalSubs = useMemo(() => BOOK.reduce((n, p) => n + p.subs.length, 0), []);

  const searchHits = useMemo(() => {
    if (!q.trim()) return null;
    const needle = q.trim().toLowerCase();
    const hits: Array<{ partIdx: number; subIdx: number; snippet: string; title: string }> = [];
    for (let pi = 0; pi < BOOK.length; pi++) {
      const p = BOOK[pi];
      for (const para of p.paras || []) {
        if (para.toLowerCase().includes(needle)) {
          hits.push({ partIdx: pi, subIdx: -1, snippet: para.slice(0, 180), title: p.title });
          if (hits.length >= 200) return hits;
        }
      }
      for (let si = 0; si < p.subs.length; si++) {
        const s = p.subs[si];
        if (s.title.toLowerCase().includes(needle)) {
          hits.push({ partIdx: pi, subIdx: si, snippet: s.title.slice(0, 180), title: p.title + ' · ' + s.title });
          if (hits.length >= 200) return hits;
        }
        for (const para of s.paras) {
          if (para.toLowerCase().includes(needle)) {
            hits.push({ partIdx: pi, subIdx: si, snippet: para.slice(0, 180), title: p.title + ' · ' + s.title });
            if (hits.length >= 200) return hits;
          }
        }
      }
    }
    return hits;
  }, [q]);

  const currentPart = BOOK[activePart];
  const displayedSubs = activeSub >= 0 ? [currentPart.subs[activeSub]] : currentPart.subs;

  // Group parts by book for the sidebar (Book 1 / Book 2 headers).
  let lastBook = -1;

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.text, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', display: 'flex' }}>
      <aside style={{ width: 360, minWidth: 360, background: C.panel, borderRight: '1px solid ' + C.border, height: '100vh', overflowY: 'auto', position: 'sticky', top: 0 }}>
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid ' + C.border }}>
          <div style={{ fontSize: 11, color: C.text3, letterSpacing: '0.5px', marginBottom: 4 }}>INVESTING PLAYBOOK</div>
          <h1 style={{ fontSize: 18, fontWeight: 800, margin: 0, letterSpacing: '-0.3px' }}>📚 Master Learning Tab</h1>
          <div style={{ fontSize: 11, color: C.text2, marginTop: 4 }}>{BOOK.length} sections · {totalSubs.toLocaleString()} sub-sections · {totalLines.toLocaleString()} lines</div>
        </div>
        <div style={{ padding: '12px 14px' }}>
          <input type="text" placeholder="🔍 Search entire book…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', padding: '8px 12px', background: C.panel2, border: '1px solid ' + C.border, borderRadius: 6, color: C.text, fontSize: 13, outline: 'none' }} />
        </div>
        <nav style={{ paddingBottom: 40 }}>
          {BOOK.map((p, pi) => {
            const active = pi === activePart;
            const expanded = expandedParts.has(pi);
            const showBookHdr = p.book !== lastBook;
            lastBook = p.book;
            return (
              <div key={pi}>
                {showBookHdr && (
                  <div style={{ padding: '12px 16px 6px', fontSize: 10.5, color: C.gold, fontWeight: 800, letterSpacing: '0.8px', textTransform: 'uppercase', borderTop: pi > 0 ? '1px solid ' + C.border : 'none', marginTop: pi > 0 ? 6 : 0 }}>
                    ▸ Book {p.book}
                  </div>
                )}
                <button
                  onClick={() => { setActivePart(pi); setActiveSub(-1); const e = new Set(expandedParts); if (e.has(pi)) e.delete(pi); else e.add(pi); setExpandedParts(e); }}
                  style={{ width: '100%', textAlign: 'left', padding: '9px 16px', background: active ? C.cyan + '15' : 'transparent', border: 'none', borderLeft: active ? '3px solid ' + C.cyan : '3px solid transparent', color: active ? C.cyan : C.text, fontSize: 12.5, fontWeight: 700, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{p.subs.length > 0 ? (expanded ? '▼' : '▶') : '·'} {p.title}</span>
                  <span style={{ fontSize: 10, color: C.text3, fontWeight: 500 }}>{partLines(p)}</span>
                </button>
                {expanded && p.subs.length > 0 && (
                  <div style={{ background: C.panel2, borderLeft: '3px solid ' + C.border }}>
                    <button onClick={() => { setActivePart(pi); setActiveSub(-1); }} style={{ width: '100%', textAlign: 'left', padding: '6px 20px', background: activeSub === -1 && activePart === pi ? C.cyan + '11' : 'transparent', border: 'none', color: activeSub === -1 && activePart === pi ? C.cyan : C.text2, fontSize: 11.5, cursor: 'pointer', fontStyle: 'italic' }}>⇢ All sub-sections</button>
                    {p.subs.map((s, si) => (
                      <button key={si} onClick={() => { setActivePart(pi); setActiveSub(si); }} style={{ width: '100%', textAlign: 'left', padding: '5px 20px', background: activeSub === si && activePart === pi ? C.cyan + '11' : 'transparent', border: 'none', color: activeSub === si && activePart === pi ? C.cyan : C.text2, fontSize: 11.5, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title.slice(0, 48)}</button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>
      <main style={{ flex: 1, padding: '30px 40px 80px', overflow: 'auto', minWidth: 0 }}>
        {searchHits ? (
          <div>
            <div style={{ fontSize: 13, color: C.text2, marginBottom: 12 }}>{searchHits.length}{searchHits.length >= 200 ? '+' : ''} results for "{q}"</div>
            {searchHits.map((h, i) => (
              <div key={i} onClick={() => { setActivePart(h.partIdx); setActiveSub(h.subIdx); setQ(''); }} style={{ padding: '12px 14px', background: C.panel, border: '1px solid ' + C.border, borderRadius: 8, marginBottom: 8, cursor: 'pointer' }}>
                <div style={{ fontSize: 11, color: C.cyan, fontWeight: 700, marginBottom: 4 }}>{h.title}</div>
                <div style={{ fontSize: 13, color: C.text }} dangerouslySetInnerHTML={{ __html: highlight(h.snippet, q) + '…' }} />
              </div>
            ))}
          </div>
        ) : (
          <article>
            <div style={{ fontSize: 11, color: C.text3, letterSpacing: '0.5px', marginBottom: 6 }}>BOOK {currentPart.book}</div>
            <h1 style={{ fontSize: 30, fontWeight: 800, marginTop: 0, marginBottom: 24, letterSpacing: '-0.5px' }}>{currentPart.title}</h1>
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
            {activeSub >= 0 && (
              <button onClick={() => setActiveSub(-1)} style={{ marginTop: 10, padding: '8px 14px', background: C.panel2, border: '1px solid ' + C.border, borderRadius: 6, color: C.cyan, fontSize: 12, cursor: 'pointer' }}>⇢ Show all sub-sections of this part</button>
            )}
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
    return <div key={key} style={{ padding: '6px 0 6px 20px', fontSize: 15, lineHeight: 1.7, color: C.text }}>{trimmed}</div>;
  }
  if (trimmed.length < 80 && trimmed.endsWith(':') && trimmed[0] === trimmed[0].toUpperCase()) {
    return <div key={key} style={{ padding: '10px 0 4px', fontSize: 15, fontWeight: 700, color: C.gold }}>{trimmed}</div>;
  }
  return <p key={key} style={{ fontSize: 15, lineHeight: 1.75, color: C.text, margin: '10px 0' }}>{trimmed}</p>;
}

function highlight(text: string, q: string): string {
  if (!q.trim()) return escapeHtml(text);
  const parts = text.split(new RegExp('(' + escapeRegExp(q) + ')', 'gi'));
  return parts.map(p => p.toLowerCase() === q.toLowerCase() ? '<mark style="background:#FBBF24;color:#0B0E14;padding:1px 3px;border-radius:2px">' + escapeHtml(p) + '</mark>' : escapeHtml(p)).join('');
}
function escapeHtml(s: string): string { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
