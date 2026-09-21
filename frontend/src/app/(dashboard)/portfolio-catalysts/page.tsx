// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO CATALYSTS — WHAT CHANGED IN THE NAMES YOU OWN.  (zzz708 → zzz715)
//
// The first version showed a grade, a pattern chip, and one static sentence
// about what would end the thesis. The owner's criticism was exact: that
// sentence was IDENTICAL on every A-pattern holding, and displaying an exit
// condition is not the same as proving whether it has been reached.
//
// So the page no longer displays a condition. It EVALUATES one, per holding,
// against the evidence in the latest filing, and says which conditions have
// fired, which are being watched, and which could not be checked at all.
//
// The architecture underneath is the owner's own:
//
//   NEWS/FILING → EVENT → STRUCTURAL VARIABLE → EARNINGS MECHANISM
//               → THESIS → EXPECTATION → STATUS → ACTION
//
// and it lives in lib/thesis/: variables.ts extracts, ledger.ts defines what
// each thesis rests on, status.ts judges, capex-chain.ts asks whether the
// money earned, guidance-ledger.ts records what management promised so a
// LATER quarter can check it.
//
// THE ONE RULE THIS PAGE ENFORCES ABOVE ALL OTHERS: a price move is never an
// exit reason. No price, drawdown, day-one reaction or move-since-print is
// read anywhere in the thesis engine. The owner's own forensic review priced
// his price-triggered selling at roughly Rs 1.9 Cr of foregone gains, and a
// holding down 40% with every operating variable improving reads as THESIS
// STRENGTHENING here. That is not a bug.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useMemo, useState } from 'react';
import { useBook } from '@/lib/thesis/use-book';
import { ThesisCard } from '@/components/thesis-card';
import { STATUS_META, type ThesisStatus } from '@/lib/thesis/status';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--mc-text-1)',
  dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)', amber: '#F59E0B', cyan: 'var(--mc-cyan)',
};

// EVIDENCE_INCOMPLETE ranks ABOVE strengthening and neutral: an unchecked
// holding is a piece of work outstanding, and burying it under the ones that
// have been cleared is how it stays unchecked. (zzz717)
const ORDER: ThesisStatus[] = [
  'BROKEN', 'WEAKENING', 'NEGATIVE_EXPECTATION_GAP', 'POSITIVE_EXPECTATION_GAP',
  'CONFIRMATION_REQUIRED', 'EVIDENCE_INCOMPLETE', 'STRENGTHENING', 'NEUTRAL',
];

export default function PortfolioCatalystsPage() {
  const { symbols, rows, loading, batch, readFiling, readAll, stop } = useBook();
  const [filter, setFilter] = useState<ThesisStatus | null>(null);
  const [onlyRead, setOnlyRead] = useState(false);

  const all = useMemo(() => Object.values(rows), [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) {
      const k = r.assessment?.status || 'NEUTRAL';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [all]);

  const list = useMemo(() => {
    let f = all;
    if (filter) f = f.filter((r) => r.assessment?.status === filter);
    if (onlyRead) f = f.filter((r) => r.state === 'done');
    // Sorted by SEVERITY, never by price and never alphabetically: the thing
    // that needs looking at should not be forty rows down because its ticker
    // starts with W.
    return [...f].sort((a, b) => {
      const ai = ORDER.indexOf(a.assessment?.status || 'NEUTRAL');
      const bi = ORDER.indexOf(b.assessment?.status || 'NEUTRAL');
      if (ai !== bi) return ai - bi;
      const ad = a.assessment?.triggered.length || 0;
      const bd = b.assessment?.triggered.length || 0;
      if (ad !== bd) return bd - ad;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [all, filter, onlyRead]);

  const readCount = all.filter((r) => r.state === 'done').length;

  if (!symbols.length && !loading) {
    return (
      <div style={{ padding: 24, color: C.dim, fontSize: 13, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 }}>Portfolio Catalysts</h1>
        Your book is empty, so there is nothing to watch. Add holdings on the Portfolio page and each one will appear
        here with its thesis, the variables that thesis rests on, and the conditions that would end it.
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>Portfolio Catalysts</h1>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 820 }}>
          Every holding carries a <b style={{ color: C.text }}>thesis ledger</b> — the named variables you own it for —
          and each quarter&apos;s evidence is checked against them. Capex is tracked as a chain to whether it actually
          earned, not as an announcement. <b style={{ color: C.text }}>A price move is never an exit reason</b>, and no
          price is read anywhere in this engine.
        </div>
      </div>

      {/* ── THE FIVE SIGNALS. Not fifty scores. ─────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ORDER.map((s) => {
          const m = STATUS_META[s];
          const on = filter === s;
          return (
            <button key={s} onClick={() => setFilter(on ? null : s)} title={m.meaning}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 7, padding: '6px 12px', borderRadius: 8,
                cursor: 'pointer', border: `1px solid ${on ? m.color : C.border}`,
                background: on ? `${m.color}18` : C.bg,
              }}>
              <span style={{ fontSize: 17, fontWeight: 900, color: m.color }}>{counts[s] || 0}</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: on ? m.color : C.dim }}>{m.dot} {m.label}</span>
            </button>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.faint }}>
          {list.length} of {symbols.length} holdings · {readCount} documents read
        </span>
        <button onClick={() => setOnlyRead((v) => !v)} style={{
          fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
          border: `1px solid ${onlyRead ? C.cyan : C.border}`, color: onlyRead ? C.cyan : C.dim,
          background: onlyRead ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : C.bg,
        }}>{onlyRead ? 'Only holdings with evidence read' : 'Show all holdings'}</button>

        {!batch.running ? (
          <button onClick={() => readAll(list.map((r) => r.symbol))}
            title="Reads the latest evidence document behind each holding — results filing, exchange announcement or concall material — three at a time. Already-read holdings are skipped."
            style={{
              fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
            }}>&#10024; Read evidence for all {list.length}</button>
        ) : (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.cyan }}>Reading {batch.done} of {batch.total}…</span>
            <button onClick={stop} style={{
              fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
            }}>Stop</button>
          </>
        )}
        <a href="/exit-radar" style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
          border: `1px solid ${C.border}`, color: C.dim, textDecoration: 'none',
        }}>Exit Radar →</a>
      </div>

      {batch.running && (
        <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: C.cyan, borderRadius: 2, transition: 'width .3s ease',
            width: `${batch.total ? Math.round((batch.done / batch.total) * 100) : 0}%` }} />
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: C.dim }}>Reading your book…</div>}

      {/* ── THE COVERAGE BANNER. It is the primary action on this page
          whenever the book is under-read, because a thesis engine judging a
          book it has not read is the failure this page was rebuilt to fix.
          (zzz717) */}
      {!loading && readCount < all.length && (
        <div style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.6, background: C.bg,
          border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 13px' }}>
          <b style={{ color: C.text }}>
            {all.length - readCount} of {all.length} holdings have not had an evidence document read.
          </b>{' '}
          Revenue, earnings, margin and cash come from the graders and are already on the cards.{' '}
          <b style={{ color: C.text }}>Utilisation, capacity, capex, order book and guidance do not</b> — they live in
          the filings, and for most theses here they are the <i>core</i> variables. Until they are read, those holdings
          sit at <b style={{ color: C.text }}>EVIDENCE INCOMPLETE</b>: no positive verdict is claimed on evidence that
          has not been looked at. A deterioration already visible in the figures would still be flagged.
          {!batch.running && (
            <div style={{ marginTop: 7 }}>
              <button onClick={() => readAll(list.map((r) => r.symbol))} style={{
                fontSize: 11.5, fontWeight: 800, padding: '5px 13px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
              }}>&#10024; Read the {all.length - readCount} remaining</button>
              <span style={{ fontSize: 10.5, color: C.faint, marginLeft: 9 }}>
                Three at a time. Each is one model call against one filing, and you can stop it at any point.
              </span>
            </div>
          )}
        </div>
      )}

      {list.map((r) => (
        <ThesisCard key={r.symbol}
          symbol={r.symbol} market={r.market} tier={r.tier} pattern={r.pattern}
          radarScore={r.radarScore} assessment={r.assessment} capex={r.capex}
          needsRead={r.state === 'idle' || r.state === 'error'}
          reading={r.state === 'loading'}
          onRead={() => readFiling(r.symbol)}
          error={r.error}
          promiseNote={r.state === 'done' ? r.promiseNote : null}
          dataSource={r.dataSource}
          sources={r.sourceUrl ? [{ label: 'Source filing', url: r.sourceUrl }] : []}
        />
      ))}
    </div>
  );
}
