'use client';

// zzz823 — "Book check": one collapsed line on India and US Portfolio
// Catalysts that lets the owner verify WHY each name is on the page. Every
// source is counted (used or not), every book name says which saved list it
// came from, every bench name says which list and which criteria, and two
// lists that must be empty are printed: saved holdings not shown, and names
// shown as holdings that are not saved. Renders lib/thesis/book-membership's
// BookCheck; computes nothing itself.

import { useState } from 'react';
import type { BookCheck } from '@/lib/thesis/book-membership';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)', green: 'var(--mc-verdict-up, #34D399)',
};

function NameList({ title, items, empty, warn }: { title: string; items: Array<{ symbol: string; text: string }>; empty: string; warn?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 6 }}>
      <button onClick={() => setOpen((v) => !v)} disabled={!items.length}
        style={{ all: 'unset', cursor: items.length ? 'pointer' : 'default', fontWeight: 800, color: warn && items.length ? C.amber : C.text }}>
        {items.length ? (open ? '▾ ' : '▸ ') : '· '}{title} ({items.length})
      </button>
      {!items.length && <span style={{ color: C.faint }}> — {empty}</span>}
      {open && items.length > 0 && (
        <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: 3, paddingLeft: 12 }}>
          {items.map((x) => (
            <div key={`${title}-${x.symbol}`} style={{ padding: '1px 0' }}>
              <b style={{ color: C.text }}>{x.symbol}</b> <span style={{ color: C.dim }}>— {x.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function BookCheckPanel({ check, market }: { check: BookCheck | null; market: 'IN' | 'US' }) {
  if (!check) return null;
  const bad = check.notSaved.length > 0;
  return (
    <details data-testid={market === 'US' ? 'us-book-check' : 'book-check'} style={{ fontSize: 13, color: C.dim, border: `1px dashed ${bad ? C.amber : C.border}`, borderRadius: 8, padding: '6px 12px', background: C.bg, lineHeight: 1.5 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 800, color: bad ? C.amber : C.text }}>
        🔎 Book check — {check.line}
      </summary>
      <div style={{ marginTop: 6, color: C.faint }}>{check.rule}</div>
      <div style={{ marginTop: 6 }}>
        <b style={{ color: C.text }}>Sources</b>
        {check.sources.map((s) => (
          <div key={s.label} style={{ paddingLeft: 12 }}>
            <span style={{ color: s.used ? C.green : C.faint, fontWeight: 800 }}>{s.used ? '✓ used' : '✗ not used'}</span>{' '}
            {s.label}: <b style={{ color: C.text }}>{s.count == null ? '—' : s.count}</b> <span style={{ color: C.faint }}>· {s.note}</span>
          </div>
        ))}
      </div>
      <NameList title="In My book, and why" items={check.book.map((x) => ({ symbol: x.symbol, text: x.why }))} empty="no saved holdings" />
      <NameList title="Saved holdings NOT shown in My book (reason)" items={check.notShown.map((x) => ({ symbol: x.symbol, text: x.reason }))} empty="none — every saved holding is shown" warn />
      <NameList title="Shown as a holding but NOT in your saved holdings (should be zero)" items={check.notSaved.map((x) => ({ symbol: x.symbol, text: x.reason }))} empty="none ✓" warn />
      <NameList title="On the bench, and why (you do not hold these)" items={check.bench.map((x) => ({ symbol: x.symbol, text: x.why }))} empty="no bench names" />
      {(check.bseUnmatched || []).length > 0 && <NameList title="Saved as a BSE code — no NSE symbol found (reason)" items={check.bseUnmatched.map((x) => ({ symbol: x.symbol, text: x.reason }))} empty="" warn />}
      {check.ignored.length > 0 && <NameList title="Ignored — on an old list only, not a saved holding" items={check.ignored.map((x) => ({ symbol: x.symbol, text: x.reason }))} empty="" />}
    </details>
  );
}
