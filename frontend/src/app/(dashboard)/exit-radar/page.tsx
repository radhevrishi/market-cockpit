// ═══════════════════════════════════════════════════════════════════════════
// EXIT RADAR — THE ONLY SCREEN WHERE PRICE IS BANNED OUTRIGHT.      (zzz715)
//
// The owner's specification asked for this as a separate screen rather than
// more information on Portfolio Catalysts, and he was right to: the two
// answer different questions and one of them is urgent.
//
//   Portfolio Catalysts  — what changed across the whole book
//   Exit Radar           — which theses have deteriorated, and on what evidence
//
// THE RULE, in his words: "No price-based reason is allowed inside this
// screen." It is enforced structurally rather than by discipline — the thesis
// engine that feeds this page reads no price field at all, so there is no
// price here to display even if someone wanted to. A holding down 40% with
// every operating variable improving does not appear on this radar.
//
// AND IT NEVER SAYS SELL. The strongest thing on this page is EXIT REVIEW,
// which means: a core assumption behind owning this looks invalidated, here
// is the evidence, go and look. The decision stays where it belongs.
//
// WHY A THESIS BREAK NEEDS TWO THINGS. One core variable down is a WEAKENING,
// not a break — a single weak quarter is precisely what the owner's ledger
// shows him selling into and regretting. A break needs two core variables
// down together, or one plus management reducing its own forward guidance:
// the point at which the company itself agrees the mechanism has stopped.
//
// EVERY ROW NAMES ITS REASON, and the reason can only be one of six:
// thesis invalidation, a stated break condition, execution failure, guidance
// failure, customer loss or structural deterioration (exitReasonOf). There is
// no price category because there is no price input. (zzz770)
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useMemo } from 'react';
import { useBook } from '@/lib/thesis/use-book';
import { ThesisCard } from '@/components/thesis-card';
import { STATUS_META, exitReasonOf, type ThesisStatus } from '@/lib/thesis/status';
import { CAPEX_META } from '@/lib/thesis/capex-chain';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--mc-text-1)',
  dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)', amber: '#F59E0B', cyan: 'var(--mc-cyan)',
  red: 'var(--mc-bearish)',
};

// EVIDENCE_INCOMPLETE ranks ABOVE strengthening and neutral: an unchecked
// holding is a piece of work outstanding, and burying it under the ones that
// have been cleared is how it stays unchecked. (zzz717)
const ORDER: ThesisStatus[] = [
  'BROKEN', 'WEAKENING', 'NEGATIVE_EXPECTATION_GAP', 'POSITIVE_EXPECTATION_GAP',
  'CONFIRMATION_REQUIRED', 'EVIDENCE_INCOMPLETE', 'STRENGTHENING', 'NEUTRAL',
];
// What belongs on the radar. EVIDENCE_INCOMPLETE is deliberately NOT here:
// the radar answers "what has deteriorated", and an unchecked holding has not
// been shown to do anything. It is counted in the header and called out in the
// coverage banner instead, so it cannot be mistaken for an all-clear. (zzz717)
const ACTIONABLE: ThesisStatus[] = ['BROKEN', 'WEAKENING', 'NEGATIVE_EXPECTATION_GAP'];

export default function ExitRadarPage() {
  // BOOK ONLY. The conviction bench joined Portfolio Catalysts in zzz731,
  // but an exit radar over names that are not owned would be answering a
  // question nobody asked — you cannot exit a candidate.
  const { symbols, rows, loading, batch, readFiling, readAll, stop } = useBook({ includeBench: false });
  const all = useMemo(() => Object.values(rows), [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of all) {
      const k = r.assessment?.status || 'NEUTRAL';
      c[k] = (c[k] || 0) + 1;
    }
    return c;
  }, [all]);

  const flagged = useMemo(() => all
    .filter((r) => ACTIONABLE.includes(r.assessment?.status as ThesisStatus) && !!r.assessment && exitReasonOf(r.assessment) != null)
    .sort((a, b) => {
      const ai = ORDER.indexOf(a.assessment!.status), bi = ORDER.indexOf(b.assessment!.status);
      if (ai !== bi) return ai - bi;
      return (b.assessment!.triggered.length) - (a.assessment!.triggered.length);
    }), [all]);

  // Capex that was spent and has not produced anything. It is not a thesis
  // break on its own — but it is the single most expensive thing to leave
  // unwatched, so it gets its own list whatever the thesis status says.
  const capexWatch = useMemo(() => all.filter((r) =>
    r.capex && (r.capex.state === 'disappointment' || r.capex.state === 'commissioned_not_earning')), [all]);

  const readCount = all.filter((r) => r.state === 'done').length;
  const unread = all.filter((r) => r.state !== 'done').length;
  const incomplete = all.filter((r) => r.assessment?.status === 'EVIDENCE_INCOMPLETE').length;

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>Exit Radar</h1>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 820 }}>
          Which theses have deteriorated, and on what evidence. <b style={{ color: C.text }}>No price reason is
          allowed on this screen</b> — the engine behind it reads no price field at all, so a drawdown cannot put a
          holding here and a rally cannot take one off. The strongest verdict is <b style={{ color: C.text }}>EXIT
          REVIEW</b>: go and look, with the evidence already assembled. It never says sell.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {ORDER.map((s) => {
          const m = STATUS_META[s];
          return (
            <div key={s} title={m.meaning} style={{
              display: 'flex', alignItems: 'baseline', gap: 7, padding: '6px 12px', borderRadius: 8,
              border: `1px solid ${ACTIONABLE.includes(s) ? m.color : C.border}`,
              background: ACTIONABLE.includes(s) ? `${m.color}12` : C.bg,
            }}>
              <span style={{ fontSize: 19, fontWeight: 900, color: m.color }}>{counts[s] || 0}</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: C.dim }}>{m.dot} {m.label}</span>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.faint }}>
          {symbols.length} holdings · {readCount} documents read
        </span>
        {!batch.running ? (
          <button onClick={() => readAll(all.map((r) => r.symbol))} style={{
            fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
          }}>&#10024; Read every unread document</button>
        ) : (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: C.cyan }}>Reading {batch.done} of {batch.total}…</span>
            <button onClick={stop} style={{
              fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
            }}>Stop</button>
          </>
        )}
        <a href="/portfolio-catalysts" style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
          border: `1px solid ${C.border}`, color: C.dim, textDecoration: 'none',
        }}>← Portfolio Catalysts</a>
      </div>

      {batch.running && (
        <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: C.cyan, borderRadius: 2, transition: 'width .3s ease',
            width: `${batch.total ? Math.round((batch.done / batch.total) * 100) : 0}%` }} />
        </div>
      )}

      {loading && <div style={{ fontSize: 12, color: C.dim }}>Reading your book…</div>}

      {/* HONEST ABOUT COVERAGE. An empty radar means one of two very different
          things, and conflating them would be the worst failure this page
          could have: either nothing has deteriorated, or nothing has been
          read. It says which. */}
      {!loading && unread > 0 && (
        <div style={{ fontSize: 11.5, color: C.amber, lineHeight: 1.6, background: C.bg,
          border: `1px solid ${C.border}`, borderRadius: 8, padding: '9px 12px' }}>
          <b>{unread} of {symbols.length} holdings have not had an evidence document read{incomplete
            ? `, and ${incomplete} sit at EVIDENCE INCOMPLETE — a core variable of their thesis is unchecked`
            : ''}.</b> Their theses are judged on the
          grader&apos;s numbers alone — utilisation, capex, order book and guidance all live in the filings. An empty
          radar with unread holdings means <b>not yet checked</b>, not <b>nothing wrong</b>.
        </div>
      )}

      {!loading && flagged.length === 0 && unread === 0 && (
        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
          Every filing has been read and no thesis has deteriorated. That is a real all-clear, not an empty page.
        </div>
      )}

      {/* ── THE TABLE. Ticker, thesis, trigger, evidence, severity. ─────── */}
      {flagged.length > 0 && (
        <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '92px 168px 1fr 108px',
            gap: 10, padding: '7px 12px', borderBottom: `1px solid ${C.border}`,
            fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, color: C.faint }}>
            <span>STOCK</span><span>THESIS</span><span>REASON · TRIGGER &amp; EVIDENCE</span><span>SEVERITY</span>
          </div>
          {flagged.map((r) => {
            const a = r.assessment!;
            const m = STATUS_META[a.status];
            const top = a.triggered[0];
            return (
              <div key={r.symbol} style={{ display: 'grid', gridTemplateColumns: '92px 168px 1fr 108px',
                gap: 10, padding: '8px 12px', borderBottom: `1px solid ${C.border}`, alignItems: 'baseline' }}>
                <span style={{ fontSize: 12, fontWeight: 900, color: C.text }}>{r.symbol}</span>
                <span style={{ fontSize: 10.5, color: C.dim }}>{a.thesis.name}</span>
                <span style={{ fontSize: 10.5, color: C.dim, lineHeight: 1.5 }}>
                  <b style={{ color: m.color, letterSpacing: 0.3 }}>{exitReasonOf(a)}</b>{' · '}
                  <b style={{ color: C.text }}>{top ? top.condition : a.because}</b>
                  {top && <span> — {top.evidence}</span>}
                </span>
                <span style={{ fontSize: 9, fontWeight: 900, color: m.color }}>{m.dot} {m.label}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* ── CAPEX WATCH — money spent, earnings not yet arrived. ────────── */}
      {capexWatch.length > 0 && (
        <div>
          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.5, color: C.faint, margin: '6px 0 5px' }}>
            CAPEX SPENT, EARNINGS NOT YET ARRIVED · {capexWatch.length}
          </div>
          {capexWatch.map((r) => {
            const cm = CAPEX_META[r.capex!.state];
            return (
              <div key={r.symbol} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '4px 0',
                fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
                <span style={{ fontWeight: 900, color: C.text, minWidth: 92 }}>{r.symbol}</span>
                <span style={{ fontSize: 9, fontWeight: 800, color: cm.color, minWidth: 210 }}>{cm.dot} {cm.label}</span>
                <span style={{ flex: 1 }}>{r.capex!.because}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* The full evidence cards for everything flagged. */}
      {flagged.map((r) => (
        <ThesisCard key={r.symbol} defaultOpen
          origin={r.origin || 'book'}
          symbol={r.symbol} market={r.market} tier={r.tier} pattern={r.pattern}
          radarScore={r.radarScore} assessment={r.assessment} capex={r.capex}
          documentsRead={r.documentsRead}
          discoveryAttempts={r.discoveryAttempts}
          discoveryState={r.discoveryState}
          documentOutcomes={r.documentOutcomes}
          ledger={r.ledger}
          freshness={r.freshness}
          reportingPeriod={r.reportingPeriod}
          changed={r.changed}
          changedFrom={r.changedFrom}
          dataPeriod={r.graded?.period || null}
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
