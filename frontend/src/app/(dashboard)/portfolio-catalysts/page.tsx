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

import TickerExportToolbar from '@/components/TickerExportToolbar';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBook } from '@/lib/thesis/use-book';
import { ThesisCard } from '@/components/thesis-card';
import { SpecialFocusPanel, PersistentStrip, detectForRow } from '@/components/special-focus-panel';
import { STATUS_META, type ThesisStatus } from '@/lib/thesis/status';
import { isSmallMidCap, SMALL_MID_CAP_MAX_CR } from '@/lib/thesis/universe';
import { priorBackfillPlan } from '@/lib/thesis/prior-period';
import { evidenceCounts, universeCounts, researchPriorityEligible, researchPriorityTitle, researchWhyLine, exportCounts, evidenceAttention, RESEARCH_EXPORT_STATUSES } from '@/lib/thesis/evidence-counts';
import NewCatalystsTab from '@/components/catalyst/new-catalysts-tab';
import { buildRecentCatalysts, rawFromLedger, rawFromPersistent, rawFromFeed, localToday, windowRange, countInRange, nameMapOf, normUrl, type RawEvent, type ThesisCtx, type WindowSpan } from '@/lib/catalyst/recent-events';
import { getConvictionList } from '@/lib/conviction-beats';
import { useFilingReads } from '@/components/catalyst/use-filing-reads';
import { cbCriteriaLine, nextWindow, PC_PAGE_STEP, readScope, otherBenchLabel, cbViewRows, cbViewTag, cbViewLine, heldKey } from '@/lib/thesis/pc-bench';
import { readCbTabSnapshot, reconcileCbLists, type CbTabSnapshot } from '@/lib/india-cb-view';
import { quickProgressLine } from '@/lib/thesis/quick-read';
import BookCheckPanel from '@/components/BookCheckPanel';
import { buildBookCheck } from '@/lib/thesis/book-membership';
import { aiReadPlan, aiReadStatus, aiSourcesExplainer } from '@/lib/thesis/ai-read';

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  // High-contrast text levels shared with the thesis card (zzz765).
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)', green: 'var(--mc-verdict-up, #34D399)', cyan: 'var(--tc-accent, #22D3EE)',
};

// EVIDENCE_INCOMPLETE ranks ABOVE strengthening and neutral: an unchecked
// holding is a piece of work outstanding, and burying it under the ones that
// have been cleared is how it stays unchecked. (zzz717)
const ORDER: ThesisStatus[] = [
  'BROKEN', 'WEAKENING', 'NEGATIVE_EXPECTATION_GAP', 'POSITIVE_EXPECTATION_GAP',
  // zzz775: ON TRACK sits between CONFIRMATION REQUIRED and STRENGTHENING.
  'EVIDENCE_INCOMPLETE', 'CONFIRMATION_REQUIRED', 'ON_TRACK', 'STRENGTHENING', 'NEUTRAL',
  // zzz782: no thesis set is its own state, not a thesis-status bucket.
  'THESIS_NOT_SET',
];

export default function PortfolioCatalystsPage() {
  const { symbols, note, rows, loading, evidenceLoading, batch, readFiling, readAll, stop, recent, readRecentReporters, priorBatch, readPriorPeriods, checkAll, checkBatch, thesisTypes, setThesisType, quick, quickReadAll, stopQuick } = useBook();
  const [filter, setFilter] = useState<ThesisStatus | null>(null);
  const [onlyRead, setOnlyRead] = useState(false);
  // ── WHICH POPULATION IS IN VIEW.                                (zzz731)
  //
  // Defaults to everything, because the owner asked for the bench and the
  // book on one page. The book can be isolated in one click, and the counts
  // are always stated separately — a holding and a candidate are different
  // objects and the header never adds them into a single "holdings" figure
  // the way this page used to.
  // zzz827: 'cb' = the whole Conviction Beats list under his criteria (held names included).
  const [source, setSource] = useState<'all' | 'book' | 'bench' | 'cb'>('all');
  // zzz811: the bench is the Conviction Beats list under HIS Conviction Beats
  // criteria. Names failing them are off by default and one chip away.
  const [showFailing, setShowFailing] = useState(false);
  // zzz811: progressive rendering — 300+ bench cards never render at once.
  const [shownN, setShownN] = useState(PC_PAGE_STEP);
  const moreRef = useRef<HTMLDivElement | null>(null);
  // A size filter you can switch on; the count it hides is printed beside it.
  // zzz811: OFF by default, so the bench equals the Conviction Beats page
  // (which opens on all sizes). A HOLDING IS NEVER HIDDEN BY IT.
  const [smallMidOnly, setSmallMidOnly] = useState(false);
  const [showAllTop, setShowAllTop] = useState(false);
  // zzz808: the catalyst board, or "New · last 10 days".
  const [view, setView] = useState<'board' | 'new'>('board');

  const all0 = useMemo(() => Object.values(rows), [rows]);
  // zzz811: bench names failing his Conviction Beats criteria are hidden
  // unless he asks — every count below is over what is in view.
  const failingBench = useMemo(() => all0.filter((r) => r.origin === 'bench' && r.preset?.state === 'fail'), [all0]);
  const all = useMemo(() => (showFailing ? all0 : all0.filter((r) => !(r.origin === 'bench' && r.preset?.state === 'fail'))), [all0, showFailing]);
  // Names passing his criteria that are on this page (book + bench, before
  // the size filter) — must equal the Conviction Beats page's count.
  const cbOnPage = useMemo(() => { const p = new Set(note.cbPassing || []); return all0.filter((r) => p.has(r.symbol)).length; }, [all0, note.cbPassing]);

  // zzz823: the Book check — every source, why each name is here, and the
  // two lists that must be empty (saved-not-shown, shown-not-saved).
  const bookCheck = useMemo(() => (note.resolved && !loading
    ? buildBookCheck({ saved: note.resolved.names, rows: all0 as any, sources: note.resolved.sources, rule: note.resolved.rule, ignored: note.resolved.ignored, bseUnmatched: note.resolved.bseUnmatched })
    : null), [note.resolved, all0, loading]);

  const sized = useMemo(() => all.filter((r) =>
    // Held names bypass the size filter entirely.
    r.origin !== 'bench' || !smallMidOnly || isSmallMidCap(r.graded)), [all, smallMidOnly]);
  const hiddenByCap = all.length - sized.length;

  // zzz811: a held name is shown ONCE, in My book; "Bench" is the names you
  // do not hold, so All = My book + Bench exactly.
  const cbSet = useMemo(() => new Set((note.cbPassing || []).map((t) => heldKey(t))), [note.cbPassing]);
  const inView = (r: { origin: string; symbol: string }) =>
    source === 'all' ? true
      : source === 'book' ? (r.origin === 'book' || r.origin === 'both')
      : source === 'cb' ? cbSet.has(heldKey(r.symbol))
      : r.origin === 'bench';
  const inSource = useMemo(() => sized.filter(inView), [sized, source, cbSet]);
  // zzz827: the Conviction Beats view and its name-for-name reconciliation
  // with the Conviction Beats tab (the tab saves what it lists in this browser).
  const cbRows = useMemo(() => cbViewRows(sized, note.cbPassing || []), [sized, note.cbPassing]);
  const [tabSnap, setTabSnap] = useState<CbTabSnapshot | null>(null);
  useEffect(() => { setTabSnap(readCbTabSnapshot()); }, [note.cbPassing]);
  const cbRecon = useMemo(() => (loading || !note.cb ? null : reconcileCbLists(tabSnap, cbRows.map((r) => r.symbol), (t) => {
    const r = all0.find((x) => heldKey(x.symbol) === heldKey(t));
    return r ? { state: r.preset?.state || (r.origin === 'bench' ? 'unknown' : 'pass'), text: r.preset?.text || '' } : null;
  })), [loading, note.cb, tabSnap, cbRows, all0]);

  // zzz784: one set of header numbers from the same arrays; a row without an
  // assessment is "not yet assessed", never counted into NO MATERIAL CHANGE.
  // zzz790: the research-export rule, from one definition.
  const CONSTRUCTIVE: string[] = [...RESEARCH_EXPORT_STATUSES];
  const uc = useMemo(() => universeCounts(all as any, sized as any, CONSTRUCTIVE), [all, sized]);
  const ucView = useMemo(() => universeCounts(sized as any, inSource as any, CONSTRUCTIVE), [sized, inSource]);
  const counts = ucView.byStatus;

  const list = useMemo(() => {
    let f = inSource;
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
  }, [inSource, filter, onlyRead]);

  // zzz811: the card window resets when the view changes and grows as you
  // scroll (or click "show more") — the page never mounts 300 cards at once.
  useEffect(() => { setShownN(PC_PAGE_STEP); }, [source, filter, onlyRead, smallMidOnly, showFailing]);
  useEffect(() => {
    const el = moreRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((es) => {
      if (es.some((e) => e.isIntersecting)) setShownN((n) => nextWindow(n, list.length));
    }, { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [list.length, shownN]);
  const visible = useMemo(() => list.slice(0, shownN), [list, shownN]);
  // A jump (Special Focus, research priority, New · last 10 days) to a card
  // beyond the window first widens the window, then scrolls.
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const jumpTo = (t: string) => { setFilter(null); setOnlyRead(false); setPendingJump(t); };
  useEffect(() => {
    if (!pendingJump) return;
    const idx = list.findIndex((r) => r.symbol === pendingJump);
    if (idx < 0) {
      if (source !== 'all') { setSource('all'); return; }
      if (smallMidOnly) { setSmallMidOnly(false); return; }
      // zzz816: a bench name failing the criteria is hidden by default.
      if (!showFailing && all0.some((r) => r.symbol === pendingJump)) { setShowFailing(true); return; }
      setPendingJump(null);
      return;
    }
    if (idx >= shownN) { setShownN(idx + PC_PAGE_STEP); return; }
    const t = pendingJump;
    setPendingJump(null);
    setTimeout(() => document.getElementById(`pc-${t}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }, [pendingJump, list, shownN, source, smallMidOnly, showFailing, all0]);

  // zzz780 — persistence test per holding, from its ledger + assessment only.
  const persistBySymbol = useMemo(() => new Map(visible.map((r) => [r.symbol, detectForRow(r as any)] as const)), [visible]);

  // COUNTS COME FROM THE LEDGER, not from a transient counter. A name has
  // evidence when its persisted ledger holds a period — that is what
  // survives a reload. `documents read` sums the documents actually read
  // for the latest period on file. (zzz740)
  // zzz770: every header figure is derived from the PERSISTED ledgers
  // (evidenceCounts) — a summary held only in this tab's state after a failed
  // save is not "evidence read", and a bench name is never counted as held.
  const ec = useMemo(() => evidenceCounts(inSource), [inSource]);
  const readCount = ec.evidence_read;
  const docsRead = ec.documents_read;
  // zzz790: ONE definition of "needs attention" for the header and the button
  // (unread = no persisted period; requires update = newer / stale / failed).
  const attention = evidenceAttention(inSource as any);
  // zzz811: bulk reads cover the book + bench meeting your Conviction Beats criteria by default; the
  // rest of the bench is its own manual button (see readScope).
  const scope = readScope(list);
  const attentionInList = evidenceAttention(scope.primary as any);
  const attentionOther = evidenceAttention(scope.otherBench as any);
  const primarySyms = scope.primary.map((r) => r.symbol);
  const otherSyms = scope.otherBench.map((r) => r.symbol);
  const primaryUnread = attentionInList.unread.length;
  // zzz830: who has no AI read yet (never read / incomplete / rules only) —
  // the bulk AI button reads the names in view, the page line counts the source.
  const aiPlan = useMemo(() => aiReadPlan(list as any), [list]);
  const aiPage = useMemo(() => aiReadPlan(inSource as any), [inSource]);
  const [aiPick, setAiPick] = useState<'all' | 'incomplete' | 'withoutAi' | 'withGaps'>('all');
  const aiSyms = aiPick === 'incomplete' ? aiPlan.incomplete : aiPick === 'withoutAi' ? aiPlan.withoutAi : aiPick === 'withGaps' ? aiPlan.withGaps : aiPlan.all;
  // EVIDENCE INCOMPLETE because a core financial has no grader row — and the
  // stored read predates the headline prompt (india-ai-summary-v9), so a
  // re-read can fill it. A v9 read that still shows ⊘ is a filing that does
  // not print the figure, and is NOT queued again. (zzz763)
  const blockedOnHeadline = inSource.filter((r) => {
    if (r.assessment?.status !== 'EVIDENCE_INCOMPLETE') return false;
    if (!r.assessment.checked.some((c) => c.absence === 'no_grader_row')) return false;
    const period = r.ledger && r.ledger.latest_period ? r.ledger.periods[r.ledger.latest_period] : null;
    const pv = String(period?.prompt_version || '');
    const m = /v(\d+)$/.exec(pv);
    return !m || Number(m[1]) < 9;
  });
  // PRIOR QUARTER (zzz765): names in view whose ledger lacks the period just
  // before its latest AND already lists a document for that quarter. Derived
  // from the ledgers, so a name drops out the moment its backfill lands.
  const needPrior = list.filter((r) => r.market !== 'US' && !!priorBackfillPlan(r.ledger || null));
  const anyRunning = batch.running || priorBatch.running || checkBatch.running;
  const newEvidence = ec.new_evidence;
  const sourceDown = ec.source_unavailable;

  // ── NEW IN THE LAST 10 DAYS. (zzz808) Every dated filing and extracted
  // event already on file for the names on screen (book + bench after the
  // size filter), plus the persistent-catalyst items and — when it has been
  // run — the exchange results feed. Pure merge in lib/catalyst/recent-events.
  // zzz813: every non-routine filing in the window is opened and read (server-side, cached per
  // document, no AI) — the row shows what the document says, not its subject line.
  const today = useMemo(() => localToday(), []);
  const recentRaws = useMemo(() => {
    if (loading || evidenceLoading) return null;
    const raws: RawEvent[] = [];
    const bare = (t: string) => t.toUpperCase().replace(/-(BE|SM|ST|BZ|E1)$/i, '');
    const bySym = new Map<string, { symbol: string; company: string | null; ctx: ThesisCtx }>();
    for (const r of sized) {
      const co = r.graded?.company && String(r.graded.company).toUpperCase() !== r.symbol.toUpperCase() ? String(r.graded.company) : null;
      const set = thesisTypes[r.symbol.toUpperCase()];
      const ctx: ThesisCtx = set ? { pattern: String(set), fit: 'exact', assessment: r.assessment }
        : r.pattern?.pattern ? { pattern: String(r.pattern.pattern), fit: r.pattern.fit === 'nearest' ? 'provisional' : 'exact', assessment: r.assessment }
        : { pattern: null, assessment: r.assessment };
      bySym.set(bare(r.symbol), { symbol: r.symbol, company: co, ctx });
      raws.push(...rawFromLedger(r.symbol, co, r.ledger, r.assessment, ctx));
      raws.push(...rawFromPersistent(r.symbol, co, detectForRow(r as any), r.assessment, ctx));
    }
    const feed = recent.plan ? [...recent.plan.due, ...recent.plan.current] : [];
    raws.push(...rawFromFeed(
      feed.filter((f) => bySym.has(bare(f.ticker))).map((f) => ({ ...f, ticker: bySym.get(bare(f.ticker))!.symbol })),
      (t) => bySym.get(bare(t))?.company || null, (t) => bySym.get(bare(t))?.ctx || null));
    return raws;
  }, [sized, loading, evidenceLoading, recent.plan, thesisTypes]);
  // zzz825: company names the page already holds — graded rows (book + bench) and the Conviction Beats list
  const nameMap = useMemo(() => {
    let cb: Array<{ ticker: string; company: string }> = [];
    try { cb = getConvictionList(); } catch { cb = []; }
    return nameMapOf(all0.map((r) => ({ ticker: r.symbol, company: r.graded?.company || r.graded?.company_name || null })), cb);
  }, [all0]);
  // zzz825 (§34): Material + Notable read first; known-Minor documents only when the owner opens Minor / clicks
  const [wantedReads, setWantedReads] = useState<Set<string>>(() => new Set());
  const addWanted = (urls: string[]) => setWantedReads((prev) => { const n = new Set(prev); for (const u of urls) n.add(normUrl(u)); return n; });
  const readQueue = useMemo(() => (recentRaws ? buildRecentCatalysts(recentRaws, today, { market: 'IN', names: nameMap }).toRead.filter((q) => q.tier !== 'minor' || wantedReads.has(normUrl(q.url))) : []), [recentRaws, today, nameMap, wantedReads]);
  const { reads: filingReads, progress: readProgress } = useFilingReads(readQueue, 'IN', !!recentRaws);
  const recentNew = useMemo(() => (recentRaws ? buildRecentCatalysts(recentRaws, today, { market: 'IN', reads: filingReads, names: nameMap }) : null), [recentRaws, today, filingReads, nameMap]);
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
    if (note.serverError) n.push(`Your book could not be read from the server (${note.serverError}) — only names held in this browser are covered.`);
    const ecs = evidenceCounts(sized);
    if (ecs.source_unavailable > 0) n.push(`${ecs.source_unavailable} name${ecs.source_unavailable === 1 ? '' : 's'}: the filing source could not be reached on the last check, so a new filing may be missing.`);
    if (ecs.retrieval_failed > 0) n.push(`${ecs.retrieval_failed} name${ecs.retrieval_failed === 1 ? '' : 's'}: filings were found but could not be downloaded or read.`);
    const neverRows = sized.filter((r) => !r.ledger);
    const never = neverRows.length;
    const neverBench = neverRows.filter((r) => r.origin === 'bench').length;
    if (never > 0) n.push(`${never} name${never === 1 ? ' has' : 's have'} never been checked for filings (${never - neverBench} in your book, ${neverBench} on the bench), so nothing new can show for ${never === 1 ? 'it' : 'them'} yet — "Check all for new evidence" on the board searches them, a few at a time, with no AI.`);
    if (recent.state === 'error' && recent.error) n.push(recent.error);
    if (recent.feed && recent.feed.days_failed.length > 0) n.push(`Exchange results feed answered nothing for ${recent.feed.days_failed.join(', ')}.`);
    return n;
  }, [sized, note.serverError, recent.state, recent.error, recent.feed]);

  if (!symbols.length && !loading) {
    return (
      <div style={{ padding: 24, color: C.dim, fontSize: 15, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.text, marginBottom: 8 }}>Portfolio Catalysts</h1>
        {note.serverError
          ? <>Your book could not be read — the server answered: <i>{note.serverError}</i>. This is not the same as an
            empty book, and nothing has been assessed. Reload once the connection is back.</>
          : <>Your book is empty and the India Conviction Beats list is empty{note.cb?.error ? <> (the server list could not be read: <i>{note.cb.error}</i>)</> : null}, so there is nothing to watch. Add holdings on the
            Portfolio page and each one will appear here with its thesis, the variables that thesis rests on, and the
            conditions that would end it.</>}
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>Portfolio Catalysts</h1>
        <div style={{ fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 820 }}>
          Every holding carries a <b style={{ color: C.text }}>thesis ledger</b> — the named variables you own it for —
          and each quarter&apos;s evidence is checked against them. Capex is tracked as a chain to whether it actually
          earned, not as an announcement. <b style={{ color: C.text }}>A price move is never an exit reason</b>, and no
          price is read anywhere in this engine. Your <b style={{ color: C.text }}>book</b> is watched in full,
          whatever it grades at; the <b style={{ color: C.text }}>bench</b> is your India Conviction Beats list
          selected by <b style={{ color: C.text }}>your Conviction Beats criteria</b> — the same list the Conviction
          Beats page shows. Names that miss those criteria are one chip away, each labelled with what it misses.
          A bench name is a candidate, not a holding, and every card says which it is.
        </div>
        <div data-testid="ai-sources-explainer" style={{ fontSize: 13.5, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 820 }}>
          <b style={{ color: C.text }}>Is it all from AI? No.</b> {aiSourcesExplainer('IN')}
        </div>
      </div>

      {/* ── THE VIEWS. (zzz808) The catalyst board, or what is new. ─────── */}
      <div className="mc-wrap-mobile" role="tablist" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {([['board', 'Catalyst board'], ['new', newLabel]] as Array<[typeof view, string]>).map(([k, label]) => {
          const on = view === k;
          return (
            <button key={k} role="tab" aria-selected={on} onClick={() => setView(k)} style={{
              fontSize: 14, fontWeight: 900, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${on ? C.cyan : C.border}`, color: on ? C.cyan : C.dim,
              background: on ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : C.bg,
            }}>{label}</button>
          );
        })}
      </div>

      {view === 'new' ? (
        <NewCatalystsTab result={recentNew} loading={loading || evidenceLoading} names={sized.length} sourceNotes={recentNotes} market="IN" progress={readProgress} win={newWin} onWin={setNewWin}
          holdingOf={(t) => { const r = sized.find((x) => x.symbol.toUpperCase() === t.toUpperCase()); return r ? (r.origin === 'bench' ? 'bench' : 'book') : null; }}
          onRead={addWanted} wanted={wantedReads}
          onJump={(t) => { setView('board'); setSource('all'); jumpTo(t); }} />
      ) : (<>
      {/* ── WHICH POPULATION. Two numbers, never merged into one. ───────── */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        {([
          // zzz784: the chips count the same rows the reconciliation line sums
          // (after the size filter), so "All" = book + bench on screen.
          ['all', `All ${uc.shown}`, 'Everything below: your book, plus the India Conviction Beats names you do not hold that pass your Conviction Beats criteria (after the size filter).'],
          ['book', `\uD83D\uDCD7 My book ${uc.book}`, 'Only what you own. Nothing is filtered out of this list — a holding is watched whatever it grades at.'],
          ['cb', `\uD83C\uDFC6 Conviction Beats ${cbRows.length}`, 'Every name on your India Conviction Beats list that meets your Conviction Beats criteria — the same list as the Conviction Beats tab, name for name. Names you hold are included and tagged "📗 also in My book".'],
          ['bench', `Bench ${uc.bench}`, 'India Conviction Beats names you do not hold, selected by your Conviction Beats criteria. You do not own these.'],
        ] as Array<[typeof source, string, string]>).map(([k, label, hint]) => {
          const on = source === k;
          return (
            <button key={k} title={hint} onClick={() => setSource(k)} style={{
              fontSize: 13.5, fontWeight: 800, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${on ? C.cyan : C.border}`, color: on ? C.cyan : C.dim,
              background: on ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : C.bg,
            }}>{label}</button>
          );
        })}
        <button onClick={() => setSmallMidOnly((v) => !v)}
          title={`Bench candidates above \u20B9${SMALL_MID_CAP_MAX_CR.toLocaleString('en-IN')} Cr are hidden. Holdings are never hidden by this.`}
          style={{
            fontSize: 13.5, fontWeight: 800, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${smallMidOnly ? C.cyan : C.border}`, color: smallMidOnly ? C.cyan : C.dim,
            background: smallMidOnly ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : C.bg,
          }}>
          {smallMidOnly ? 'Small / mid only' : 'All sizes'}
          {smallMidOnly && hiddenByCap > 0 && (
            <span style={{ color: C.faint, fontWeight: 700 }}> · {hiddenByCap} large caps hidden</span>
          )}
        </button>

        {(failingBench.length > 0 || showFailing) && (
          <button data-testid="show-failing-chip" onClick={() => setShowFailing((v) => !v)}
            title="Conviction Beats names you do not hold that miss your Conviction Beats criteria. Off by default; each card says which criteria it misses."
            style={{
              fontSize: 13.5, fontWeight: 800, padding: '5px 12px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${showFailing ? C.amber : C.border}`, color: showFailing ? C.amber : C.dim,
              background: showFailing ? 'color-mix(in srgb, var(--mc-verdict-warn) 14%, transparent)' : C.bg,
            }}>{showFailing ? '\u2713 ' : ''}Also show names failing your criteria ({failingBench.length})</button>
        )}
      </div>
      {!loading && (
        <div data-testid="cb-bench-line" style={{ fontSize: 13, color: note.cb && cbOnPage !== note.cb.passing ? C.amber : C.dim, lineHeight: 1.5 }}>
          <b style={{ color: note.cb && cbOnPage !== note.cb.passing ? C.amber : C.text }}>{cbCriteriaLine(note.cb, cbOnPage, showFailing)}</b>
        </div>
      )}

      {!loading && cbRecon && (
        <div data-testid="cb-reconciliation" style={{ fontSize: 13, color: cbRecon.onlyTab.length || cbRecon.onlyPc.length ? C.amber : C.dim, lineHeight: 1.5 }}>
          <b style={{ color: C.text }}>{cbViewLine(cbRows)}</b> · {cbRecon.line}
        </div>
      )}

      {!loading && <BookCheckPanel check={bookCheck} market="IN" />}

      {/* ── THE ARITHMETIC, VISIBLY. (zzz784) Every figure from the same rows. */}
      {!evidenceLoading && !loading && (
        <div data-testid="universe-reconciliation" style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}
          title="total − large caps hidden = shown = book + bench; status buckets + not yet assessed = shown; exportable + excluded = evaluated">
          <b style={{ color: C.text }}>{uc.line}</b>
          {' '}· status buckets {ORDER.filter((s) => uc.byStatus[s]).map((s) => uc.byStatus[s]).join(' + ') || 0}{uc.notAssessed ? ` + ${uc.notAssessed} not yet assessed` : ''} = {uc.statusSum + uc.notAssessed} shown
          {source !== 'all' && <span style={{ color: C.faint }}> · view {source === 'book' ? 'my book' : source === 'cb' ? 'Conviction Beats' : 'bench'}: {ucView.shown} shown, buckets {ucView.statusSum}{ucView.notAssessed ? ` + ${ucView.notAssessed} not yet assessed` : ''}</span>}
        </div>
      )}
      {/* Until the stored evidence is in, every card reads "incomplete" and
          the counters are wrong — say so instead of showing them. (zzz768) */}
      {evidenceLoading && !loading && (
        <div role="status" style={{ fontSize: 13.5, fontWeight: 700, color: C.cyan, padding: '8px 12px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
          Loading stored evidence for {inSource.length} companies… statuses, counts and the TradingView list appear when it is in (no AI is used).
        </div>
      )}
      {/* ── THE FIVE SIGNALS. Not fifty scores. ─────────────────────────── */}
      <div className="mc-grid-2-mobile" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', opacity: evidenceLoading ? 0.35 : 1, pointerEvents: evidenceLoading ? 'none' : undefined }}>
        {ORDER.map((s) => {
          const m = STATUS_META[s];
          const on = filter === s;
          return (
            <button key={s} data-testid={`pc-status-${s}`}
              onClick={() => { setFilter(on ? null : s); if (!on && typeof window !== 'undefined') setTimeout(() => document.getElementById('pc-cards-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }}
              title={`${m.meaning}${(counts[s] || 0) === 0 ? ' — none in this view' : ''}`}
              style={{
                display: 'flex', alignItems: 'baseline', gap: 7, padding: '6px 12px', borderRadius: 8,
                cursor: 'pointer', border: `${on ? 2 : 1}px solid ${on ? m.color : C.border}`,
                background: on ? `${m.color}30` : C.bg,
                opacity: !on && !evidenceLoading && (counts[s] || 0) === 0 ? 0.55 : 1,
              }}>
              <span style={{ fontSize: 19, fontWeight: 900, color: `color-mix(in srgb, ${m.color} 65%, var(--tc-text, #F1F5F9))` }}>{evidenceLoading ? '…' : (counts[s] || 0)}</span>
              <span style={{ fontSize: 12.5, fontWeight: 800, color: on ? `color-mix(in srgb, ${m.color} 65%, var(--tc-text, #F1F5F9))` : C.dim }}>{m.dot} {m.label}</span>
            </button>
          );
        })}
      </div>

      {/* ── ONE CLICK TO TRADINGVIEW. (zzz765) The three constructive
          statuses combined — strengthening, confirmation required, running
          ahead of plan — as NSE:TICKER, same toolbar as Conviction Beats.
          Exchange suffixes (-BE, -SM) are dropped: TradingView lists the
          base symbol. */}
      {(() => {
        const KEEP: Array<[string, string, string]> = [
          ['STRENGTHENING', 'Strengthening', '🟢'],
          ['ON_TRACK', 'Thesis intact — on track', '🔵'],
          ['CONFIRMATION_REQUIRED', 'Confirmation required', '🟡'],
          ['POSITIVE_EXPECTATION_GAP', 'Running ahead of plan', '🟣'],
        ];
        const tv = (sym: string) => sym.toUpperCase().replace(/-(BE|SM|ST|BZ|E1)$/i, '');
        const inIndia = inSource.filter((r) => r.market !== 'US');
        const groups = KEEP.map(([k, label, emoji]) => ({
          label, emoji,
          tickers: Array.from(new Set(inIndia.filter((r) => r.assessment?.status === k).map((r) => tv(r.symbol)))),
        })).filter((g) => g.tickers.length);
        const all = Array.from(new Set(groups.flatMap((g) => g.tickers)));
        if (evidenceLoading) return null;
        const usLeft = inSource.filter((r) => r.market === 'US' && KEEP.some(([k]) => r.assessment?.status === k)).length;
        if (!all.length) return null;
        // zzz790: the export reconciled with the analysed count, in facts.
        const xc = exportCounts(inSource as any, (s) => STATUS_META[s as ThesisStatus]?.label || s);
        return (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', background: C.bg }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: C.text, marginBottom: 6 }}>
              📋 Copy to TradingView · India (NSE) — {all.length} names: {groups.map((g) => `${g.emoji} ${g.label} ${g.tickers.length}`).join(' · ')}
              {usLeft > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: C.faint }}> · {usLeft} US name{usLeft === 1 ? '' : 's'} in these statuses not included (NSE list)</span>}
            </div>
            <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 6 }}>
              {xc.line}.
            </div>
            <TickerExportToolbar tickers={all} groups={groups} exchange="NSE" filenameHint="portfolio-catalysts-constructive" compact />
          </div>
        );
      })()}

      {/* ── 🔥 SPECIAL FOCUS. (zzz780) A cross-cutting research layer: a
          persistent MECHANISM with filed evidence and runway. Separate from the
          thesis status and from Research Priority below — never merged. */}
      <SpecialFocusPanel rows={inSource as any} lookup={all0 as any} ready={!evidenceLoading && !loading}
        onReadPrior={(t: string[]) => readPriorPeriods(t)} priorRunning={!!priorBatch?.running}
        thesisLabel={(r: any) => {
          const set = thesisTypes[String(r.symbol).toUpperCase()];
          if (set) return `${set} (set by you)`;
          if (r.pattern?.pattern) return r.pattern.fit === 'nearest' ? `nearest ${r.pattern.pattern} (auto, provisional${(r.pattern as any).weak ? ', weak fit' : ''})` : `${r.pattern.pattern} (auto${(r.pattern as any).promoted ? ', type confirmed from filings' : ''})`;
          return 'Not set';
        }}
        onJump={(t: string) => jumpTo(t)} />

      {/* ── TOP CATALYSTS. (zzz776) The intact theses ranked by how strong the
          EVIDENCED catalyst is — output growth plus the mechanism drivers the
          documents show (order book, capacity, volume, capex earning,
          customers, approvals). A research order, not a buy list: no price
          is in it and none ever will be. */}
      {!evidenceLoading && (() => {
        const ranked = inSource
          .filter((r) => r.assessment?.catalystRank && researchPriorityEligible(r.assessment.status))
          .sort((a, b) => (b.assessment!.catalystRank!.score - a.assessment!.catalystRank!.score)
            || ((b.assessment!.catalystRank!.drivers.length) - (a.assessment!.catalystRank!.drivers.length)));
        if (!ranked.length) return null;
        const shown = showAllTop ? ranked : ranked.slice(0, 15);
        const tv = (sym: string) => sym.toUpperCase().replace(/-(BE|SM|ST|BZ|E1)$/i, '');
        const top = ranked.slice(0, 15).filter((r) => r.market !== 'US').map((r) => tv(r.symbol));
        const GC: Record<string, string> = { Demand: C.green, Capacity: C.cyan, Volume: C.cyan, 'Capex earning': C.cyan, 'Capex commissioned': C.dim, Customers: C.amber, Approvals: C.amber, 'Margin mechanism': C.dim, 'Balance sheet': C.dim };
        const fmt = (n: number | null, unit: string) => n == null ? '—' : `+${n}${unit}`;
        return (
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.bg }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
              <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>🏁 {researchPriorityTitle(ranked.length)}</span>
              <span style={{ fontSize: 12.5, color: C.faint }}>{'Only 🟢 strengthening / 🔵 on-track theses are eligible (weakening and confirmation-required have their own queues above). Ordered by how firmly the filings evidence the catalyst — order book > capacity added / capex earning / volume > named contract > commissioned capex > customer remark; a hard figure outranks a management remark — then by the filed results. Evidence strength, not economic value; each row says why in plain words. Which theses deserve research next — not a buy list, no price used.'}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: C.faint, textAlign: 'left', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    <th style={{ padding: '4px 6px' }}>#</th><th style={{ padding: '4px 6px' }}>Name</th><th style={{ padding: '4px 6px' }}>Status</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Rev</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>Earn</th><th style={{ padding: '4px 6px', textAlign: 'right' }}>Margin</th>
                    <th style={{ padding: '4px 6px' }}>Why (from the filings)</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => {
                    const cr = r.assessment!.catalystRank!;
                    const st = r.assessment!.status === 'STRENGTHENING';
                    return (
                      <tr key={r.symbol} style={{ borderTop: `1px solid ${C.border}`, verticalAlign: 'top' }}>
                        <td style={{ padding: '5px 6px', color: C.faint, fontWeight: 800 }}>{i + 1}</td>
                        <td style={{ padding: '5px 6px', fontWeight: 900, whiteSpace: 'nowrap' }}>
                          <a href={`#pc-${r.symbol}`} onClick={(e) => { e.preventDefault(); jumpTo(r.symbol); }}
                            style={{ color: C.text, textDecoration: 'none' }}>{r.symbol}</a>
                          {r.origin === 'bench' && <span style={{ fontSize: 11, color: C.faint, fontWeight: 700 }}> · bench</span>}
                        </td>
                        <td style={{ padding: '5px 6px', whiteSpace: 'nowrap', color: st ? C.green : C.cyan, fontWeight: 800, fontSize: 12 }}>{st ? '🟢 Strengthening' : '🔵 On track'}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(cr.output.revenue, '%')}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>{fmt(cr.output.earnings, '%')}</td>
                        <td style={{ padding: '5px 6px', textAlign: 'right' }}>{cr.output.marginPp != null && cr.output.marginPp > 0 ? fmt(cr.output.marginPp, 'pp') : '—'}</td>
                        <td style={{ padding: '5px 6px' }}>
                          {/* zzz802: a plain "Why" line — never a visible score. */}
                          <div style={{ color: C.dim, lineHeight: 1.35, marginBottom: cr.drivers.length > 2 ? 2 : 0 }}>{researchWhyLine(cr)}</div>
                          {cr.drivers.slice(2, 3).map((d) => (
                            <div key={d.group} style={{ lineHeight: 1.35 }} title={d.text}>
                              <span style={{ fontSize: 11, fontWeight: 800, color: GC[d.group] || C.dim, marginRight: 5 }}>{d.group.toUpperCase()}{d.quantified ? ' · hard figure' : ' · management remark'}</span>
                              <span style={{ color: C.dim }}>{d.text.length > 110 ? `${d.text.slice(0, 109)}…` : d.text}</span>
                            </div>
                          ))}
                          {cr.drivers.length > 3 && <div style={{ fontSize: 11.5, color: C.faint }}>+{cr.drivers.length - 3} more on the card</div>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              {ranked.length > 15 && (
                <button onClick={() => setShowAllTop((v) => !v)} style={{ fontSize: 12.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.dim }}>
                  {showAllTop ? 'Show top 15' : `Show all ${ranked.length}`}
                </button>
              )}
              {top.length > 0 && <TickerExportToolbar tickers={top} exchange="NSE" filenameHint="portfolio-top-catalysts" compact />}
            </div>
          </div>
        );
      })()}

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, color: C.faint }}>
          {list.length} of {inSource.length} shown · {ec.held} held · {ec.bench} bench ·{' '}
          {evidenceLoading ? <b style={{ color: C.text }}>loading stored evidence…</b> : <><b style={{ color: C.text }}>{readCount} of {inSource.length} companies have evidence read</b>{ec.quick_read > 0 ? <> ({ec.quick_read} read without AI — an AI read is one click on the card or the ✨ Read with AI button)</> : null} · {attention.line} · {docsRead} documents read</>}
          {!evidenceLoading && ec.incomplete > 0 && <> · {ec.incomplete} evidence incomplete</>}
          {newEvidence > 0 && <> · <b style={{ color: C.amber }}>{newEvidence} with new evidence available</b></>}
          {!evidenceLoading && ec.stale > 0 && <> · {ec.stale} stale</>}
          {sourceDown > 0 && <> · {sourceDown} source unavailable</>}
          {!evidenceLoading && ec.retrieval_failed > 0 && <> · {ec.retrieval_failed} retrieval failed</>}
        </span>
        <button onClick={() => setOnlyRead((v) => !v)} style={{
          fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
          border: `1px solid ${onlyRead ? C.cyan : C.border}`, color: onlyRead ? C.cyan : C.dim,
          background: onlyRead ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : C.bg,
        }}>{onlyRead ? 'Only names with evidence read' : 'Show all'}</button>

        {evidenceLoading ? null : !batch.running ? (
          <>
          <button onClick={() => readAll(primarySyms)} disabled={!attentionInList.total}
            title="Your book plus the bench names meeting your Conviction Beats criteria. Reads and PERSISTS the evidence behind each name that needs it — never read, failed, or with newer documents at a source. Names whose evidence is current are skipped without a model call. Three at a time; resumable after a reload."
            style={{
              fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
            }}>{attentionInList.total ? `\u2728 Read evidence for ${attentionInList.total} that need it (${attentionInList.unread.length} unread, ${attentionInList.update.length} update · uses AI) — book + bench meeting your criteria` : 'Evidence up to date (latest filings on file)'}</button>
          {attentionOther.total > 0 && (
            <button data-testid="read-other-bench" onClick={() => readAll(otherSyms)}
              title="Bench names that miss your Conviction Beats criteria (shown with the chip). Manual only — never started automatically. Three at a time; Stop works."
              style={{
                fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${C.border}`, background: 'transparent', color: C.dim,
              }}>{otherBenchLabel(attentionOther.total)}</button>
          )}
          </>
        ) : (
          <>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.cyan }}>Reading {batch.done} of {batch.total}…</span>
            <button onClick={stop} style={{
              fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
            }}>Stop</button>
          </>
        )}
        {/* ── ✨ READ WITH AI — THE NAMES WITH NO AI READ. Click only. (zzz830)
            Always here while any name in view is never read, incomplete, or
            read only by rules (no AI). One model call per name, three at a
            time, Stop works; nothing starts on its own. */}
        {!evidenceLoading && !batch.running && aiPlan.total > 0 && (
          <span data-testid="ai-read-bulk" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <button data-testid="ai-read-bulk-go" onClick={() => readAll(aiSyms, 3, { exact: true, modeOf: aiPlan.modeOf })}
              disabled={!aiSyms.length || priorBatch.running || checkBatch.running}
              title={`${aiPlan.breakdown}. Reads each name's latest documents with AI and saves the facts; a name read by rules (no AI) keeps those facts in history. An incomplete name already read by AI is read again. Three at a time; Stop works. Never started automatically.`}
              style={{
                fontSize: 13.5, fontWeight: 800, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${C.cyan}`, background: 'color-mix(in srgb, var(--mc-cyan) 10%, transparent)', color: C.cyan,
              }}>{aiPick === 'all' ? aiPlan.label : `\u2728 Read with AI — ${aiSyms.length} name${aiSyms.length === 1 ? '' : 's'} (uses AI · ${aiSyms.length} call${aiSyms.length === 1 ? '' : 's'}, only on click)`}</button>
            <select aria-label="Which names to read with AI" value={aiPick} onChange={(e) => setAiPick(e.target.value as any)}
              style={{ fontSize: 12.5, fontWeight: 700, padding: '2px 4px', borderRadius: 6, background: 'transparent', color: C.dim, border: `1px solid ${C.border}`, cursor: 'pointer' }}>
              <option value="all">everything that needs it ({aiPlan.total})</option>
              <option value="incomplete">{aiPlan.incompleteLabel}</option>
              <option value="withoutAi">{aiPlan.withoutAiLabel}</option>
              <option value="withGaps">{aiPlan.withGapsLabel}</option>
            </select>
            <span style={{ fontSize: 12.5, color: C.faint }}>{aiPlan.breakdown}</span>
          </span>
        )}
        {/* ── RECENT REPORTERS. Click only. (zzz763)
            Re-reads the names that filed results in the last 10 days and
            have not been read since that filing. Everything else is skipped
            without a call — and the strip below says so, name by name. */}
        {!batch.running && !evidenceLoading && recent.state !== 'checking' && (
          <button onClick={() => readRecentReporters(10)}
            title="Asks the exchange feed which holdings filed results in the last 10 days, then re-reads ONLY those not yet read since their filing. A name whose evidence already post-dates its results is skipped without a model call. US names are not covered by the NSE feed and are skipped."
            style={{
              fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
            }}>&#8635; Update recent reporters (10d)</button>
        )}
        {/* ── CHECK ALL FOR NEW EVIDENCE. Discovery only, no AI. (zzz770)
            Searches each name's sources and files unread documents on its
            own ledger, so only the companies with a new filing turn NEW
            EVIDENCE AVAILABLE. Nothing is read and no model is called. */}
        {!anyRunning && !evidenceLoading && (
          <button onClick={() => checkAll(list.map((r) => r.symbol))}
            title="Searches the sources of every India name in view for documents not yet on file. Discovery only — no AI, nothing is read. Names with a new filing are marked NEW EVIDENCE AVAILABLE; Read evidence then reads only those."
            style={{
              fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.border}`, background: 'transparent', color: C.dim,
            }}>&#8635; Check all for new evidence (no AI)</button>
        )}
        {checkBatch.running && (
          <>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: C.cyan }}>Checking sources {checkBatch.done} of {checkBatch.total}… {checkBatch.found} with new evidence</span>
            <button onClick={stop} style={{
              fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
            }}>Stop</button>
          </>
        )}
        {!checkBatch.running && checkBatch.total > 0 && (
          <span style={{ fontSize: 13, color: C.faint }}>Last check: {checkBatch.done} of {checkBatch.total} searched · {checkBatch.found} with new evidence (no AI used)</span>
        )}
        {/* ── THE 18 THAT NEED A v9 READ. (zzz763)
            A holding with no grader row can only get revenue / profit / cash
            from a results filing read under the headline prompt (v9). Names
            read before that stay EVIDENCE INCOMPLETE until re-read. This is
            the one button that spends: one model call per name, on click. */}
        {!batch.running && !evidenceLoading && blockedOnHeadline.length > 0 && (
          <button onClick={() => readAll(blockedOnHeadline.map((r) => r.symbol), 3, { reprocess: true, exact: true })}
            title="These names have no graded row and were read before the reader asked the filing for its headline figures. Re-reads each one once (force) so revenue growth, earnings growth and cash conversion can be filled from the results page. One model call per name."
            style={{
              fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
            }}>&#8635; Re-read {blockedOnHeadline.length} blocked on missing headline</button>
        )}
        {recent.state === 'checking' && (
          <span style={{ fontSize: 13.5, fontWeight: 700, color: C.amber }}>Checking who reported in the last 10 days…</span>
        )}
        {/* ── PRIOR QUARTER. Click only. (zzz765)
            Each ledger holds one quarter; the one before is already listed
            among its documents, unread. Reading it gives every variable a
            before, so the card can say "72% → 80% · +8pp". */}
        {!anyRunning && !evidenceLoading && needPrior.length > 0 && (
          <>
            <button onClick={() => readPriorPeriods(needPrior.map((r) => r.symbol))}
              title="For each name whose ledger has only its latest quarter, reads the quarter before it (concall transcript first, then investor presentation, then results) and stores it as its own period. The latest quarter is never changed. Three at a time; you can stop and resume."
              style={{
                fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
              }}>&#8635; Read prior quarter for {needPrior.length} (enables before &rarr; after)</button>
            <span style={{ fontSize: 12.5, color: C.dim }}>
              uses AI · {needPrior.length} call{needPrior.length === 1 ? '' : 's'}, only on click
            </span>
          </>
        )}
        {priorBatch.running && (
          <>
            <span style={{ fontSize: 13.5, fontWeight: 800, color: C.cyan }}>Reading prior quarter {priorBatch.done} of {priorBatch.total}…</span>
            <button onClick={stop} style={{
              fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber,
            }}>Stop</button>
          </>
        )}
        <a href="/exit-radar" style={{
          marginLeft: 'auto', fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999,
          border: `1px solid ${C.border}`, color: C.dim, textDecoration: 'none',
        }}>Exit Radar →</a>
      </div>

      {!evidenceLoading && !loading && (
        <div data-testid="ai-page-line" style={{ fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
          <b style={{ color: C.text }}>{aiPage.pageLine}</b> Figures are filed numbers (Screener / exchange results — no AI); each card says whether its evidence was read by rules or by AI.
        </div>
      )}

      {recent.state !== 'idle' && recent.state !== 'checking' && (
        <RecentReportersStrip recent={recent} />
      )}

      {!loading && !anyRunning && (priorBatch.resumable || 0) > 0 && needPrior.length > 0 && (
        <div style={{ fontSize: 15, color: C.text, background: C.bg, border: `1px solid ${C.cyan}`, borderRadius: 8, padding: '9px 13px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b>Last prior-quarter read: {priorBatch.done} processed · {priorBatch.resumable} remaining{priorBatch.failed ? ` · ${priorBatch.failed} failed` : ''}</b>
          <span>— what was read is persisted. Resume reads only the {needPrior.length} still without a prior quarter (one model call each).</span>
          <button onClick={() => readPriorPeriods(needPrior.map((r) => r.symbol))} style={{
            fontSize: 15, fontWeight: 800, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${C.cyan}`, background: 'transparent', color: C.text,
          }}>Resume</button>
        </div>
      )}

      {/* ── QUICK READ (NO AI). (zzz816) Started automatically on load for
          the names with no evidence for the latest quarter — book first,
          then the bench passing your criteria, then the rest. */}
      {quick.total > 0 && (
        <div data-testid="quick-read-progress" style={{ fontSize: 13.5, color: C.dim, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', border: `1px dashed ${C.cyan}`, borderRadius: 8, padding: '6px 12px', background: C.bg }}>
          <b style={{ color: quick.running ? C.cyan : C.text }}>{quickProgressLine(quick)}</b>
          {quick.running && quick.current.length > 0 && <span style={{ color: C.faint }}>now: {quick.current.join(' · ')}</span>}
          <span style={{ color: C.faint }}>Deterministic extractors on the latest concall transcript, investor presentation and results filing — no model, no cost. The AI read stays on each card&apos;s button.</span>
          {quick.running
            ? <button onClick={stopQuick} style={{ fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber }}>Stop</button>
            : <button onClick={() => void quickReadAll()} title="Runs the quick read (no AI) again for names still without evidence for the latest quarter. A name tried in the last six hours is not tried again." style={{ fontSize: 13, fontWeight: 700, padding: '3px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.dim }}>&#8635; Quick-read again (no AI)</button>}
        </div>
      )}

      {batch.running && (
        <div style={{ height: 3, background: C.border, borderRadius: 2, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: C.cyan, borderRadius: 2, transition: 'width .3s ease',
            width: `${batch.total ? Math.round((batch.done / batch.total) * 100) : 0}%` }} />
        </div>
      )}

      {loading && <div style={{ fontSize: 14, color: C.dim }}>Reading your book…</div>}

      {/* A batch that stopped — tab closed, reload, error — is reported from
          the ledgers, not from memory: what was persisted is what counts. */}
      {!loading && !batch.running && (batch.resumable || 0) > 0 && (
        <div style={{ fontSize: 14, color: C.dim, background: C.bg, border: `1px solid ${C.cyan}`, borderRadius: 8, padding: '9px 13px', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <b style={{ color: C.text }}>Last batch: {batch.done} updated · {batch.resumable} remaining{batch.failed ? ` · ${batch.failed} failed` : ''}</b>
          <span>— persisted; nothing here was lost on reload.</span>
          <button onClick={() => readAll(primarySyms)} title="Resumes over your book + the bench names meeting your criteria." style={{
            fontSize: 13.5, fontWeight: 800, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
          }}>Resume</button>
        </div>
      )}

      {/* ── THE COVERAGE BANNER. It is the primary action on this page
          whenever the book is under-read, because a thesis engine judging a
          book it has not read is the failure this page was rebuilt to fix.
          (zzz717) */}
      {!loading && !evidenceLoading && readCount < inSource.length && (
        <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.6, background: C.bg,
          border: `1px solid ${C.amber}`, borderRadius: 8, padding: '10px 13px' }}>
          <b style={{ color: C.text }}>
            {inSource.length - readCount} of {inSource.length} names have no persisted evidence.
          </b>{' '}
          Revenue, earnings, margin and cash come from the graders and are already on the cards.{' '}
          <b style={{ color: C.text }}>Utilisation, capacity, capex, order book and guidance do not</b> — they live in
          the filings, and for most theses here they are the <i>core</i> variables. Until they are read, those holdings
          sit at <b style={{ color: C.text }}>EVIDENCE INCOMPLETE</b>: no positive verdict is claimed on evidence that
          has not been looked at. A deterioration already visible in the figures would still be flagged.
          {!batch.running && (
            <div style={{ marginTop: 7 }}>
              {primaryUnread > 0 && <button onClick={() => readAll(primarySyms)} style={{
                fontSize: 14, fontWeight: 800, padding: '5px 13px', borderRadius: 999, cursor: 'pointer',
                border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
              }}>&#10024; Read the {primaryUnread} remaining (book + bench meeting your criteria)</button>}
              {attentionOther.unread.length > 0 && <button onClick={() => readAll(otherSyms)} style={{
                fontSize: 14, fontWeight: 700, padding: '5px 13px', borderRadius: 999, cursor: 'pointer', marginLeft: 8,
                border: `1px solid ${C.border}`, background: 'transparent', color: C.dim,
              }}>{otherBenchLabel(attentionOther.unread.length)}</button>}
              <span style={{ fontSize: 13, color: C.faint, marginLeft: 9 }}>
                Three at a time. Each is one model call against one filing, and you can stop it at any point. Nothing starts without a click.
              </span>
            </div>
          )}
        </div>
      )}

      {(() => {
        // zzz774: a holding with no thesis type has no variable that can move
        // its status — it can only ever read CONFIRMATION REQUIRED.
        // zzz775: only a truly null type counts as "no thesis type"; a nearest
        // fit (auto) is counted separately, as a type the owner may confirm.
        const untyped = list.filter((r) => !r.pattern);
        const nearest = list.filter((r) => r.pattern?.fit === 'nearest' && !thesisTypes[r.symbol.toUpperCase()]);
        return untyped.length > 0 || nearest.length > 0 ? (
          <div style={{ fontSize: 13, color: C.dim, border: `1px dashed ${C.border}`, borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
            {untyped.length > 0 && <>
              <b style={{ color: '#A78BFA' }}>◇ Thesis setup required — {untyped.length} holding{untyped.length === 1 ? '' : 's'}.</b> There are no figures on file for {untyped.length === 1 ? 'this company' : 'these companies'} yet (no results row, no screener figures, no filing read), so no thesis type can be worked out. They sit in their own <b>THESIS NOT SET</b> state — not intact, not weakening, not a thesis status at all. Set why you hold each one with the <b>thesis</b> picker on its card (A operating inflection · B demand explosion · F profit jump · G silent quality); it is saved and applies from then on.
              <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>{untyped.map((r) => r.symbol).join(' · ')}</div>
            </>}
            {nearest.length > 0 && (
              <div style={{ marginTop: untyped.length ? 6 : 0 }}>
                <b style={{ color: C.cyan }}>{nearest.length} holding{nearest.length === 1 ? ' is' : 's are'} on a nearest-fit type (auto, PROVISIONAL)</b> — no exact test fired, so the type was worked out from the company&apos;s own figures{nearest.some((r) => (r.pattern as any)?.weak) ? <> ({nearest.filter((r) => (r.pattern as any)?.weak).length} of them a <b>weak fit</b>, where the figures did not point clearly at one type and the business description decided)</> : null}. Their status is provisional: at most CONFIRMATION REQUIRED — it cannot read strengthening or on-track until you confirm the type (or set another) with the <b>thesis</b> picker, or until the company&apos;s filings confirm it: a nearest fit is promoted to a confirmed auto type when at least two of that type&apos;s checks are confirmed from filed figures (one of them its core mechanism — for A, utilisation or a filed alternate such as volume growth or capacity added), covering at least 40% of its checks, with nothing in the mechanism contradicted. A weak fit is never promoted.
                <div style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>{nearest.map((r) => `${r.symbol} (nearest ${r.pattern!.pattern}${(r.pattern as any)?.weak ? ', weak fit' : ''})`).join(' · ')}</div>
              </div>
            )}
          </div>
        ) : null;
      })()}
      <div id="pc-cards-top" data-testid="pc-cards-top" style={{ scrollMarginTop: 70 }} />
      {filter && !loading && (
        <div data-testid="pc-filter-bar" style={{ fontSize: 14, fontWeight: 800, color: C.text, border: `1px solid ${STATUS_META[filter].color}`, borderRadius: 8, padding: '8px 12px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>Showing only {STATUS_META[filter].dot} {STATUS_META[filter].label}: {list.length} card{list.length === 1 ? '' : 's'} in this view</span>
          {list.length === 0 && <span style={{ color: C.dim, fontWeight: 700 }}>None in “{source === 'all' ? 'All' : source}”. {source !== 'all' ? 'Try All.' : 'No name has this status.'}</span>}
          <button onClick={() => setFilter(null)} style={{ fontSize: 13, fontWeight: 800, padding: '4px 10px', borderRadius: 999, cursor: 'pointer', border: `1px solid ${C.border}`, color: C.dim, background: C.bg }}>✕ Clear filter</button>
        </div>
      )}
      {visible.map((r) => (
        <div key={r.symbol} id={`pc-${r.symbol}`} style={{ scrollMarginTop: 70 }}>
        {source === 'cb' && cbViewTag(r.origin) && (
          <div data-testid="cb-also-held" style={{ fontSize: 12.5, color: C.faint, padding: '2px 4px', lineHeight: 1.5 }}>
            <b style={{ color: C.text }}>{r.symbol}</b> · 🏆 on your Conviction Beats list · <b style={{ color: C.green }}>{cbViewTag(r.origin)}</b>
            {r.preset?.state === 'unknown' ? <> · ◌ {r.preset.text}</> : null}
          </div>
        )}
        {r.origin === 'bench' && (
          <div data-testid="bench-preset-label" style={{ fontSize: 12.5, color: C.faint, padding: '2px 4px', lineHeight: 1.5 }}>
            <b style={{ color: C.text }}>{r.symbol}</b> · 🏆 bench · from {r.benchSource || 'Conviction Beats (India)'} · not held
            {' · '}
            <span style={{ fontWeight: 800, color: r.preset?.state === 'pass' ? C.green : r.preset?.state === 'fail' ? C.amber : C.dim }}>
              {r.preset?.state === 'pass' ? '✅ ' : r.preset?.state === 'fail' ? '✖ ' : '◌ '}{r.preset?.text || 'Conviction Beats criteria not checked yet'}
            </span>
            {r.pattern?.fit === 'nearest' && !thesisTypes[r.symbol.toUpperCase()] ? <> · thesis type is provisional (nearest fit)</> : null}
          </div>
        )}
        {!evidenceLoading && <PersistentStrip ticker={r.symbol} pcs={persistBySymbol.get(r.symbol) || []} onOpenFocus={() => document.getElementById('special-focus')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />}
        <ThesisCard
          thesisType={(thesisTypes[r.symbol.toUpperCase()] as any) || null}
          onThesisType={(t) => setThesisType(r.symbol, t)}
          symbol={r.symbol} market={r.market} tier={r.tier} pattern={r.pattern}
          radarScore={r.radarScore} assessment={r.assessment} capex={r.capex}
          origin={r.origin}
          documentsRead={r.documentsRead}
          discoveryAttempts={r.discoveryAttempts}
          discoveryState={r.discoveryState}
          documentOutcomes={r.documentOutcomes}
          needsRead={!r.summary && r.state !== 'loading'}
          reading={r.state === 'loading'}
          onRead={() => readFiling(r.symbol, aiReadStatus(r as any).mode === 'force' ? 'force' : r.summary ? 'incremental' : 'read')}
          onCheck={() => readFiling(r.symbol, 'check')}
          onReread={() => readFiling(r.symbol, 'force')}
          aiRead={evidenceLoading ? null : aiReadStatus(r as any)}
          error={r.error}
          ledger={r.ledger}
          freshness={r.freshness}
          reportingPeriod={r.reportingPeriod}
          changed={r.changed}
          changedFrom={r.changedFrom}
          persisted={r.persisted}
          readNote={r.readNote}
          promiseNote={r.state === 'done' ? r.promiseNote : null}
          dataSource={r.dataSource}
          dataPeriod={r.graded?.period || null}
          sources={r.sourceUrl ? [{ label: 'Source filing', url: r.sourceUrl }] : []}
        />
        </div>
      ))}
      {list.length > visible.length && (
        <div ref={moreRef} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 2px' }}>
          <span style={{ fontSize: 13.5, color: C.faint }}>Showing {visible.length} of {list.length} cards — more load as you scroll.</span>
          <button onClick={() => setShownN((n) => nextWindow(n, list.length))} style={{
            fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan,
          }}>Show {Math.min(PC_PAGE_STEP, list.length - visible.length)} more</button>
          <button onClick={() => setShownN(list.length)} style={{
            fontSize: 13.5, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${C.border}`, background: 'transparent', color: C.dim,
          }}>Show all {list.length}</button>
        </div>
      )}
      </>)}
    </div>
  );
}


// ── The recent-reporters result strip. Every name the pass touched is
//    listed under the bucket it landed in, with the ledger fact that put it
//    there, so "skipped" is never a mystery. (zzz763)
function RecentReportersStrip({ recent }: { recent: ReturnType<typeof useBook>['recent'] }) {
  const p = recent.plan;
  const chip = (t: string, color: string, title?: string) => (
    <span key={t} title={title} style={{ fontSize: 13, fontWeight: 700, padding: '1px 7px', borderRadius: 999,
      border: `1px solid ${color}`, color, marginRight: 4, marginBottom: 3, display: 'inline-block' }}>{t}</span>
  );
  const border = recent.state === 'error' ? '#EF4444' : recent.state === 'reading' ? C.cyan : C.amber;
  return (
    <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.7, background: C.bg, border: `1px solid ${border}`, borderRadius: 8, padding: '9px 13px' }}>
      {recent.state === 'error' && <b style={{ color: 'var(--mc-verdict-down, #EF4444)' }}>{recent.error}</b>}
      {recent.state !== 'error' && p && (
        <>
          <b style={{ color: C.text }}>
            Last {recent.days} days{p.from ? ` (since ${p.from})` : ''}: {p.due.length + p.current.length} reported
            {' · '}{p.due.length} {recent.state === 'reading' ? 're-reading' : 're-read'}
            {' · '}{p.current.length} already current, skipped
            {' · '}{p.not_reported} filed nothing
            {recent.usSkipped ? ` · ${recent.usSkipped} US not covered by the NSE feed` : ''}
          </b>
          {recent.feedNote && <div style={{ color: C.amber }}>{recent.feedNote}</div>}
          {recent.feed && recent.feed.days_failed.length > 0 && !recent.feedNote && (
            <div style={{ color: C.faint }}>Feed answered nothing for {recent.feed.days_failed.join(', ')} — a filing on one of those days may be missing from this pass.</div>
          )}
          {p.due.length > 0 && (
            <div><span style={{ color: C.faint, marginRight: 6 }}>{recent.state === 'reading' ? 'Reading' : 'Read'}:</span>
              {p.due.map((d) => chip(`${d.ticker} · filed ${d.reported_at}`, C.cyan, `${d.subject} — ${d.because}`))}</div>
          )}
          {p.current.length > 0 && (
            <div><span style={{ color: C.faint, marginRight: 6 }}>Skipped, already current:</span>
              {p.current.map((d) => chip(`${d.ticker} · filed ${d.reported_at}`, C.faint, `${d.subject} — ${d.because}`))}</div>
          )}
          {recent.at && recent.state === 'done' && (
            <div style={{ color: C.faint, fontSize: 13 }}>Finished {recent.at.slice(11, 16)} UTC · nothing runs again until you click.</div>
          )}
        </>
      )}
    </div>
  );
}
