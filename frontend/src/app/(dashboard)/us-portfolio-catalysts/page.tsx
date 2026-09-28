// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO CATALYSTS — WHAT CHANGED IN THE US NAMES YOU OWN.      (zzz790)
//
// The India page's engine, unchanged, over SEC evidence:
//   thesis ledger A / B / F / G · the same statuses (THESIS NOT SET, a
//   nearest fit is PROVISIONAL → at most CONFIRMATION REQUIRED) · silence is
//   NOT DISCLOSED, never a pass · level ≠ trend · target ≠ achieved ·
//   historical ≠ current · output ≠ mechanism · headroom ≠ runway ·
//   commissioned ≠ earning · counts reconcile · Special Focus + near misses.
//
// Evidence: 10-Q / 10-K MD&A and the 8-K Item 2.02 earnings release (EX-99.1)
// from SEC EDGAR, read on click into the US ledger (us-evidence:ledger:v1:*).
// Output figures (revenue / earnings / margin / cash conversion) come from
// the company's XBRL filings, deterministically, with no model.
//
// zzz793: the company's own fiscal periods and SEC wording on every card
// (lib/us-thesis/display), $M never crore, a provisional type for every
// holding with SEC data, Conviction Beats (US) on the bench, reads that
// always end, no ranking number on screen.
//
// NO PRICE IS READ ON THIS PAGE OR IN ITS ENGINE. The book is read through
// its price-free projection (/api/v1/us-book?view=universe).
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useUsBook, US_CB_SOURCE } from '@/lib/us-thesis/use-us-book';
import { usDisplayer } from '@/lib/us-thesis/display';
import { usExportLine, usWhyLine, usBatchLine } from '@/lib/us-thesis/page-words';
import { usNoTypeReason } from '@/lib/us-thesis/us-type';
import { usdWords } from '@/lib/us-thesis/xbrl';
import { usTickerKey } from '@/lib/us-thesis/sanitize';
import { ThesisCard } from '@/components/thesis-card';
import { PersistentStrip } from '@/components/special-focus-panel';
import { usDetect } from '@/lib/us-thesis/persist-us';
import { UsSpecialFocusPanel } from '@/components/us-special-focus-panel';
import { STATUS_META, type ThesisStatus } from '@/lib/thesis/status';
import { evidenceCounts, universeCounts, researchPriorityEligible, researchPriorityTitle } from '@/lib/thesis/evidence-counts';
import NewCatalystsTab from '@/components/catalyst/new-catalysts-tab';
import { buildRecentCatalysts, rawFromLedger, rawFromPersistent, localToday, windowRange, countInRange, type RawEvent, type ThesisCtx, type WindowSpan } from '@/lib/catalyst/recent-events';
import { useFilingReads } from '@/components/catalyst/use-filing-reads';
import { nextWindow, PC_PAGE_STEP, readScope, otherBenchLabel, cbCriteriaLine } from '@/lib/thesis/pc-bench';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)', green: 'var(--mc-verdict-up, #34D399)', cyan: 'var(--tc-accent, #22D3EE)',
};

const ORDER: ThesisStatus[] = [
  'BROKEN', 'WEAKENING', 'NEGATIVE_EXPECTATION_GAP', 'POSITIVE_EXPECTATION_GAP',
  'EVIDENCE_INCOMPLETE', 'CONFIRMATION_REQUIRED', 'ON_TRACK', 'STRENGTHENING', 'NEUTRAL', 'THESIS_NOT_SET',
];
const CONSTRUCTIVE = ['STRENGTHENING', 'ON_TRACK', 'CONFIRMATION_REQUIRED', 'POSITIVE_EXPECTATION_GAP'];

const pill = (on: boolean, color = C.cyan): React.CSSProperties => ({
  fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${on ? color : C.border}`, color: on ? color : C.dim, background: on ? `color-mix(in srgb, ${color} 14%, transparent)` : C.bg,
});

export default function UsPortfolioCatalystsPage() {
  const { rows, excluded, universeError, loading, evidenceLoading, batch, priorBatch, checkBatch, readFiling, readAll, checkAll, readPriorPeriods, stop, thesisTypes, setThesisType, needsPrior, cbCriteria, cbPassing } = useUsBook();
  const [filter, setFilter] = useState<ThesisStatus | null>(null);
  const [source, setSource] = useState<'all' | 'book' | 'bench'>('all');
  const [copied, setCopied] = useState<string | null>(null);
  // zzz808: the catalyst board, or "New · last 10 days".
  const [view, setView] = useState<'board' | 'new'>('board');

  // zzz811: the bench is the US Conviction Beats list selected by his US
  // Conviction Beats criteria; names missing them are one chip away.
  const [showFailing, setShowFailing] = useState(false);
  const all0 = useMemo(() => Object.values(rows), [rows]);
  const failingBench = useMemo(() => all0.filter((r) => r.origin === 'bench' && r.preset?.state === 'fail'), [all0]);
  const all = useMemo(() => (showFailing ? all0 : all0.filter((r) => !(r.origin === 'bench' && r.preset?.state === 'fail'))), [all0, showFailing]);
  const cbOnPageCount = useMemo(() => { const p = new Set(cbPassing); return all0.filter((r) => p.has(usTickerKey(r.symbol))).length; }, [all0, cbPassing]);
  // zzz811: a held name is shown once, in My US book — "US bench" is the
  // names you do not hold, so All = book + bench exactly (the chip counts).
  const inSource = useMemo(() => all.filter((r) => source === 'all' ? true : source === 'book' ? r.origin !== 'bench' : r.origin === 'bench'), [all, source]);
  const uc = useMemo(() => universeCounts(all as any, all as any, CONSTRUCTIVE, { market: 'US' }), [all]);
  const ucView = useMemo(() => universeCounts(all as any, inSource as any, CONSTRUCTIVE, { market: 'US' }), [all, inSource]);
  const ec = useMemo(() => evidenceCounts(inSource as any), [inSource]);
  const list = useMemo(() => {
    const f = filter ? inSource.filter((r) => r.assessment?.status === filter) : inSource;
    return [...f].sort((a, b) => {
      const ai = ORDER.indexOf(a.assessment?.status || 'NEUTRAL'), bi = ORDER.indexOf(b.assessment?.status || 'NEUTRAL');
      if (ai !== bi) return ai - bi;
      return (b.assessment?.triggered.length || 0) - (a.assessment?.triggered.length || 0) || a.symbol.localeCompare(b.symbol);
    });
  }, [inSource, filter]);
  // zzz811: progressive rendering — the bench can run to hundreds of cards.
  const [shownN, setShownN] = useState(PC_PAGE_STEP);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { setShownN(PC_PAGE_STEP); }, [source, filter, showFailing]);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShownN((n) => nextWindow(n, list.length)); }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length, shownN]);
  const visible = useMemo(() => list.slice(0, shownN), [list, shownN]);
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const jumpTo = (t: string) => { setFilter(null); setPendingJump(t); };
  useEffect(() => {
    if (!pendingJump) return;
    const idx = list.findIndex((r) => r.symbol === pendingJump);
    if (idx < 0) { if (source !== 'all') { setSource('all'); return; } setPendingJump(null); return; }
    if (idx >= shownN) { setShownN(idx + PC_PAGE_STEP); return; }
    const t = pendingJump;
    setPendingJump(null);
    setTimeout(() => document.getElementById(`uspc-${t}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [pendingJump, list, shownN, source]);
  // Detection runs on the engine's rows (period keys intact); what is PRINTED
  // goes through the US wording (the company's own fiscal periods, $M).
  const displayerBySymbol = useMemo(() => new Map(all.map((r) => [r.symbol, usDisplayer(r)] as const)), [all]);
  const displayBySymbol = useMemo(() => new Map(visible.map((r) => [r.symbol, (displayerBySymbol.get(r.symbol) || ((x: any) => x))(r)] as const)), [visible, displayerBySymbol]);
  const persistBySymbol = useMemo(() => new Map(visible.map((r) => [r.symbol, (displayerBySymbol.get(r.symbol) || ((x: any) => x))(usDetect(r as any))] as const)), [visible, displayerBySymbol]);
  // zzz797: bench names that came from US Conviction Beats, and CB names you already hold.
  const cbOnPage = all.filter((r) => r.origin === 'bench' && r.benchSource === US_CB_SOURCE).length;
  const needsIt = (r: typeof inSource[number]) => !r.summary || r.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' || r.freshness?.state === 'STALE'
    || ['NEW_EVIDENCE_AVAILABLE', 'STALE', 'RETRIEVAL_FAILED', 'SOURCE_UNAVAILABLE'].includes(String(r.freshness?.evidence_state || ''));
  // zzz811: bulk reads cover the US book + bench names meeting your US
  // Conviction Beats criteria; the rest of the bench is its own manual button.
  const scope = readScope(inSource, 'US');
  const needRead = scope.primary.filter(needsIt);
  const needReadOther = scope.otherBench.filter(needsIt);
  const primarySyms = scope.primary.map((r) => r.symbol);
  const needPrior = list.filter((r) => needsPrior(r));
  const anyRunning = batch.running || priorBatch.running || checkBatch.running;
  const excludedBook = excluded.filter((e) => e.origin !== 'bench').length;
  const excludedBench = excluded.length - excludedBook;

  // ── NEW IN THE LAST 10 DAYS. (zzz808) Every dated SEC filing (8-K, 10-Q,
  // 10-K, 20-F, 6-K) and extracted event already on file for the US names on
  // screen (book + bench), plus the persistent-catalyst items.
  // zzz813: every 8-K in the window is opened (EX-99.1 + the 8-K body) and read deterministically.
  const today = useMemo(() => localToday(), []);
  const recentRaws = useMemo(() => {
    if (loading || evidenceLoading) return null;
    const raws: RawEvent[] = [];
    for (const r of all) {
      const co0 = r.sec?.company || r.graded?.company || null;
      const co = co0 && String(co0).toUpperCase() !== r.symbol.toUpperCase() ? String(co0) : null;
      const set = thesisTypes[r.symbol.toUpperCase()];
      const ctx: ThesisCtx = set ? { pattern: String(set), fit: 'exact', assessment: r.assessment }
        : r.pattern?.pattern ? { pattern: String(r.pattern.pattern), fit: r.pattern.fit === 'nearest' ? 'provisional' : 'exact', assessment: r.assessment }
        : { pattern: null, assessment: r.assessment };
      raws.push(...rawFromLedger(r.symbol, co, r.ledger, r.assessment, ctx));
      let pcs: any[] = [];
      try { pcs = usDetect(r as any); } catch { pcs = []; }
      raws.push(...rawFromPersistent(r.symbol, co, pcs, r.assessment, ctx));
    }
    return raws;
  }, [all, loading, evidenceLoading, thesisTypes]);
  const readQueue = useMemo(() => (recentRaws ? buildRecentCatalysts(recentRaws, today, { market: 'US' }).toRead : []), [recentRaws, today]);
  const { reads: filingReads, progress: readProgress } = useFilingReads(readQueue, 'US', !!recentRaws);
  const recentNew = useMemo(() => (recentRaws ? buildRecentCatalysts(recentRaws, today, { market: 'US', reads: filingReads }) : null), [recentRaws, today, filingReads]);
  // zzz814: the selected days (Today · 3d · 5d · 10d, stepped / jumped) — the tab label counts the same window.
  const [newWin, setNewWin] = useState<{ span: WindowSpan; anchor: string | null }>({ span: 10, anchor: null });
  const newLabel = useMemo(() => {
    if (!recentNew) return 'New \u00B7 last 10 days (\u2026)';
    const r = windowRange(today, newWin.span, newWin.anchor, recentNew.window.days);
    const words = newWin.anchor ? (r.from === r.to ? r.to : `${r.from} to ${r.to}`) : newWin.span === 1 ? 'today' : `last ${newWin.span} days`;
    return `New \u00B7 ${words} (${countInRange(recentNew.items, r, today)})`;
  }, [recentNew, newWin, today]);
  const recentNotes = useMemo(() => {
    const n: string[] = [];
    const ecs = evidenceCounts(all as any);
    if (ecs.source_unavailable > 0) n.push(`${ecs.source_unavailable} name${ecs.source_unavailable === 1 ? '' : 's'}: SEC EDGAR could not be reached on the last check, so a new filing may be missing.`);
    if (ecs.retrieval_failed > 0) n.push(`${ecs.retrieval_failed} name${ecs.retrieval_failed === 1 ? '' : 's'}: filings were found but could not be downloaded or read.`);
    const never = all.filter((r) => !r.ledger).length;
    if (never > 0) n.push(`${never} name${never === 1 ? ' has' : 's have'} never been checked on EDGAR, so nothing new can show for ${never === 1 ? 'it' : 'them'} yet.`);
    if (excluded.length > 0) n.push(`${excluded.length} non-US listing${excluded.length === 1 ? ' is' : 's are'} not covered (no SEC filer).`);
    return n;
  }, [all, excluded.length]);

  if (universeError) {
    return <div style={{ padding: 24, color: C.dim, fontSize: 15 }}><h1 style={{ fontSize: 20, fontWeight: 800, color: C.text }}>US Portfolio Catalysts</h1>
      The US book could not be read — the server answered: <i>{universeError}</i>. This is not the same as an empty book; nothing has been assessed.</div>;
  }
  if (!loading && !all.length && !excluded.length) {
    return <div style={{ padding: 24, color: C.dim, fontSize: 15, lineHeight: 1.6 }}><h1 style={{ fontSize: 20, fontWeight: 800, color: C.text }}>US Portfolio Catalysts</h1>
      Your US book is empty. Import it on the <a href="/us-portfolio-book" style={{ color: C.cyan }}>US Portfolio Book</a> page (CSV or an IBKR positions paste) and every US-listed holding will appear here with its thesis ledger.</div>;
  }

  // TradingView spells share classes with a dot (NYSE:MOG.A) and lists NYSE American / Arca as AMEX.
  const tvPrefix = (x: string | undefined): string => {
    const v = String(x || '').toUpperCase();
    if (/^NYSE$|NEW YORK/.test(v)) return 'NYSE';
    if (/AMEX|AMERICAN|MKT|ARCA/.test(v)) return 'AMEX';
    if (/NASDAQ|NMS|NGS|NGM|NCM|ISLAND/.test(v)) return 'NASDAQ';
    return '';
  };
  const copyTv = async (names: typeof all, label: string) => {
    const tv = names.map((r) => { const x = tvPrefix(r.exchange); const t = r.symbol.replace(/-/g, '.'); return x ? `${x}:${t}` : t; }).join(',');
    try { await navigator.clipboard.writeText(tv); setCopied(`Copied ${names.length} ${label}`); } catch { setCopied('Clipboard write failed'); }
    setTimeout(() => setCopied(null), 3000);
  };

  const constructive = inSource.filter((r) => CONSTRUCTIVE.includes(String(r.assessment?.status)));

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>🇺🇸 US Portfolio Catalysts</h1>
        <div style={{ fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 860 }}>
          The same thesis engine as India Portfolio Catalysts, over <b style={{ color: C.text }}>SEC evidence</b>: every US holding carries a thesis ledger (A · B · F · G) checked against its
          10-Q / 10-K and 8-K earnings release. Revenue, earnings, margin and cash conversion come from the company&apos;s XBRL filings (no model), quarter against the same quarter a year earlier, in the company&apos;s own fiscal calendar.
          Backlog, capacity, utilization, capex and guidance come from the filings, read on click. <b style={{ color: C.text }}>No price is read anywhere in this engine.</b>{' '}
          Separate from the India book and ledgers. <a href="/portfolio-catalysts" style={{ color: C.cyan }}>India Portfolio Catalysts →</a>
        </div>
      </div>

      {/* ── THE VIEWS. (zzz808) The catalyst board, or what is new. ─────── */}
      <div className="mc-wrap-mobile" role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {([['board', 'Catalyst board'], ['new', newLabel]] as Array<[typeof view, string]>).map(([k, label]) => {
          const on = view === k;
          return <button key={k} role="tab" aria-selected={on} onClick={() => setView(k)} style={{ ...pill(on), fontSize: 14, fontWeight: 900, padding: '6px 14px', borderRadius: 8 }}>{label}</button>;
        })}
      </div>

      {view === 'new' ? (
        <NewCatalystsTab result={recentNew} loading={loading || evidenceLoading} names={all.length} sourceNotes={recentNotes} market="US" progress={readProgress} win={newWin} onWin={setNewWin}
          onJump={(t) => { setView('board'); setSource('all'); jumpTo(t); }} />
      ) : (<>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {([['all', `All US-listed ${uc.shown}`], ['book', `📗 My US book ${uc.book}`], ['bench', `🏆 US bench ${uc.bench}${cbOnPage ? ` (incl. ${cbOnPage} ${US_CB_SOURCE})` : ''}`]] as Array<[typeof source, string]>).map(([k, label]) => (
          <button key={k} onClick={() => setSource(k)} style={pill(source === k)}>{label}</button>
        ))}
        {(failingBench.length > 0 || showFailing) && (
          <button data-testid="us-show-failing-chip" onClick={() => setShowFailing((v) => !v)} style={pill(showFailing, C.amber)}
            title="US Conviction Beats names you do not hold that miss your US Conviction Beats criteria. Off by default; each card says which criteria it misses.">
            {showFailing ? '✓ ' : ''}Also show names failing your criteria ({failingBench.length})
          </button>
        )}
        {excluded.length > 0 && <span style={{ fontSize: 13, color: C.amber }}>{excluded.length} non-US listing{excluded.length === 1 ? '' : 's'} excluded (no SEC coverage) — listed below</span>}
      </div>
      {!loading && (
        <div data-testid="us-cb-criteria-line" style={{ fontSize: 13, lineHeight: 1.5, color: cbCriteria && cbOnPageCount !== cbCriteria.passing ? C.amber : C.dim }}>
          <b style={{ color: cbCriteria && cbOnPageCount !== cbCriteria.passing ? C.amber : C.text }}>{cbCriteriaLine(cbCriteria, cbOnPageCount, showFailing)}</b>
          <div data-testid="us-preset-note" style={{ fontSize: 12.5, color: C.faint }}>
            The bench is selected by your Conviction Beats criteria, which may read price (50- and 200-day averages) to choose names. The thesis engine on this page reads no price.
          </div>
        </div>
      )}

      {!loading && cbCriteria && cbCriteria.listTotal === 0 && (
        <div data-testid="us-cb-empty" style={{ fontSize: 13.5, color: C.dim, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
          <b style={{ color: C.amber }}>🏆 US bench is empty.</b> The US Conviction Beats list is empty{cbCriteria.error ? ` (${cbCriteria.error})` : ''} — open US Conviction Beats once to fill it; the server list fills itself after the nightly US grading runs.{' '}
          <a href="/us-conviction-beats" style={{ color: C.cyan }}>US Conviction Beats →</a>
        </div>
      )}

      {!loading && !evidenceLoading && (
        <div data-testid="us-universe-reconciliation" style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
          <b style={{ color: C.text }}>
            {uc.shown + excluded.length} names in the US book + bench = {uc.shown} US-listed (assessed) + {excluded.length} non-US listed (excluded{excluded.length ? `: ${excludedBook} book, ${excludedBench} bench` : ''})
            {' '}· {uc.shown} = {uc.book} book + {uc.bench} bench
          </b>
          {' '}· status buckets {ORDER.filter((s) => uc.byStatus[s]).map((s) => uc.byStatus[s]).join(' + ') || 0}{uc.notAssessed ? ` + ${uc.notAssessed} not yet assessed` : ''} = {uc.statusSum + uc.notAssessed} shown
          {' '}· {uc.thesisNotSet} thesis not set · {uc.provisional} provisional (nearest-fit)
          {source !== 'all' && <span style={{ color: C.faint }}> · view {source}: {ucView.shown} shown, buckets {ucView.statusSum}{ucView.notAssessed ? ` + ${ucView.notAssessed} not yet assessed` : ''}</span>}
        </div>
      )}
      {evidenceLoading && !loading && (
        <div role="status" style={{ fontSize: 13.5, fontWeight: 700, color: C.cyan, padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
          Loading XBRL figures and stored SEC evidence for {all.length} companies… statuses and counts appear when it is in (no AI is used).
        </div>
      )}

      <div className="mc-grid-2-mobile" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', opacity: evidenceLoading ? 0.35 : 1, pointerEvents: evidenceLoading ? 'none' : undefined }}>
        {ORDER.map((s) => {
          const m = STATUS_META[s];
          const on = filter === s;
          return (
            <button key={s} onClick={() => setFilter(on ? null : s)} title={m.meaning} style={{ display: 'flex', alignItems: 'baseline', gap: 7, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${on ? m.color : C.border}`, background: on ? `${m.color}18` : C.bg }}>
              <span style={{ fontSize: 19, fontWeight: 900, color: `color-mix(in srgb, ${m.color} 65%, var(--tc-text, #F1F5F9))` }}>{evidenceLoading ? '…' : (ucView.byStatus[s] || 0)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: C.dim }}>{m.dot} {m.label}</span>
            </button>
          );
        })}
      </div>

      {!evidenceLoading && constructive.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', background: C.bg, fontSize: 13, color: C.dim }}>
          <b style={{ color: C.text }}>📋 TradingView · US — {constructive.length} eligible for research export</b> · {usExportLine(inSource as any, (s) => STATUS_META[s as ThesisStatus]?.label || s).line}
          <button onClick={() => copyTv(constructive, 'US names')} style={{ ...pill(false), marginLeft: 8, fontSize: 12.5 }}>Copy for TradingView</button>
          {copied && <span style={{ marginLeft: 8, color: C.green }}>{copied}</span>}
        </div>
      )}

      <UsSpecialFocusPanel rows={inSource as any} ready={!evidenceLoading && !loading}
        display={(t, x) => (displayerBySymbol.get(String(t).toUpperCase()) || displayerBySymbol.get(t) || ((y: any) => y))(x)}
        onReadPrior={(t) => readPriorPeriods(t)} priorRunning={priorBatch.running}
        thesisLabel={(r: any) => {
          const set = thesisTypes[String(r.symbol).toUpperCase()];
          if (set) return `${set} (set by you)`;
          if (r.pattern?.pattern) return r.pattern.fit === 'nearest' ? `${r.pattern.pattern} (provisional — confirm it)` : `${r.pattern.pattern} (auto)`;
          return 'Not set';
        }}
        onJump={(t) => jumpTo(t)} />

      {!evidenceLoading && (() => {
        const ranked = inSource.filter((r) => r.assessment?.catalystRank && researchPriorityEligible(r.assessment.status))
          .sort((a, b) => b.assessment!.catalystRank!.score - a.assessment!.catalystRank!.score);
        if (!ranked.length) return null;
        return (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.bg }}>
            <div style={{ fontSize: 15, fontWeight: 900, color: C.text, marginBottom: 4 }}>🏁 {researchPriorityTitle(ranked.length)}</div>
            <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 6 }}>Only 🟢 strengthening / 🔵 on-track theses are eligible, ordered by how firmly the filings evidence the catalyst. Research order, not a buy list — no price used.</div>
            {ranked.slice(0, 15).map((r, i) => (
              <div key={r.symbol} style={{ fontSize: 13, color: C.dim, padding: '3px 0', borderTop: `1px solid ${C.border}` }}>
                <b style={{ color: C.text }}>{i + 1}. {r.symbol}</b> · {STATUS_META[r.assessment!.status].label}
                <div style={{ color: C.faint }}>{usWhyLine((displayBySymbol.get(r.symbol) || (displayerBySymbol.get(r.symbol) || ((x: any) => x))(r))?.assessment?.catalystRank || r.assessment!.catalystRank)}</div>
              </div>
            ))}
          </div>
        );
      })()}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, color: C.faint }}>
          {list.length} of {inSource.length} shown · {ec.held} held · {ec.bench} bench ·{' '}
          {evidenceLoading ? <b style={{ color: C.text }}>loading…</b> : <><b style={{ color: C.text }}>{ec.evidence_read} of {inSource.length} have SEC evidence read</b> · {ec.documents_read} documents read</>}
          {!evidenceLoading && ec.incomplete > 0 && <> · {ec.incomplete} evidence incomplete</>}
          {ec.new_evidence > 0 && <> · <b style={{ color: C.amber }}>{ec.new_evidence} with a newer SEC filing unread</b></>}
          {!evidenceLoading && ec.stale > 0 && <> · {ec.stale} stale</>}
          {ec.source_unavailable > 0 && <> · {ec.source_unavailable} source unavailable</>}
          {!evidenceLoading && ec.retrieval_failed > 0 && <> · {ec.retrieval_failed} retrieval failed</>}
        </span>
        {!evidenceLoading && !batch.running && (
          <button onClick={() => readAll(primarySyms)} title="Your US book plus bench names meeting your Conviction Beats criteria. Reads and persists the SEC evidence of each name that needs it — never read, failed, or with a newer filing. Current names are skipped without a model call. Two at a time; a failed read is retried once."
            style={pill(true)}>&#10024; {needRead.length ? `Read SEC evidence for ${needRead.length} that need it (uses AI) — book + bench meeting your criteria` : 'All evidence current (book + bench meeting your criteria)'}</button>
        )}
        {!evidenceLoading && !batch.running && needReadOther.length > 0 && (
          <button data-testid="us-read-other-bench" onClick={() => readAll(needReadOther.map((r) => r.symbol))}
            title="US bench names that miss your Conviction Beats criteria (shown with the chip). Manual only — never started automatically. Two at a time; Stop works."
            style={pill(false)}>{otherBenchLabel(needReadOther.length)}</button>
        )}
        {batch.running && <><span style={{ fontSize: 13.5, fontWeight: 700, color: C.cyan }}>{usBatchLine(batch)}</span><button onClick={stop} style={pill(true, C.amber)}>Stop</button></>}
        {!batch.running && usBatchLine(batch) && <span style={{ fontSize: 13, color: C.amber }}>{usBatchLine(batch)}</span>}
        {!anyRunning && !evidenceLoading && (
          <button onClick={() => checkAll(list.map((r) => r.symbol))} title="Asks EDGAR for 10-Q / 10-K / 8-K Item 2.02 filings not yet on file. Discovery only — no AI, nothing is read." style={pill(false)}>&#8635; Check EDGAR for new filings (no AI)</button>
        )}
        {checkBatch.running && <><span style={{ fontSize: 13.5, fontWeight: 700, color: C.cyan }}>Checking {checkBatch.done} of {checkBatch.total}… {checkBatch.found} with new filings</span><button onClick={stop} style={pill(true, C.amber)}>Stop</button></>}
        {!checkBatch.running && checkBatch.total > 0 && <span style={{ fontSize: 13, color: C.faint }}>Last check: {checkBatch.done} of {checkBatch.total} · {checkBatch.found} with new filings (no AI used)</span>}
        {!anyRunning && !evidenceLoading && needPrior.length > 0 && (
          <button onClick={() => readPriorPeriods(needPrior.map((r) => r.symbol))} title="For names with only one quarter on file, reads the quarter before (its 10-Q and earnings release) so every variable gets a before → after." style={pill(true)}>
            &#8635; Read prior quarter for {needPrior.length} (uses AI · enables before → after)
          </button>
        )}
        {priorBatch.running && <><span style={{ fontSize: 13.5, fontWeight: 800, color: C.cyan }}>{usBatchLine(priorBatch, 'Reading prior quarter')}</span><button onClick={stop} style={pill(true, C.amber)}>Stop</button></>}
        <a href="/us-portfolio-book" style={{ marginLeft: 'auto', fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, border: `1px solid ${C.border}`, color: C.dim, textDecoration: 'none' }}>US Portfolio Book →</a>
      </div>

      {!loading && !batch.running && !batch.stopped && (batch.resumable || 0) > 0 && (
        <div style={{ fontSize: 14, color: C.dim, border: `1px solid ${C.cyan}`, borderRadius: 8, padding: '9px 13px' }}>
          <b style={{ color: C.text }}>Last batch: {batch.done} processed · {batch.resumable} remaining</b> — persisted; nothing was lost on reload.{' '}
          <button onClick={() => readAll(primarySyms)} title="Resumes over your US book + bench meeting your criteria." style={pill(true)}>Resume</button>
        </div>
      )}

      {!loading && !evidenceLoading && ec.evidence_read < inSource.length && (
        <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 13px' }}>
          <b style={{ color: C.text }}>{inSource.length - ec.evidence_read} of {inSource.length} US names have no SEC evidence read.</b>{' '}
          Revenue, earnings, margin and cash conversion are already on the cards from XBRL. <b style={{ color: C.text }}>Backlog, capacity, utilization, capex and guidance are not</b> — they live in the MD&amp;A and the release, and until read those names sit at <b style={{ color: C.text }}>EVIDENCE INCOMPLETE</b>: silence is NOT DISCLOSED, never a pass.
        </div>
      )}

      {(() => {
        const untyped = list.filter((r) => !r.pattern);
        const nearest = list.filter((r) => r.pattern?.fit === 'nearest' && !thesisTypes[r.symbol.toUpperCase()]);
        return untyped.length || nearest.length ? (
          <div style={{ fontSize: 13, color: C.dim, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
            {untyped.length > 0 && <><b style={{ color: '#A78BFA' }}>◇ Thesis not set — {untyped.length}.</b> There is nothing in the SEC data to fit a type from, so they sit in <b>THESIS NOT SET</b> — not intact, not weakening. Set why you hold each with the <b>thesis</b> picker on its card.
              {untyped.map((r) => <div key={r.symbol} style={{ fontSize: 12, color: C.faint, marginTop: 2 }}><b style={{ color: C.dim }}>{r.symbol}</b> — {usNoTypeReason(r.sec, r.gradedWhy)}</div>)}</>}
            {nearest.length > 0 && <div style={{ marginTop: untyped.length ? 6 : 0 }}><b style={{ color: C.cyan }}>{nearest.length} on a provisional type (worked out from the company&apos;s own SEC data)</b> — CONFIRMATION REQUIRED: the status cannot read strengthening, on track or weakening until you confirm or change the type with the picker.
              <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>{nearest.map((r) => `${r.symbol} (provisional ${r.pattern!.pattern})`).join(' · ')}</div></div>}
          </div>
        ) : null;
      })()}

      {loading && <div style={{ fontSize: 14, color: C.dim }}>Reading your US book…</div>}

      {visible.map((r0) => { const r = displayBySymbol.get(r0.symbol) || r0; return (
        <div key={r0.symbol} id={`uspc-${r0.symbol}`} data-testid="us-card-block" style={{ scrollMarginTop: 70, border: `1px solid ${C.border}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* zzz793: ONE block per company, top to bottom — the company's
              own line, then ITS persistent-catalyst strip (named), then ITS
              card. The strip used to sit above a fiscal line and read as the
              previous company's card (RELL's order book under NTNX). */}
          <div style={{ fontSize: 12, color: C.faint, padding: '2px 4px', lineHeight: 1.5 }}>
            <b style={{ color: C.text }}>{r0.symbol}</b>{' · '}
            {r0.graded?.period
              ? <>SEC XBRL figures: <b style={{ color: C.dim }}>{String(r0.graded.period)}</b> vs the same quarter a year earlier{r0.graded.xbrl_derived ? ` · ${String(r0.graded.xbrl_derived)}` : ''}{r0.graded.currency && r0.graded.currency !== 'USD' ? ` · reported in ${String(r0.graded.currency)} (growth rates only)` : ''}</>
              : <>No quarterly SEC XBRL figures: {r0.sec?.note || r0.gradedWhy || 'not loaded yet'}</>}
            {r0.sec?.forms_line ? ` · ${r0.sec.forms_line}` : ''}
            {(r0.graded?.rpo || r0.sec?.rpo) ? <> · order backlog (RPO, SEC XBRL) <b style={{ color: C.dim }}>{usdWords((r0.graded?.rpo || r0.sec?.rpo).cur.value)}</b>{(r0.graded?.rpo || r0.sec?.rpo).pct != null ? ` (${(r0.graded?.rpo || r0.sec?.rpo).pct >= 0 ? '+' : ''}${(r0.graded?.rpo || r0.sec?.rpo).pct}% on a year earlier)` : ''}</> : null}
            {r0.benchSource ? <> · on the bench from <b style={{ color: C.dim }}>{r0.benchSource}</b></> : null}
            {r0.origin === 'bench' && r0.preset ? <> · <b data-testid="us-bench-criteria-label" style={{ color: r0.preset.state === 'pass' ? C.green : C.amber }}>{r0.preset.state === 'pass' ? '✅ ' : '✖ '}{r0.preset.text}</b></> : null}
          </div>
          {!evidenceLoading && <PersistentStrip ticker={r0.symbol} pcs={persistBySymbol.get(r0.symbol) || []} onOpenFocus={() => document.getElementById('us-special-focus')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
          <ThesisCard
            thesisType={(thesisTypes[r.symbol.toUpperCase()] as any) || null}
            onThesisType={(t) => setThesisType(r.symbol, t)}
            symbol={r.symbol} market="US" tier={r.tier} pattern={r.pattern}
            radarScore={null} assessment={r.assessment} capex={r.capex} origin={r.origin}
            documentsRead={r.documentsRead} discoveryAttempts={r.discoveryAttempts} discoveryState={r.discoveryState} documentOutcomes={r.documentOutcomes}
            needsRead={!r.summary && r.state !== 'loading'} reading={r.state === 'loading'}
            onRead={() => readFiling(r.symbol, r.summary ? 'incremental' : 'read')}
            onCheck={() => readFiling(r.symbol, 'check')}
            onReread={() => readFiling(r.symbol, 'force')}
            error={r.error} ledger={r.ledger} freshness={r.freshness} reportingPeriod={r.reportingPeriod}
            changed={r.changed} changedFrom={r.changedFrom} persisted={r.persisted} readNote={r.readNote}
            promiseNote={r.state === 'done' ? r.promiseNote : null}
            dataSource={r.dataSource} dataPeriod={r.graded?.period || null}
            sources={r.sourceUrl ? [{ label: 'SEC filing', url: r.sourceUrl }] : []}
          />
        </div>
      ); })}
      {list.length > visible.length && (
        <div ref={moreRef} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 2px' }}>
          <span style={{ fontSize: 13.5, color: C.faint }}>Showing {visible.length} of {list.length} US cards — more load as you scroll.</span>
          <button onClick={() => setShownN((n) => nextWindow(n, list.length))} style={pill(true)}>Show {Math.min(PC_PAGE_STEP, list.length - visible.length)} more</button>
          <button onClick={() => setShownN(list.length)} style={pill(false)}>Show all {list.length}</button>
        </div>
      )}

      {excluded.length > 0 && (
        <div data-testid="us-excluded" style={{ border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 12px', background: C.bg }}>
          <div style={{ fontSize: 14, fontWeight: 900, color: C.amber }}>Excluded from US catalyst evidence — {excluded.length} non-US listing{excluded.length === 1 ? '' : 's'}</div>
          <div style={{ fontSize: 12.5, color: C.faint, marginBottom: 4 }}>These are in your US book but trade on a non-US venue (e.g. Frankfurt FWB2, EUR). They have no SEC filer, so there is no 10-Q / 10-K / 8-K to read. They are not assessed and not counted in any status — said here rather than dropped.</div>
          {excluded.map((e) => (
            <div key={e.ticker} style={{ fontSize: 13, color: C.dim, borderTop: `1px solid ${C.border}`, padding: '3px 0' }}>
              <b style={{ color: C.text }}>{e.ticker}</b> <span style={{ color: C.faint }}>· {e.origin === 'bench' ? 'bench' : 'book'} · {e.exchange || 'venue not stated'}</span> — {e.excludedReason}
            </div>
          ))}
        </div>
      )}
      </>)}
    </div>
  );
}
