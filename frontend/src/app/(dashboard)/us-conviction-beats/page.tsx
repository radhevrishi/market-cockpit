'use client';

// ═══════════════════════════════════════════════════════════════════════════
// US CONVICTION BEATS — the accumulating bench of US names that graded
// BLOCKBUSTER or STRONG. The US sibling of the Conviction Beats tab on
// /watchlists.
//
// It fills itself two ways:
//   1. Every visit to /us-earnings-opportunities syncs that payload onto the
//      bench (and demotes anything that re-graded MIXED/AVOID).
//   2. A background sweep on this page walks the last N sessions of
//      /api/v1/earnings/graded-us so the bench builds up even if the
//      Opportunities page is never opened — and RE-PRICES entries older than
//      the sweep window through the explicit-ticker mode, so a name benched
//      90 days ago (exactly the one whose drift you want) is never stale.
//
// The bench lives in its OWN localStorage namespace, separate from India —
// ticker symbols are not globally unique, and a shared store would have the
// two markets silently overwriting each other. See lib/conviction-beats-us.ts.
// ═══════════════════════════════════════════════════════════════════════════

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { windowSessions } from '@/lib/us-merge';
import { getCachedDay, putCachedDay, clearDayCache } from '@/lib/us-day-cache';
import toast from 'react-hot-toast';
import { Award, RefreshCw, X, Undo2, ExternalLink, Star, Copy } from 'lucide-react';
import {
  getUsConvictionList, removeUsConviction, clearUsConviction, syncUsConviction,
  restoreUsConvictionBin, readUsConvictionBin, hydrateUsConviction, usBenchPersistError,
  usFilingAgeDays, computeUsNewWindow, usVerdict, usRule40, usRoce,
  passesUsConvictionFilter, usPresetFilters, isUsPresetActive,
  US_FILTER_DEFAULT, US_PRESET,
  type UsConvictionEntry, type UsConvFilters,
} from '@/lib/conviction-beats-us';
import { fmtUsd, fmtPct } from '@/lib/us-earnings-core';
// ONE card, shared with /us-earnings-opportunities. See the header of
// src/components/us-earnings-card.tsx for why it is not two.
import {
  UsEarningsCard, Chip, QuarterBasisBadge, rule40Title, QUADRANT_META, quadrantTitle,
  setAllAiSummaries, useAiSummaryQueue,
  type Rule40Like,
} from '@/components/us-earnings-card';
import { buildTvExport } from '@/lib/us-tradingview';
import { knownExchanges, resolveExchanges } from '@/lib/us-exchange-client';
import { buildFunnel, BUCKET_META, bucketFor, type BucketId } from '@/lib/us-process';

const OPT_OUT_KEY = 'mc:us-cb:preset:v1:optout';
const SWEEP_KEY = 'mc:us-cb:lastsweep:v1';
const FILTERS_KEY = 'mc:us-cb:filters:v1';
const WINDOW_KEY = 'mc:us-cb:window:v1';
/** How far back a rebuild reaches, in TRADING sessions. The bench is built from
 *  8-K/10-Q filings, and a month of calendar time is about 21 sessions. */
const WINDOWS: Array<[label: string, sessions: number]> = [
  ['1 month', 21], ['2 months', 42], ['3 months', 63],
];
const VIEW_KEY = 'mc:us-cb:view:v1';
const VERDICT_COLOR: Record<string, string> = {
  'STRONG BUY': '#10B981', BUY: '#34D399', WATCH: '#FACC15', AVOID: '#EF4444',
};
const VERDICTS = ['STRONG BUY', 'BUY', 'WATCH', 'AVOID'];

type SortKey = 'fresh' | 'score' | 'pead' | 'sales' | 'eps' | 'drift' | 'mcap' | 'pe' | 'addv' | 'age';

function etToday(): string {
  return new Date(Date.now() - 4 * 3600_000).toISOString().slice(0, 10);
}

/** Identity for the open/closed state of one card. The BENCH KEY, not the
 *  ticker: an archived quarter is stored under `TICKER@Q3-2026` and shares its
 *  ticker with the live entry, so a ticker key opened and closed both. */
function cardKey(e: UsConvictionEntry): string {
  return e.bench_key || `${e.ticker}|${e.period_end || e.filing_date}`;
}

/** Drift state — the sell half of the PEAD workflow. A top-tier name fading
 *  more than 12% since its print is no longer behaving like a beat. */
function driftState(e: UsConvictionEntry): 'DRIFTING' | 'FADING' | 'HOLDING' | 'RUNNING' | null {
  const m = e.move_pct;
  if (m == null) return null;
  if (m <= -12) return 'DRIFTING';
  if (m <= -5) return 'FADING';
  if (m >= 8) return 'RUNNING';
  return 'HOLDING';
}

export default function UsConvictionBeatsPage() {
  const [entries, setEntries] = useState<UsConvictionEntry[]>([]);
  const [filters, setFilters] = useState<UsConvFilters>(() => {
    try {
      const raw = localStorage.getItem(FILTERS_KEY);
      if (raw) return { ...US_FILTER_DEFAULT, ...JSON.parse(raw) };
    } catch {}
    return US_FILTER_DEFAULT;
  });
  const [benchWindow, setBenchWindow] = useState<number>(() => {
    try { const n = Number(localStorage.getItem(WINDOW_KEY)); return WINDOWS.some(([, v]) => v === n) ? n : 42; } catch { return 42; }
  });
  useEffect(() => { try { localStorage.setItem(WINDOW_KEY, String(benchWindow)); } catch {} }, [benchWindow]);
  const [sweeping, setSweeping] = useState(false);
  const [sweepMsg, setSweepMsg] = useState<string | null>(null);
  const [binCount, setBinCount] = useState(0);
  const [sort, setSort] = useState<SortKey>(() => {
    try { return (JSON.parse(localStorage.getItem(VIEW_KEY) || '{}').sort as SortKey) || 'fresh'; } catch { return 'fresh'; }
  });
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>(() => {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}').dir || 'desc'; } catch { return 'desc'; }
  });
  const [view, setView] = useState<'cards' | 'table'>(() => {
    try { return JSON.parse(localStorage.getItem(VIEW_KEY) || '{}').view || 'cards'; } catch { return 'cards'; }
  });
  const [showAdv, setShowAdv] = useState(false);
  // Which cards have their detail panel open, keyed by BENCH KEY rather than by
  // ticker: an archived quarter lives under `TICKER@Q3-2026` and shares its
  // ticker with the live entry, so keying by ticker opened both at once.
  const [openCards, setOpenCards] = useState<Set<string>>(() => new Set());
  const [copied, setCopied] = useState(false);

  useEffect(() => { try { localStorage.setItem(FILTERS_KEY, JSON.stringify(filters)); } catch {} }, [filters]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ sort, dir: sortDir, view })); } catch {} }, [sort, sortDir, view]);

  const [persistError, setPersistError] = useState<string | null>(null);
  // ── WHY A NAME IS NOT ON THE BENCH  (zzz619) ───────────────────────────
  //
  // The search box could only find what was already here. Type a ticker that
  // is not on the bench and the page went blank with no explanation — and the
  // explanation is usually the most useful thing on the screen: NTSK is not
  // here because it graded MIXED, and this bench only holds BLOCKBUSTER and
  // STRONG. "Not found" and "found, and here is why it did not qualify" are
  // completely different answers.
  const [lookup, setLookup] = useState<{ state: 'idle' | 'busy' | 'done' | 'error'; row?: any; msg?: string }>({ state: 'idle' });
  const lookupTicker = useCallback(async (t: string) => {
    const tk = t.trim().toUpperCase();
    if (!tk) return;
    setLookup({ state: 'busy' });
    try {
      const res = await fetch(`/api/v1/earnings/graded-us?tickers=${encodeURIComponent(tk)}`, { cache: 'no-store' });
      const j = await res.json();
      const rows: any[] = [];
      for (const tier of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) rows.push(...(j?.by_tier?.[tier] || []));
      if (rows.length) { setLookup({ state: 'done', row: rows[0] }); return; }
      const pend = (j?.pending || []).find((p: any) => String(p.ticker).toUpperCase() === tk);
      setLookup({
        state: 'error',
        msg: pend
          ? `${tk} filed on ${pend.filed} but could not be graded — ${pend.reason === 'xbrl-not-posted' ? 'its XBRL is not posted on EDGAR yet' : pend.reason}.`
          : `No recent earnings filing was found on EDGAR for ${tk}.`,
      });
    } catch (e: any) {
      setLookup({ state: 'error', msg: `Could not grade ${tk} (${String(e?.message || e)}).` });
    }
  }, []);
  const reload = useCallback(() => {
    setEntries(getUsConvictionList());
    setBinCount(readUsConvictionBin().length);
    setPersistError(usBenchPersistError);
  }, []);

  // The bench lives in IndexedDB (localStorage cannot hold three hundred
  // graded records — see the note in conviction-beats-us.ts). Hydration is one
  // async read; until it lands the page shows whatever the localStorage mirror
  // still holds, so it is never blank, only briefly short. Everything that
  // writes to the bench waits for this, so a sweep can never start from an
  // empty map and "rebuild" a book that was merely not loaded yet.
  const hydratedRef = useRef(false);
  useEffect(() => {
    let alive = true;
    void hydrateUsConviction().finally(() => { hydratedRef.current = true; if (alive) reload(); });
    return () => { alive = false; };
  }, [reload]);

  useEffect(() => {
    reload();
    const h = () => reload();
    window.addEventListener('conviction-beats-us:updated', h);
    return () => window.removeEventListener('conviction-beats-us:updated', h);
  }, [reload]);

  // Auto-apply the Quality Preset on first visit, unless the user opted out.
  useEffect(() => {
    try { if (localStorage.getItem(OPT_OUT_KEY) === '1') return; } catch { return; }
    setFilters((prev) => (
      prev.sales == null && prev.eps == null && prev.pead == null
        && prev.opmDelta == null && prev.cfoPatMin == null && prev.mktCapMin == null && prev.verdicts == null
        // ── THE PRESET CARRIES ITS OWN CAP  (zzz612) ──────────────────
        //
        // The Quality Preset exists to surface names worth owning, and the
        // owner's universe is small and mid caps — a preset that leaves the
        // cap filter on "All" opens on a list led by Caterpillar, Nucor and
        // Arista, which is the opposite of what turning it on was for. So
        // the preset now selects Small+Mid with it, exactly as if it were
        // one more of the preset's conditions.
        ? { ...usPresetFilters(), cap: 'smid' } : prev
    ));
  }, []);

  // ── THE NEW DEFAULT HAS TO REACH AN EXISTING READER  (zzz612) ──────────
  //
  // The effect above only fires on a bench with no saved filters at all, so
  // anyone already using the Quality Preset would keep seeing "All caps" and
  // the change would look like it had not shipped. This runs once, and only
  // for the exact state that predates the change — preset on, cap untouched.
  // A flag records that it ran, so a reader who deliberately goes back to
  // "All" is never quietly narrowed again on their next visit.
  useEffect(() => {
    const K = 'mc:us-cb:smid-default:v1';
    try { if (localStorage.getItem(K) === '1') return; } catch { return; }
    try { localStorage.setItem(K, '1'); } catch { /* the migration simply repeats */ }
    setFilters((prev) => (isUsPresetActive(prev) && (!prev.cap || prev.cap === 'all')
      ? { ...prev, cap: 'smid' } : prev));
  }, []);

  // ── WHICH SESSIONS THIS BENCH IS ACTUALLY BUILT FROM ────────────────────
  //
  // The bench held ten names while the Opportunities tab, over a shorter
  // window, graded seventeen — and the ten missing ones all filed on 26 and 27
  // August, the two heaviest days of the wave. Those sessions timed out. The
  // bench said nothing about it: it simply had fewer names, which reads as "the
  // engine found nothing" rather than "two days were never scanned".
  //
  // So every sweep records which sessions landed and which did not, the bench
  // states its own coverage in one line, and the missing ones are retried on
  // the next visit without being asked. A book that is quietly incomplete is
  // worse than one that says so.
  const COVERAGE_KEY = 'mc-us-cb-coverage-v1';
  type Coverage = { failed: string[]; grading?: string[]; swept: number; total: number; at: string };
  const readCoverage = (): Coverage | null => {
    try { return JSON.parse(localStorage.getItem(COVERAGE_KEY) || 'null'); } catch { return null; }
  };
  const writeCoverage = (c: Coverage) => {
    try { localStorage.setItem(COVERAGE_KEY, JSON.stringify(c)); } catch {}
  };
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  useEffect(() => { setCoverage(readCoverage()); }, []);

  // ═══ THE BACKGROUND FILLER  (zzz607) ═════════════════════════════════════
  //
  // A cold session is graded on the server one at a time — that serialisation
  // is not a limitation to route around, it is the only reason heavy days
  // survive at all; three at once exhausted the container's memory and killed
  // all three. What it does mean is that a long window whose older half has
  // never been graded cannot possibly finish while the user watches a button.
  //
  // So the sweep stops waiting and this takes over. It keeps asking for the
  // sessions still in the server's queue, folds each one into the bench the
  // moment it lands, and says how many are left. The user gets their page back
  // immediately, the bench fills itself, and — crucially — a session that is
  // merely SLOW is never again recorded as a session that FAILED.
  const backfillRef = useRef(false);
  const [backfillMsg, setBackfillMsg] = useState<string | null>(null);
  const startBackfill = useCallback((daysToFill: string[]) => {
    if (backfillRef.current || !daysToFill.length) return;
    backfillRef.current = true;
    const left = daysToFill.slice();
    const deadline = Date.now() + 90 * 60_000;      // give up after an hour and a half
    void (async () => {
      try {
        while (left.length && Date.now() < deadline) {
          setBackfillMsg(`${left.length} session${left.length > 1 ? 's' : ''} still being graded on the server (one at a time, so each one finishes) — the bench fills in here as they land. Nothing is waiting on you.`);
          const d = left[0];
          let got: any = null;
          try {
            const res = await fetch(`/api/v1/earnings/graded-us?date=${d}&days=1&cache_only=1`, { cache: 'no-store' });
            if (res.ok) { const j = await res.json(); if (j?.by_tier) got = j; }
          } catch { /* transient — ask again on the next lap */ }
          if (got) {
            void putCachedDay(d, got);
            const batch: any[] = [];
            for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
              for (const c of (got?.by_tier?.[t] || [])) batch.push({ ...c, source_url: c.filing_url });
            }
            if (batch.length) syncUsConviction(batch);
            left.shift();
            reload();
            // The ledger follows reality: this session is no longer missing.
            const cur = readCoverage();
            if (cur) {
              const cov: Coverage = { ...cur, grading: left.slice(), swept: Math.min(cur.total, cur.swept + 1), at: new Date().toISOString() };
              writeCoverage(cov); setCoverage(cov);
            }
            continue;                                // try the next one straight away
          }
          await new Promise((r) => setTimeout(r, 20_000));
        }
        setBackfillMsg(left.length
          ? `${left.length} session${left.length > 1 ? 's are' : ' is'} still queued on the server after an hour and a half — press Reload bench when you next open this page and they will be picked up.`
          : null);
      } finally { backfillRef.current = false; }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Walk recent sessions of graded-us, then re-price bench names older than
   *  the swept window via explicit-ticker mode (batches of 25). */
  const sweep = useCallback(async (sessions = 30, manual = false, opts: { hard?: boolean; wipe?: boolean; onlyDays?: string[] } = {}) => {
    if (sweeping) return;
    // NEVER SWEEP BEFORE THE BENCH HAS LOADED. A sweep that starts against an
    // empty map would add every graded name as new and, on a wipe rebuild,
    // replace a full book with whatever one pass happened to collect.
    if (!hydratedRef.current) { try { await hydrateUsConviction(); } catch { /* memory-only */ } hydratedRef.current = true; }
    setSweeping(true);
    setSweepMsg(null);
    // Stamped at the START: a sweep that fails half-way used to leave the stamp
    // unset, so the 6-hour auto-sweep fired again on every visit — "it's
    // sweeping all the time".
    try { localStorage.setItem(SWEEP_KEY, new Date().toISOString()); } catch {}
    // "Clear + reload" NEVER EMPTIES THE BENCH UNTIL THE REBUILD IS COMPLETE.
    //
    // It did, and the result was a bench of 315 names replaced by a bench of
    // eleven for as long as the rebuild took — which, on a cold day cache, is
    // several minutes of watching your own book disappear. Worse, a rebuild
    // that fails half way (six sessions timed out on the run that prompted
    // this) leaves the bench permanently short, and the only way back is the
    // recycle bin.
    //
    // Clearing after the FIRST successful session was the first attempt and it
    // is still wrong: a 42-session rebuild then shows a two-name bench for as
    // long as the sweep runs, which looks exactly like the data loss it was
    // meant to avoid.
    //
    // So a wipe-rebuild collects every row it grades WITHOUT touching the
    // bench, and swaps at the end: clear, then write the whole collected set in
    // one go. The old bench is on screen and intact for the entire rebuild, the
    // change is atomic, and a sweep that is abandoned half way changes nothing
    // at all.
    const wipe = !!opts.wipe;
    const collected: any[] = [];
    // A HARD reload re-reads every session from EDGAR instead of the day cache.
    // The ordinary reload is the one to use: a completed session cannot change,
    // so the cache is the same data without the wait.
    if (opts.hard) await clearDayCache();
    let changes = 0;
    try {
      const today = etToday();
      // ONE SESSION AT A TIME, THROUGH THE SAME DAY CACHE THE OPPORTUNITIES
      // PAGE FILLS. The old loop asked the server for three 10-day sweeps with
      // no timeout and no progress: a chunk that hung pinned "Sweeping…" for
      // ever, a chunk that failed was skipped in silence, and every session the
      // user had just watched load on the other tab was swept again from
      // EDGAR. Now each completed session is read from IndexedDB when it is
      // there, fetched once and stored when it is not, and the button counts
      // up as it goes. Three sessions in flight, like the other tab.
      // A GAP-FILLING PASS SWEEPS ONLY THE SESSIONS THAT ARE MISSING.
      // Re-walking forty-two days to recover two is why nobody pressed the
      // button; two days take seconds.
      const days = opts.onlyDays?.length ? opts.onlyDays.slice() : windowSessions(today, sessions);
      let done = 0; let failed = 0;
      // The retry pass is a DIFFERENT pass, and saying "12/42" while it runs
      // made a successful recovery look like the sweep had restarted. `total`
      // is whatever the current pass is working through, and `phase` names it.
      let total = days.length;
      let phase: 'sweep' | 'retry' = 'sweep';
      const failedDays: string[] = [];
      // Sessions the server has accepted but not finished grading. Different
      // from a failure in every way that matters: nothing went wrong, and they
      // arrive on their own if we keep asking.
      const queued: string[] = [];
      // ── ASK, DON'T COMPUTE  (zzz606) ──────────────────────────────────────
      //
      // This sweep used to request the full grading endpoint — no `cache_only`
      // — with a four-minute browser timeout, three sessions at a time. Every
      // part of that was wrong for a heavy session:
      //
      //   · three simultaneous full grades in one Node process is the memory
      //     pressure that was killing the server, so all three died and the
      //     sweep reported "3 failed" on exactly the days that carry the most
      //     bench-eligible names;
      //   · a session that needs five minutes behind SEC's gate cannot finish
      //     inside a four-minute timeout, so the heaviest days could not be
      //     swept at all, however many times the button was pressed — which is
      //     precisely "it takes only a few even when there are lots of
      //     companies";
      //   · and the abandoned request left the server grading anyway, so the
      //     retry pass started the same work over from nothing.
      //
      // `cache_only=1` answers in about a second, always: the session if it is
      // cached, otherwise a note that the server has queued it. Cached days —
      // which, now that the window stays warm, is nearly all of them — land
      // instantly; a cold one is polled while the server grades it ONE at a
      // time, and the counter keeps moving the whole while.
      const askDay = async (d: string, budgetMs: number): Promise<any | null> => {
        const started = Date.now();
        for (;;) {
          const res = await fetch(`/api/v1/earnings/graded-us?date=${d}&days=1&cache_only=1`, { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const j = await res.json();
          // `by_tier` is the only honest test for a graded session: this
          // payload's `pending` field is `true` while grading and an ARRAY of
          // filers-without-XBRL when finished, so a truthiness check throws
          // away every busy day. That bug cost a day on the other page.
          if (j?.by_tier) return j;
          if (Date.now() - started > budgetMs) return null;   // still grading — the retry pass picks it up
          await new Promise((r) => setTimeout(r, 6_000));
        }
      };
      const one = async (d: string) => {
        try {
          let p: any = await getCachedDay(d, d >= today);
          // A day graded by an OLDER engine is not good enough for the bench:
          // the tier it carries is the verdict of rules that have since been
          // fixed. The opportunities page already refuses these; this one was
          // quietly seeding the bench from them.
          if (p?._stale_engine) p = null;
          if (!p) {
            // The retry is the slow lane: one session at a time against a
            // server whose queue has drained, so it can afford a longer clock.
            p = await askDay(d, phase === 'retry' ? 420_000 : 150_000);
            // ── QUEUED IS NOT FAILED  (zzz607) ────────────────────────────
            //
            // A session the server has not graded yet is not an error and
            // reporting it as "could not be scanned" is both alarming and
            // false — it WILL land, the server is simply working through the
            // cold days one at a time behind SEC's rate limit, which is the
            // only way they survive at all.
            //
            // The old code threw here, so the day went into the failed list,
            // was retried once, failed again for the same unavoidable reason,
            // and was then written into the coverage ledger as permanently
            // missing. On a three-month window — which reaches back past
            // anything the pre-warm has touched — that is most of the window,
            // and it is why the bench came back with ten names on it.
            //
            // So a queued day is remembered separately and filled in by a
            // background pass that keeps asking after the sweep has finished.
            // The bench grows by itself and nothing is lost.
            if (!p) { queued.push(d); tick(d); return; }
            void putCachedDay(d, p);
          }
          const batch: any[] = [];
          for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
            for (const c of (p?.by_tier?.[t] || [])) batch.push({ ...c, source_url: c.filing_url });
          }
          if (wipe) collected.push(...batch);
          else if (batch.length) changes += syncUsConviction(batch);
        } catch { failed++; failedDays.push(d); }
        tick(d);
      };
      const tick = (_d: string) => {
        done++;
        const head = phase === 'retry'
          ? `Retrying ${done}/${total} session${total === 1 ? '' : 's'} that timed out`
          : `${wipe ? 'Rebuilding' : 'Sweeping'} ${done}/${total} sessions${failed ? ` · ${failed} failed, retrying at the end` : ''}${queued.length ? ` · ${queued.length} queued on the server` : ''}`;
        setSweepMsg(wipe
          ? `${head} — ${collected.length} names collected, the bench below is untouched until this finishes`
          : `${head} — ${getUsConvictionList().length} on the bench`);
        if (!wipe) reload();
      };
      let next = 0;
      await Promise.all([0, 1, 2].map(async () => { while (next < days.length) await one(days[next++]); }));
      // ONE RETRY FOR THE SESSIONS THAT TIMED OUT.
      //
      // A heavy session behind SEC's rate limit can exceed the client timeout
      // while the server is still working; the next attempt usually lands
      // because the server has warmed its caches for those filers. Six failures
      // silently dropped meant six sessions of results simply missing from the
      // bench with nothing saying so.
      //
      // ONE AT A TIME, not two. The failures are timeouts, and a timeout on a
      // heavy session is contention: three sweeps sharing one SEC politeness
      // gate. Retrying two-up recreates the condition that caused them, which
      // is why "6 failed" kept surviving the retry. Serial, with a longer
      // clock, is the pass that actually lands.
      if (failedDays.length) {
        const retry = failedDays.slice();
        failedDays.length = 0;
        failed = 0;
        done = 0;
        phase = 'retry';
        total = retry.length;
        for (const d of retry) await one(d);
      }
      // THE SWAP. Everything graded, nothing lost: the old bench goes and the
      // rebuilt one lands in the same tick. Only now, and only if the rebuild
      // actually produced something — an empty result means EDGAR gave us
      // nothing, and replacing a book with nothing is never the right answer.
      if (wipe) {
        if (collected.length) { clearUsConviction(); changes += syncUsConviction(collected); reload(); }
        else setSweepMsg('Rebuild produced no graded rows — the bench was left exactly as it was.');
      }
      // Re-price the older part of the bench. Explicit mode grades each name
      // off its latest 8-K, so price / move / P/E / market cap refresh even for
      // names whose filing date fell outside the sessions above.
      const cutoff = new Date(Date.parse(today + 'T00:00:00Z') - sessions * 1.5 * 86400000).toISOString().slice(0, 10);
      const stale = getUsConvictionList().filter((e) => !e.ticker.includes('@') && e.filing_date < cutoff).map((e) => e.ticker);
      for (let i = 0; i < stale.length && i < 150; i += 25) {
        const slice = stale.slice(i, i + 25);
        const res = await fetch(`/api/v1/earnings/graded-us?tickers=${encodeURIComponent(slice.join(','))}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const p = await res.json();
        const batch: any[] = [];
        for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID']) {
          for (const c of (p?.by_tier?.[t] || [])) batch.push({ ...c, source_url: c.filing_url });
        }
        if (batch.length) changes += syncUsConviction(batch);
      }
      try { localStorage.setItem(SWEEP_KEY, new Date().toISOString()); } catch {}
      // The ledger, written whether the sweep was clean or not.
      const prev = readCoverage();
      const missing = failedDays.length + queued.length;
      const cov: Coverage = opts.onlyDays?.length && prev
        // A gap-filling pass only changes the gaps: the sessions it recovered
        // leave the failed list, and the window total is the one already on
        // record — this pass never swept the whole window.
        ? {
            failed: failedDays.slice(),
            grading: queued.slice(),
            swept: Math.min(prev.total, prev.swept + (days.length - missing)),
            total: prev.total,
            at: new Date().toISOString(),
          }
        : {
            failed: failedDays.slice(),
            grading: queued.slice(),
            swept: days.length - missing,
            total: days.length,
            at: new Date().toISOString(),
          };
      writeCoverage(cov); setCoverage(cov);
      setSweepMsg((changes > 0
        ? `Bench updated — ${changes} change${changes > 1 ? 's' : ''} (last ${sessions} sessions swept${stale.length ? `, ${Math.min(stale.length, 150)} older names re-priced` : ''}).`
        : 'Bench already up to date.') + (failed ? ` ${failed} session${failed > 1 ? 's' : ''} still could not be scanned after a retry — press Reload bench to try them again.` : ''));
      // Hand the queued sessions to the background filler and let go of the
      // button: the sweep is over, the bench keeps growing.
      if (queued.length) startBackfill(queued.slice());
    } catch (e: any) {
      setSweepMsg(`Sweep failed: ${String(e?.message || e)}`);
    } finally {
      setSweeping(false);
      reload();
      if (!manual) setTimeout(() => setSweepMsg(null), 8000);
    }
  }, [sweeping, reload]);
  const sweepWindow = useCallback((opts: { hard?: boolean; wipe?: boolean } = {}) => sweep(benchWindow, true, opts), [sweep, benchWindow]);
  /** Sweep ONLY the sessions the ledger says were never scanned. */
  const fillGaps = useCallback(() => {
    const c = readCoverage();
    // Both kinds of gap: the ones that errored and the ones the server had not
    // reached yet. Leaving the queued ones out means the button says it filled
    // the gaps and the bench is still short.
    const gaps = [...(c?.failed || []), ...(c?.grading || [])];
    if (gaps.length) void sweep(benchWindow, true, { onlyDays: gaps });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sweep, benchWindow]);
  // The gaps close themselves on the next visit — once per load, and only when
  // the ledger actually records a gap, so an intact bench never sweeps.
  const gapRunRef = useRef(false);
  useEffect(() => {
    if (gapRunRef.current) return;
    const c = readCoverage();
    // A session left QUEUED when the page was last closed does not need another
    // sweep — the server has it and it is warm by now. Asking the background
    // filler for it costs one read; re-sweeping costs a full pass.
    if (c?.grading?.length) { gapRunRef.current = true; startBackfill(c.grading.slice()); return; }
    if (!c?.failed?.length) return;
    gapRunRef.current = true;
    const t = setTimeout(() => { if (!sweeping) void sweep(benchWindow, false, { onlyDays: c.failed.slice() }); }, 2500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverage]);

  // Sweep once every 6 hours on load, so an unattended bench keeps growing.
  useEffect(() => {
    let last = 0;
    try { last = Date.parse(localStorage.getItem(SWEEP_KEY) || '') || 0; } catch {}
    if (Date.now() - last > 6 * 3600_000) {
      const t = setTimeout(() => sweep(benchWindow), 1200);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const newWindow = useMemo(() => computeUsNewWindow(entries), [entries]);

  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) if (e.sector) m.set(e.sector, (m.get(e.sector) || 0) + 1);
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  // ═══ THE FUNNEL  (zzz630) ════════════════════════════════════════════════
  //
  // The process is a staircase — 264 → clean → durable → hunting ground →
  // bottleneck → management — and the bench only ever showed the top step. A
  // ranked list cannot tell you WHERE the field collapsed, and that is the
  // information: if two hundred names die at "clean earnings", the window was
  // full of one-offs, and that is worth knowing before reading any single card.
  const [bucketFilter, setBucketFilter] = useState<BucketId | null>(null);
  const [funnelStop, setFunnelStop] = useState<string | null>(null);
  const funnel = useMemo(() => buildFunnel(entries), [entries]);
  const bucketCounts = useMemo(() => {
    const c: Record<string, number> = {};
    funnel.bucketOf.forEach((v) => { c[v.bucket] = (c[v.bucket] || 0) + 1; });
    return c;
  }, [funnel]);

  const filtered = useMemo(() => {
    let rows = entries.filter((e) => passesUsConvictionFilter(e, filters, newWindow));
    // The funnel and the bucket chips are filters like any other — clicking a
    // stage shows exactly what survived it, which is the only way to check the
    // staircase rather than take its word for it.
    if (bucketFilter) rows = rows.filter((e) => funnel.bucketOf.get(`${e.ticker}|${e.filing_date}`)?.bucket === bucketFilter);
    if (funnelStop) {
      const st = funnel.stages.find((x) => x.key === funnelStop);
      if (st) { const keep = new Set(st.survivors); rows = rows.filter((e) => keep.has(`${e.ticker}|${e.filing_date}`)); }
    }
    const num = (v: number | null | undefined, missing = -1e12) => (v == null || !Number.isFinite(v) ? missing : v);
    const key: Record<SortKey, (e: UsConvictionEntry) => number | string> = {
      fresh: (e) => e.filing_date,
      score: (e) => num(e.composite_score),
      pead: (e) => num(e.pead_score),
      sales: (e) => num(e.sales_yoy_pct),
      eps: (e) => num(e.eps_yoy_pct),
      drift: (e) => num(e.move_pct),
      mcap: (e) => num(e.market_cap_musd),
      pe: (e) => (e.pe != null && e.pe > 0 ? e.pe : 1e12),
      addv: (e) => num(e.addv_musd),
      age: (e) => -(usFilingAgeDays(e.filing_date) ?? 1e9),
    };
    const k = key[sort];
    const dir = sortDir === 'desc' ? -1 : 1;
    return rows.slice().sort((a, b) => {
      const va = k(a), vb = k(b);
      const c = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
      if (c !== 0) return c * dir;
      return (b.composite_score ?? 0) - (a.composite_score ?? 0);
    });
  }, [entries, filters, sort, sortDir, newWindow, bucketFilter, funnelStop, funnel]);

  // ═══ NAMES THE SIZE FILTER IS HIDING  (zzz623) ══════════════════════════
  //
  // The Quality Preset defaults to Small+Mid, which is the right default: the
  // bench on "All" opens on Caterpillar and Nucor, and the reader is here for
  // the names nobody has written up yet. But a default that silently removes
  // a BLOCKBUSTER is a default that looks like a BUG — nVent (NVT) graded 89,
  // BLOCKBUSTER, and simply was not on the page, because it is a $23B company
  // and the cap chip said Small+Mid. Nothing on the screen said so.
  //
  // So the page now says so, in one line, with the fix one click away. The
  // filter is unchanged; only its silence is.
  const hiddenBySize = useMemo(() => {
    if (!filters.cap || filters.cap === 'all') return [] as UsConvictionEntry[];
    const anyCap = { ...filters, cap: 'all' };
    const shown = new Set(filtered.map((e) => `${e.ticker}|${e.filing_date}`));
    return entries
      .filter((e) => (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG')
        && passesUsConvictionFilter(e, anyCap as UsConvFilters, newWindow)
        && !shown.has(`${e.ticker}|${e.filing_date}`))
      .sort((a, b) => (b.composite_score ?? 0) - (a.composite_score ?? 0));
  }, [entries, filters, filtered, newWindow]);

  /** How many names a single filter change would leave — the "(N)" on chips. */
  const countWith = useCallback((patch: Partial<UsConvFilters>) => {
    const f = { ...filters, ...patch };
    let n = 0;
    for (const e of entries) if (passesUsConvictionFilter(e, f, newWindow)) n++;
    return n;
  }, [entries, filters, newWindow]);

  /**
   * How many bench names pass ONE gate on its own.
   *
   * Not `countWith`, which layers a value on top of every filter already set —
   * that answers "how many survive everything including this", and the reader
   * opening this panel is asking the opposite question: which single gate is
   * responsible for the bench being short. So this starts from the defaults
   * and turns on nothing but the gate in question.
   */
  const countGateAlone = useCallback((key: string, v: number | null) => {
    if (v == null) return entries.length;
    const f: any = { ...US_FILTER_DEFAULT, cap: 'all', q: '' };
    f[key] = v;
    let n = 0;
    for (const e of entries) if (passesUsConvictionFilter(e, f, newWindow)) n++;
    return n;
  }, [entries, newWindow]);

  const presetOn = isUsPresetActive(filters);
  // ── THE PRESET, OPENED UP  (zzz614) ────────────────────────────────────
  //
  // The chip printed six thresholds and offered exactly one action: all of
  // them, or none of them. But the thresholds are the whole argument — "PEAD
  // ≥60" is a judgement, not a law — and a reader who wants EPS ≥15 instead of
  // 25 had to abandon the preset and rebuild it by hand in the detail filters.
  //
  // So the numbers are editable in place. Hidden by default, because the chip
  // is a one-click gate first and a control panel second, and shown only when
  // asked for. `presetLive` is the test that matters once they can be edited:
  // the preset is ON whenever its gates are set at all, CUSTOMISED when the
  // values are no longer the defaults. Reading a changed threshold as "off"
  // would have been the worst of both — the filter still cutting names while
  // the chip claimed it was not.
  const PRESET_KEYS = ['sales', 'eps', 'pead', 'opmDelta', 'cfoPatMin', 'mktCapMin'] as const;
  const presetLive = PRESET_KEYS.some((k) => (filters as any)[k] != null);
  const presetCustom = presetLive && !presetOn;
  const [showPreset, setShowPreset] = useState(false);
  const PRESET_FIELDS: Array<{ k: typeof PRESET_KEYS[number]; label: string; unit: string; step: number; hint: string }> = [
    { k: 'sales', label: 'Sales YoY', unit: '%', step: 5, hint: 'Minimum revenue growth against the year-ago quarter.' },
    { k: 'eps', label: 'EPS YoY', unit: '%', step: 5, hint: 'Minimum earnings-per-share growth against the year-ago quarter.' },
    { k: 'pead', label: 'PEAD', unit: '', step: 5, hint: 'Minimum post-earnings-drift score (0-100).' },
    { k: 'opmDelta', label: 'OPM Δ', unit: 'pp', step: 1, hint: 'Minimum change in operating margin, in percentage points, against the year-ago quarter.' },
    { k: 'cfoPatMin', label: 'CFO/NI', unit: '×', step: 0.1, hint: 'Minimum cash conversion. Skipped for banks, insurers and REITs, where the ratio does not mean the same thing.' },
    { k: 'mktCapMin', label: 'Market cap', unit: '$M', step: 100, hint: 'Minimum market capitalisation in US$ millions.' },
  ];
  const togglePreset = () => {
    setFilters((prev) => {
      if (isUsPresetActive(prev)) {
        try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {}
        return { ...US_FILTER_DEFAULT, cap: prev.cap, q: prev.q };
      }
      try { localStorage.removeItem(OPT_OUT_KEY); } catch {}
      // Turning the preset ON narrows to small+mid with it; turning it off
      // leaves the cap where the reader put it, so an explicit choice is
      // never overwritten in the direction that hides names.
      return { ...usPresetFilters(), cap: 'smid', q: prev.q };
    });
  };

  const tierCounts = useMemo(() => ({
    BLOCKBUSTER: entries.filter((e) => e.tier === 'BLOCKBUSTER').length,
    STRONG: entries.filter((e) => e.tier === 'STRONG').length,
    drifting: entries.filter((e) => driftState(e) === 'DRIFTING').length,
  }), [entries]);

  // ── expand / collapse ──────────────────────────────────────────────────
  const toggleCard = useCallback((k: string) => {
    setOpenCards((prev) => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  }, []);
  // Expand-all works on the rows that pass the filters — the same set the
  // TradingView copy exports, so what you open is what you copy.
  const visibleKeys = useMemo(() => filtered.map(cardKey), [filtered]);
  const allOpen = visibleKeys.length > 0 && visibleKeys.every((k) => openCards.has(k));
  const [allAiOpen, setAllAiOpen] = useState(false);
  const aiLeft = useAiSummaryQueue();
  const toggleAll = () => {
    setOpenCards((prev) => {
      const n = new Set(prev);
      for (const k of visibleKeys) { if (allOpen) n.delete(k); else n.add(k); }
      return n;
    });
  };

  const setSortKey = (k: SortKey) => {
    if (sort === k) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    else { setSort(k); setSortDir(k === 'pe' || k === 'age' ? 'asc' : 'desc'); }
  };

  const exportCsv = () => {
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const head = ['Ticker', 'Company', 'Tier', 'Quadrant', 'Quality', 'Inflection', 'Verdict', 'Score', 'Quarter', 'Filed', 'Rev YoY %', 'NI YoY %', 'EPS YoY %',
      'OPM %', 'OPM prev %', 'CFO/NI', 'Rule of 40', 'R40 basis', 'ROCE %', 'PEAD', 'RS', 'Stage', '% from 52w high', 'ADDV $M', 'Mkt cap $M', 'Price', 'P/E',
      'D1 %', 'Since %', 'Sector', 'Caveats', 'SEC'];
    const body = filtered.map((e) => [e.ticker, e.company, e.tier,
      e.quadrant ?? '', e.quality_score ?? '', e.inflection_score ?? '',
      usVerdict(e).verdictLabel, e.composite_score, e.quarter, e.filing_date,
      e.sales_yoy_pct?.toFixed(1), e.net_profit_yoy_pct?.toFixed(1), e.eps_yoy_pct?.toFixed(1),
      e.opm_pct?.toFixed(2), e.opm_prev_pct?.toFixed(2), e.cfo_to_pat_ratio?.toFixed(2),
      usRule40(e)?.score, usRule40(e)?.basis, usRoce(e)?.pct,
      e.pead_score, e.rs_rating, e.stage,
      e.pct_from_52w_high?.toFixed(1), e.addv_musd?.toFixed(1), e.market_cap_musd?.toFixed(0), e.price?.toFixed(2), e.pe,
      e.d1_pct?.toFixed(2), e.move_pct?.toFixed(2), e.sector, (e.caveat_tags || []).join(' | '), e.source_url].map(esc).join(','));
    download(`us-conviction-beats-${etToday()}.csv`, [head.map(esc).join(','), ...body].join('\n'));
  };
  /**
   * COPY → TRADINGVIEW, grouped by tier.
   *
   *   ###ELITE,NASDAQ:NVDA,NASDAQ:AVGO,###BLOCKBUSTER,NYSE:KEYS,…
   *
   * Same semantics as the India tabs: descending quality order, and a name in a
   * higher group is deduped out of every lower one. Only the rows that pass the
   * filters currently applied are copied — the export is what is on screen.
   *
   * The exchange prefix is RESOLVED, never guessed: the venue comes from the
   * bench row when the payload carried one, otherwise from SEC's
   * `company_tickers_exchange.json` through /api/v1/us/exchange (cached in this
   * browser for a week). A name whose venue genuinely cannot be established is
   * still exported, as a bare ticker — a form TradingView accepts — rather than
   * being dropped or given a guessed prefix that TradingView would silently
   * discard. See lib/us-tradingview.ts.
   */
  const exportTv = useCallback(async (mode: 'copy' | 'download') => {
    if (!filtered.length) { toast.error('Nothing passes the current filters'); return; }
    const tickers = filtered.map((e) => e.ticker);
    // Paint from whatever is already cached, then top up over the network. A
    // failed fetch degrades to bare tickers, never to a wrong prefix.
    let venues: Record<string, string | null> = knownExchanges(tickers);
    try { venues = { ...venues, ...(await resolveExchanges(tickers)) }; } catch { /* cached half still exports */ }
    const venueFor = (e: UsConvictionEntry): string | null =>
      e.exchange ?? venues[e.ticker.toUpperCase().split('@')[0]] ?? null;
    const rowsOf = (list: UsConvictionEntry[]) => list.map((e) => ({ ticker: e.ticker, exchange: venueFor(e) }));

    const out = buildTvExport([
      { label: 'ELITE', rows: rowsOf(filtered.filter((e) => e.is_elite)) },
      { label: 'BLOCKBUSTER', rows: rowsOf(filtered.filter((e) => e.tier === 'BLOCKBUSTER')) },
      { label: 'STRONG', rows: rowsOf(filtered.filter((e) => e.tier === 'STRONG')) },
    ]);
    if (!out.count) { toast.error('Nothing to copy'); return; }
    const tail = out.unresolved.length
      ? ` · ${out.unresolved.length} without a venue prefix (SEC lists no exchange for ${out.unresolved.slice(0, 3).join(', ')}${out.unresolved.length > 3 ? '…' : ''})`
      : '';
    const summary = out.groups.map((g) => `${g.label} ${g.count}`).join(' · ');
    // ── SAY WHAT WAS LEFT OUT  (zzz612) ───────────────────────────────────
    //
    // The export is always the FILTERED set — what is on screen, nothing more.
    // That is the right behaviour and it was silent about it, so a list copied
    // with the Quality Preset on looks identical to one copied with filters
    // off, and a name that is on the bench but filtered out appears to have
    // vanished (or, if TradingView still holds an older paste, to have
    // appeared from nowhere). Stating the count against the whole bench makes
    // the two impossible to confuse.
    const held = entries.length - filtered.length;
    const scope = held > 0
      ? ` · ${filtered.length} of ${entries.length} on the bench — ${held} excluded by the current filters`
      : ` · the whole bench (${entries.length})`;

    if (mode === 'download') {
      download(`us-conviction-beats-${etToday()}-tradingview.txt`, out.text, 'text/plain');
      toast.success(`${out.count} tickers · ${summary}${scope}${tail}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(out.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
      toast.success(`Copied ${out.count} tickers in ${out.groups.length} section${out.groups.length === 1 ? '' : 's'} for TradingView · ${summary}${scope}${tail}`);
    } catch {
      // Clipboard permission denied (or an insecure origin). Fall back to the
      // file so the export still reaches the user.
      download(`us-conviction-beats-${etToday()}-tradingview.txt`, out.text, 'text/plain');
      toast.error('Clipboard blocked — downloaded the list as a file instead');
    }
  }, [filtered]);

  return (
    <div style={{ padding: 20, maxWidth: 1500, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <Award className="w-5 h-5" style={{ color: 'var(--mc-warn)' }} />
        <h1 style={{ fontSize: 'var(--mc-text-h3)', fontWeight: 800, color: 'var(--mc-text-0)', margin: 0 }}>
          US Conviction Beats
        </h1>
        <span style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 999, border: '1px solid var(--mc-cyan)', color: 'var(--mc-cyan)' }}>NYSE · NASDAQ</span>
        {tierCounts.drifting > 0 && (
          <span title="Top-tier names down more than 12% since their print" style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 800, padding: '3px 9px', borderRadius: 999, border: '1px solid #EF4444', color: '#EF4444', backgroundColor: 'color-mix(in srgb, #EF4444 10%, transparent)' }}>
            ⚠ {tierCounts.drifting} drifting
          </span>
        )}
        {/* A ROUTE CHANGE, NOT A PAGE LOAD. `<a href>` tore the whole app down
            and rebuilt it: the React Query cache went with it, the day cache had
            to be re-read from IndexedDB, and this page then opened on an
            auto-sweep — which is what "not smooth" meant. `Link` keeps the
            client alive and prefetches the other tab on hover. */}
        <Link href="/us-earnings-opportunities" prefetch style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '3px 10px', borderRadius: 999, border: '1px solid #F59E0B', color: '#F59E0B', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Star className="w-3 h-3" /> US Earnings Opportunities →
        </Link>
      </div>
      <p style={{ color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-sm)', margin: '0 0 14px' }}>
        The bench of US names that graded BLOCKBUSTER or STRONG. It accumulates on its own from every graded window,
        demotes a name automatically when a later quarter drops out of the top tiers, and re-prices older entries on
        each sweep. Stored in this browser — nothing is sent anywhere. Educational, not investment advice.
      </p>

      {/* ── BENCH CONTROLS ─────────────────────────────────────────────────
          Its own bar, above the filters, because the two actions that rebuild
          this page used to live at the tail of a wrapping status strip full of
          zeroes — findable only if you already knew they were there. Reload,
          how far back to reload, and clear are one row now. */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12,
        padding: '10px 12px', borderRadius: 'var(--mc-radius)',
        backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)',
      }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: 0.3, color: 'var(--mc-text-3)' }}>BENCH</span>
        <button onClick={() => sweepWindow()} disabled={sweeping}
          title="Re-grade every session in the window and re-price the older names. Sessions already scanned are read from the local cache, so this is fast after the first run."
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '7px 14px',
            borderRadius: 999, border: '1px solid var(--mc-cyan)',
            background: sweeping ? 'var(--mc-bg-3)' : 'var(--mc-cyan)',
            color: sweeping ? 'var(--mc-text-2)' : '#04121A', fontWeight: 800,
            fontSize: 'var(--mc-text-xs)', cursor: sweeping ? 'default' : 'pointer',
          }}>
          <RefreshCw className="w-3 h-3" style={{ animation: sweeping ? 'spin 1s linear infinite' : undefined }} />
          {sweeping ? 'Reloading…' : 'Reload bench'}
        </button>
        <span style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-3)' }}>back</span>
        {WINDOWS.map(([label, n]) => (
          <button key={n} onClick={() => setBenchWindow(n)} disabled={sweeping}
            title={`${n} trading sessions`}
            style={chip(benchWindow === n)}>{label}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => {
          if (confirm(`Clear the bench and rebuild it from the last ${WINDOWS.find(([, n]) => n === benchWindow)?.[0] ?? benchWindow + ' sessions'}?\n\nCleared entries move to the recycle bin and can be restored.`)) {
            void sweepWindow({ wipe: true });
          }
        }} disabled={sweeping} style={chip(false, '#F59E0B')}
          title="Empty the bench, then rebuild it from scratch over the window — the one button for 'start again'">
          ♻ Clear + reload
        </button>
        <button onClick={() => {
          if (confirm('Clear the entire US bench? Entries move to the recycle bin and can be restored.')) { clearUsConviction(); reload(); }
        }} disabled={sweeping} style={chip(false, '#EF4444')}>Clear all</button>
        {binCount > 0 && (
          <button onClick={() => { restoreUsConvictionBin(); reload(); }} style={chip(false)}>
            <Undo2 className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />Restore {binCount}
          </button>
        )}
        <button onClick={() => { if (confirm('Re-download every session from SEC EDGAR, ignoring the local cache? This takes several minutes.')) void sweepWindow({ hard: true }); }}
          disabled={sweeping} style={chip(false)}
          title="Ignore the cached sessions and re-read them all from EDGAR. Only needed if you think a cached session is wrong.">
          ⟳ Hard re-scan
        </button>
      </div>

      {/* ── quality preset + quick toggles ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <button onClick={togglePreset}
          title={`Sales YoY ≥${US_PRESET.sales}% · EPS YoY ≥${US_PRESET.eps}% · PEAD ≥${US_PRESET.pead} · OPM Δ ≥${US_PRESET.opmDelta}pp · CFO/NI ≥${US_PRESET.cfoPatMin} (skipped for banks, insurers and REITs) · Market cap ≥ $${US_PRESET.mktCapMinMusd}M · Verdict STRONG BUY / BUY / WATCH. No promoter-pledge gate — that concept does not exist in US markets.`}
          style={{ fontSize: 'var(--mc-text-xs)', fontWeight: 800, padding: '7px 12px', borderRadius: 999, cursor: 'pointer', border: '1px solid #F59E0B', color: '#F59E0B', backgroundColor: presetOn ? 'color-mix(in srgb, #F59E0B 14%, transparent)' : 'var(--mc-bg-2)' }}>
          ⚡ QUALITY PRESET · Sales≥{filters.sales ?? US_PRESET.sales} · EPS≥{filters.eps ?? US_PRESET.eps} · PEAD≥{filters.pead ?? US_PRESET.pead} · OPM Δ≥{filters.opmDelta ?? US_PRESET.opmDelta} · CFO/NI≥{filters.cfoPatMin ?? US_PRESET.cfoPatMin} · MktCap≥${filters.mktCapMin ?? US_PRESET.mktCapMinMusd}M{' '}
          {presetOn ? '✓ ON' : presetCustom ? '✓ ON · customised' : '· OFF — click to enable'}
        </button>
        {/* Deliberately a SEPARATE control. Folding "show the numbers" into the
            same click as "turn it on" means a reader cannot look without also
            changing what they are looking at. */}
        <button onClick={() => setShowPreset((v) => !v)}
          title={showPreset ? 'Hide the preset thresholds' : 'Show and edit the preset thresholds'}
          style={{ ...chip(showPreset, '#F59E0B'), borderRadius: 999 }}>
          {showPreset ? '▾ hide thresholds' : '▸ show thresholds'}
        </button>
        {/* The thresholds, editable in place. Every change is live — the count
            beside each field is how many names that gate alone would leave, so
            the reader can see which number is doing the cutting BEFORE they
            change it, rather than discovering it afterwards from an empty
            list. Blank means the gate is off, which is a real and useful
            state: the preset minus its cash-conversion test is a sensible
            thing to want. */}
        {showPreset && (
          <div style={{
            width: '100%', marginTop: 2, padding: '11px 13px', borderRadius: 'var(--mc-radius)',
            border: '1px solid color-mix(in srgb, #F59E0B 35%, transparent)',
            backgroundColor: 'color-mix(in srgb, #F59E0B 6%, transparent)',
          }}>
            <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginBottom: 9, lineHeight: 1.55 }}>
              These six gates are the preset. They are a judgement, not a law — change any of them and the bench re-filters at once.
              Clear a box to switch that gate off entirely. The count beside each is how many of your <b style={{ color: 'var(--mc-text-1)' }}>{entries.length}</b> bench
              names pass <i>that gate alone</i>, so you can see which one is doing the cutting.
              {presetCustom && <> <b style={{ color: '#F59E0B' }}>Currently customised</b> — the chip stays on because the gates are still live.</>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(168px,1fr))', gap: 9 }}>
              {PRESET_FIELDS.map(({ k, label, unit, step, hint }) => {
                const v = (filters as any)[k] as number | null;
                const alone = countGateAlone(k, v);
                return (
                  <label key={k} title={hint} style={{ display: 'block', fontSize: 'var(--mc-text-xs)' }}>
                    <div style={{ color: 'var(--mc-text-3)', fontWeight: 700, marginBottom: 3 }}>
                      {label} ≥{unit === '$M' ? ' $' : ' '}<span style={{ color: 'var(--mc-text-1)' }}>{v ?? '—'}</span>{unit !== '$M' ? unit : 'M'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        type="number" step={step} value={v ?? ''} placeholder="off"
                        onChange={(ev) => {
                          const raw = ev.target.value;
                          const num = raw === '' ? null : Number(raw);
                          setFilters((prev) => ({ ...prev, [k]: raw === '' ? null : (Number.isFinite(num as number) ? num : (prev as any)[k]) }));
                          // Editing a threshold is a deliberate act: it must not
                          // be undone by the auto-apply on the next visit.
                          try { localStorage.removeItem(OPT_OUT_KEY); } catch { /* ignore */ }
                        }}
                        style={{
                          width: '100%', padding: '5px 7px', borderRadius: 6, fontSize: 'var(--mc-text-xs)',
                          border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)', color: 'var(--mc-text-0)',
                        }} />
                      <span title={`${alone} of ${entries.length} bench names pass this gate on its own`}
                        style={{ fontSize: 10, color: alone === 0 ? 'var(--mc-bearish,#EF4444)' : 'var(--mc-text-4)', fontFamily: 'ui-monospace,monospace', whiteSpace: 'nowrap' }}>
                        {alone}
                      </span>
                    </div>
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => setFilters((prev) => ({ ...prev, ...usPresetFilters(), cap: prev.cap, q: prev.q }))}
                style={chip(false, '#F59E0B')}>↺ Reset to preset defaults</button>
              <button onClick={() => setFilters((prev) => {
                const next: any = { ...prev };
                for (const k of PRESET_KEYS) next[k] = null;
                next.verdicts = null;
                try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch { /* ignore */ }
                return next;
              })} style={chip(false)}>Turn every gate off</button>
              <span style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>
                Verdict gate: STRONG BUY / BUY / WATCH{filters.verdicts ? '' : ' — currently off'}. No promoter-pledge gate — that concept does not exist in US markets.
              </span>
            </div>
          </div>
        )}
        <button onClick={() => setFilters((p) => ({ ...p, newOnly: !p.newOnly }))} style={chip(filters.newOnly, '#10B981')}>
          NEW · {newWindow.days}d{newWindow.widened ? ' (widened from 10d)' : ''} ({newWindow.count})
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, elite: !p.elite }))} style={chip(filters.elite, '#F59E0B')}>⭐ ELITE ({countWith({ elite: true })})</button>
        <button onClick={() => setFilters((p) => ({ ...p, multibagger: !p.multibagger }))} style={chip(filters.multibagger, '#8B5CF6')}>💎 MULTIBAGGER ({countWith({ multibagger: true })})</button>
        <button onClick={() => setFilters((p) => ({ ...p, rule40: !p.rule40 }))} style={chip(filters.rule40, '#10B981')}
          title="Revenue growth % + free-cash-flow margin %, both trailing twelve months, at or above 40. A name whose filing does not support the arithmetic is cut, never assumed to pass.">
          ⚡ RULE OF 40 ({countWith({ rule40: true })})
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, roce20: !p.roce20 }))} style={chip(filters.roce20, '#10B981')}
          title="Trailing-twelve-month operating income ÷ (total assets − current liabilities), at or above 20%. Not computed for a filer with no classified balance sheet — a bank's current liabilities are its deposits.">
          🏭 ROCE ≥20% ({countWith({ roce20: true })})
        </button>
        {/* THE SECOND AXIS, as two chips and not four — the same decision as the
            Opportunities tab, for the same reason. REJECT is a thing you filter
            OUT rather than in, and QUALITY asks almost exactly what the two
            chips to the left of it already ask. */}
        <button onClick={() => setFilters((p) => ({ ...p, turnaround: !p.turnaround }))}
          style={chip(filters.turnaround, QUADRANT_META['TURNAROUND ACCELERATOR'].color)}
          title={QUADRANT_META['TURNAROUND ACCELERATOR'].tagline}>
          {QUADRANT_META['TURNAROUND ACCELERATOR'].icon} TURNAROUND ACCELERATOR ({countWith({ turnaround: true })})
        </button>
        <button onClick={() => setFilters((p) => ({ ...p, compounder: !p.compounder }))}
          style={chip(filters.compounder, QUADRANT_META.COMPOUNDER.color)}
          title={QUADRANT_META.COMPOUNDER.tagline}>
          {QUADRANT_META.COMPOUNDER.icon} COMPOUNDER ({countWith({ compounder: true })})
        </button>
        <button onClick={() => setShowAdv((v) => !v)} style={chip(showAdv)}>{showAdv ? '▴ Hide detail filters' : '▾ Detail filters'}</button>
      </div>

      {/* ── detail filters (every gate the engine enforces, with live counts) ── */}
      {showAdv && (
        <div style={{ padding: 12, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <ChipRow label="Revenue YoY ≥" value={filters.sales} opts={[10, 15, 20, 30, 50]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, sales: v }))} count={(v) => countWith({ sales: v })} />
          <ChipRow label="Net income YoY ≥" value={filters.pat} opts={[10, 25, 50, 100]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, pat: v }))} count={(v) => countWith({ pat: v })} />
          <ChipRow label="EPS YoY ≥" value={filters.eps} opts={[15, 25, 40, 75]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, eps: v }))} count={(v) => countWith({ eps: v })} />
          <ChipRow label="OPM Δ ≥" value={filters.opmDelta} opts={[-2, 0, 1, 3, 5]} fmt={(v) => `${v >= 0 ? '+' : ''}${v}pp`} onSet={(v) => setFilters((p) => ({ ...p, opmDelta: v }))} count={(v) => countWith({ opmDelta: v })} />
          <ChipRow label="OPM ≥" value={filters.opmMin} opts={[5, 10, 15, 20, 30]} fmt={(v) => `${v}%`} onSet={(v) => setFilters((p) => ({ ...p, opmMin: v }))} count={(v) => countWith({ opmMin: v })} />
          <ChipRow label="CFO/NI ≥" value={filters.cfoPatMin} opts={[0.5, 0.8, 1, 1.2]} fmt={(v) => `${v}×`} onSet={(v) => setFilters((p) => ({ ...p, cfoPatMin: v }))} count={(v) => countWith({ cfoPatMin: v })} />
          <ChipRow label="PEAD ≥" value={filters.pead} opts={[40, 60, 70, 80]} fmt={(v) => `${v}`} onSet={(v) => setFilters((p) => ({ ...p, pead: v }))} count={(v) => countWith({ pead: v })} />
          <ChipRow label="Score ≥" value={filters.score} opts={[60, 70, 78, 85]} fmt={(v) => `${v}`} onSet={(v) => setFilters((p) => ({ ...p, score: v }))} count={(v) => countWith({ score: v })} />
          <ChipRow label="Mkt cap ≥" value={filters.mktCapMin} opts={[300, 1000, 2000, 5000, 10000]} fmt={(v) => (v >= 1000 ? `$${v / 1000}B` : `$${v}M`)} onSet={(v) => setFilters((p) => ({ ...p, mktCapMin: v }))} count={(v) => countWith({ mktCapMin: v })} />
          <ChipRow label="P/E ≤" value={filters.peMax} opts={[15, 20, 30, 40]} fmt={(v) => `${v}×`} onSet={(v) => setFilters((p) => ({ ...p, peMax: v }))} count={(v) => countWith({ peMax: v })} />
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={rowLabel}>Verdict</span>
            {VERDICTS.map((v) => {
              const on = (filters.verdicts || []).includes(v);
              return (
                <button key={v} onClick={() => setFilters((p) => {
                  const cur = p.verdicts || [];
                  const next = on ? cur.filter((x) => x !== v) : [...cur, v];
                  return { ...p, verdicts: next.length ? next : null };
                })} style={chip(on, VERDICT_COLOR[v])}>{v} ({countWith({ verdicts: [v] })})</button>
              );
            })}
            <button onClick={() => setFilters((p) => ({ ...p, verdicts: null }))} style={chip(!filters.verdicts)}>Any</button>
          </div>
          {sectors.length > 0 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={rowLabel}>Sector</span>
              <button onClick={() => setFilters((p) => ({ ...p, sector: null }))} style={chip(!filters.sector)}>All</button>
              {sectors.slice(0, 14).map(([s, n]) => (
                <button key={s} onClick={() => setFilters((p) => ({ ...p, sector: p.sector === s ? null : s }))} style={chip(filters.sector === s, '#22D3EE')}>{s} ({n})</button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ THE PROCESS · THE FUNNEL AND THE FIVE BUCKETS  (zzz630) ═══════
          "Earnings strength ≠ future multibagger" cannot be carried by one
          tier: BLOCKBUSTER is handed to a structural compounder and to a
          commodity business at the top of its cycle alike. The staircase below
          is where the field actually collapses, and each step is clickable so
          the claim can be checked rather than believed. */}
      {entries.length > 0 && (
        <div style={{ padding: 12, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: 0.5, color: 'var(--mc-text-2)' }}>🧭 THE PROCESS — where the field collapses</span>
            {(bucketFilter || funnelStop) && (
              <button onClick={() => { setBucketFilter(null); setFunnelStop(null); }}
                style={{ fontSize: 10.5, fontWeight: 800, padding: '3px 9px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--mc-bg-4)', background: 'transparent', color: 'var(--mc-text-3)' }}>
                clear process filter
              </button>
            )}
          </div>
          {/* the staircase */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 9 }}>
            {funnel.stages.map((st, i) => {
              const on = funnelStop === st.key;
              const pct = funnel.stages[0].survivors.length ? (st.survivors.length / funnel.stages[0].survivors.length) : 0;
              return (
                <button key={st.key} onClick={() => setFunnelStop(on ? null : st.key)} title={`${st.test}${st.dropped ? `\n\n${st.dropped} dropped at this step.` : ''}`}
                  style={{
                    flex: '1 1 130px', minWidth: 118, textAlign: 'left', cursor: 'pointer',
                    padding: '7px 9px', borderRadius: 8,
                    border: `1px solid ${on ? 'var(--mc-cyan)' : 'var(--mc-bg-4)'}`,
                    background: on ? 'color-mix(in srgb, var(--mc-cyan) 12%, transparent)' : 'var(--mc-bg-2)',
                  }}>
                  <div style={{ fontSize: 9, color: 'var(--mc-text-3)', letterSpacing: 0.3 }}>{i === 0 ? 'START' : `STEP ${i}`}</div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--mc-text-0)', lineHeight: 1.3, margin: '1px 0 3px' }}>{st.label}</div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
                    <span style={{ fontSize: 16, fontWeight: 900, fontFamily: 'ui-monospace,monospace', color: on ? 'var(--mc-cyan)' : 'var(--mc-text-0)' }}>{st.survivors.length}</span>
                    {st.dropped > 0 && <span style={{ fontSize: 9.5, color: '#F87171' }}>−{st.dropped}</span>}
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: 'var(--mc-bg-4)', marginTop: 4 }}>
                    <div style={{ height: '100%', width: `${Math.round(pct * 100)}%`, borderRadius: 2, background: on ? 'var(--mc-cyan)' : 'var(--mc-text-3)' }} />
                  </div>
                </button>
              );
            })}
          </div>
          {/* the five buckets — click to see one */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: 10, color: 'var(--mc-text-3)', fontWeight: 800 }}>Which kind of quarter:</span>
            {(['A', 'B', 'C', 'D', 'E', 'F', '?'] as BucketId[]).map((b) => {
              const meta = BUCKET_META[b];
              const n = bucketCounts[b] || 0;
              if (!n) return null;
              const on = bucketFilter === b;
              return (
                <button key={b} onClick={() => setBucketFilter(on ? null : b)} title={meta.blurb}
                  style={{
                    fontSize: 10, fontWeight: 800, padding: '3px 9px', borderRadius: 6, cursor: 'pointer',
                    border: `1px solid ${on ? meta.color : `${meta.color}55`}`,
                    background: on ? `${meta.color}26` : 'transparent', color: meta.color,
                  }}>
                  {b !== 'F' && b !== '?' ? `${b} · ` : ''}{meta.short} ({n})
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 9.5, color: 'var(--mc-text-3)', marginTop: 7, lineHeight: 1.55 }}>
            {funnelStop
              ? funnel.stages.find((x) => x.key === funnelStop)?.test
              : 'Each step is a filter with a stated test; the number is what survived it. Click a step or a bucket to see exactly those names — the staircase is checkable, not decorative. Every classification is on the card, with the reasons that produced it and what argued against it.'}
          </div>
        </div>
      )}

      {/* Top-tier names the size filter is holding back, named rather than
          silently dropped — and one click from being shown. */}
      {hiddenBySize.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', padding: '9px 12px', marginBottom: 10, borderRadius: 'var(--mc-radius)', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.35)' }}>
          <span style={{ fontSize: 11.5, color: 'var(--mc-text-1)' }}>
            <b style={{ color: '#F59E0B' }}>{hiddenBySize.length} BLOCKBUSTER / STRONG name{hiddenBySize.length > 1 ? 's are' : ' is'} hidden by the size filter</b> — they pass every other gate you have set and are only out because the cap chip is on <b>{String(filters.cap).toUpperCase()}</b>:{' '}
            <span style={{ fontFamily: 'ui-monospace,monospace', color: 'var(--mc-text-0)' }}>{hiddenBySize.slice(0, 14).map((e) => e.ticker).join(' · ')}{hiddenBySize.length > 14 ? ` · +${hiddenBySize.length - 14} more` : ''}</span>
          </span>
          <button onClick={() => setFilters((p) => ({ ...p, cap: 'all' }))}
            style={{ fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 7, cursor: 'pointer', border: '1px solid rgba(245,158,11,0.6)', background: 'transparent', color: '#F59E0B', whiteSpace: 'nowrap' }}>
            Show all sizes
          </button>
        </div>
      )}

      {/* ── filters row ── */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 12, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', marginBottom: 14 }}>
        <input value={filters.q}
          onChange={(e) => { setFilters((p) => ({ ...p, q: e.target.value })); setLookup({ state: 'idle' }); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && filters.q.trim()) void lookupTicker(filters.q); }}
          placeholder="Search ticker or company… (Enter to grade one that isn't here)"
          style={{ fontSize: 'var(--mc-text-xs)', padding: '6px 10px', borderRadius: 999, minWidth: 200, border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-2)', color: 'var(--mc-text-0)' }} />
        <span style={rowLabel}>Cap</span>
        {[['all', 'All'], ['smid', 'Small+Mid'], ['small', 'Small'], ['mid', 'Mid'], ['large', 'Large'], ['mega', 'Mega']].map(([v, l]) => (
          <button key={v} onClick={() => setFilters((p) => ({ ...p, cap: v }))} style={chip(filters.cap === v)}>{l} ({countWith({ cap: v })})</button>
        ))}
        <span style={rowLabel}>Tier</span>
        {['BLOCKBUSTER', 'STRONG'].map((t) => {
          const on = (filters.tiers || []).includes(t);
          return (
            <button key={t} onClick={() => setFilters((p) => {
              const cur = p.tiers || [];
              const next = on ? cur.filter((x) => x !== t) : [...cur, t];
              return { ...p, tiers: next.length ? next : null };
            })} style={chip(on, t === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981')}>{t} ({countWith({ tiers: [t] })})</button>
          );
        })}
        <span style={rowLabel}>Sort</span>
        {([['fresh', 'Freshest'], ['score', 'Score'], ['pead', 'PEAD'], ['sales', 'Revenue'], ['eps', 'EPS'], ['drift', 'Since print'], ['mcap', 'Mkt cap'], ['pe', 'P/E'], ['addv', '$ Volume']] as Array<[SortKey, string]>).map(([v, l]) => (
          <button key={v} onClick={() => setSortKey(v)} style={chip(sort === v)}>{l}{sort === v ? (sortDir === 'desc' ? ' ▼' : ' ▲') : ''}</button>
        ))}
        <span style={{ flex: 1 }} />
        <button onClick={() => setView((v) => (v === 'cards' ? 'table' : 'cards'))} style={chip(false)}>{view === 'cards' ? '▦ Table' : '▤ Cards'}</button>
        {view === 'cards' && filtered.length > 0 && (
          <button onClick={toggleAll} style={chip(allOpen)} aria-expanded={allOpen}
            title="Open the full write-up — guidance, results, margins, balance sheet — on every card that passes the filters">
            {allOpen ? '⊟ Collapse all' : `⊞ Expand all ${filtered.length}`}
          </button>
        )}
        {/* The same control the Opportunities tab has: every summary on the
            bench at once, written from each company's own press release and
            cached with the filing, worked through a few at a time. */}
        {view === 'cards' && filtered.length > 0 && (
          <button
            onClick={() => { const next = !allAiOpen; setAllAiOpen(next); setAllAiSummaries(next); }}
            style={chip(allAiOpen)} aria-expanded={allAiOpen}
            title="Open the AI summary on every bench card — each written from that company's own press release, nothing else">
            {aiLeft > 0
              ? `✨ Reading releases… ${aiLeft} left`
              : allAiOpen ? '✨ Hide AI summaries' : `✨ AI summary all ${filtered.length}`}
          </button>
        )}
        <button onClick={exportCsv} style={chip(false)}>📊 CSV</button>
        <button onClick={() => exportTv('copy')} style={chip(copied, '#10B981')}
          title="Copy the filtered bench for TradingView, grouped ###ELITE / ###BLOCKBUSTER / ###STRONG with the real exchange prefix on every symbol">
          <Copy className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 4 }} />
          {copied ? '✓ Copied' : 'Copy → TradingView'}
        </button>
        <button onClick={() => exportTv('download')} style={chip(false)}
          title="The same grouped list as a .txt file">📈 .txt</button>
        <button onClick={() => { setFilters({ ...US_FILTER_DEFAULT, cap: 'all' }); try { localStorage.setItem(OPT_OUT_KEY, '1'); } catch {} }} style={chip(false)}>Clear filters</button>
      </div>

      {/* ── status strip ── */}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, padding: '10px 14px', borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-bg-4)', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)' }}>
        <span><b style={{ color: 'var(--mc-text-0)' }}>{entries.length}</b> on the bench</span>
        <span><b style={{ color: '#F59E0B' }}>{tierCounts.BLOCKBUSTER}</b> blockbuster</span>
        <span><b style={{ color: '#10B981' }}>{tierCounts.STRONG}</b> strong</span>
        <span><b style={{ color: 'var(--mc-text-0)' }}>{filtered.length}</b> passing filters</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: 'var(--mc-text-3)' }}>
          {sweeping ? 'reloading…' : `window ${WINDOWS.find(([, n]) => n === benchWindow)?.[0] ?? `${benchWindow} sessions`}`}
        </span>
      </div>
      {/* ── THE ANSWER WHEN A SEARCH FINDS NOTHING ───────────────────── */}
      {filters.q.trim() && filtered.length === 0 && lookup.state === 'idle' && (
        <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginBottom: 12, padding: '9px 12px', borderRadius: 'var(--mc-radius)', border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)', lineHeight: 1.6 }}>
          <b style={{ color: 'var(--mc-text-0)' }}>{filters.q.trim().toUpperCase()}</b> is not on this bench. That may be because it graded
          MIXED or AVOID — the bench only keeps BLOCKBUSTER and STRONG — or because it reported outside the window above.{' '}
          <button onClick={() => void lookupTicker(filters.q)}
            style={{ fontSize: 11, fontWeight: 800, padding: '5px 11px', borderRadius: 7, marginLeft: 2, cursor: 'pointer', border: '1px solid var(--mc-cyan)', background: 'transparent', color: 'var(--mc-cyan)' }}>
            grade it from its latest filing
          </button>
        </div>
      )}
      {lookup.state === 'busy' && (
        <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-3)', marginBottom: 12 }}>Reading its latest filing from EDGAR…</div>
      )}
      {lookup.state === 'error' && (
        <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-caution,#F59E0B)', marginBottom: 12, padding: '9px 12px', borderRadius: 'var(--mc-radius)', border: '1px solid rgba(245,158,11,0.35)' }}>
          {lookup.msg}
        </div>
      )}
      {lookup.state === 'done' && lookup.row && (
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginBottom: 7, lineHeight: 1.6 }}>
            <b style={{ color: 'var(--mc-text-0)' }}>{lookup.row.ticker}</b> graded{' '}
            <b style={{ color: lookup.row.tier === 'BLOCKBUSTER' ? '#F59E0B' : lookup.row.tier === 'STRONG' ? '#10B981' : 'var(--mc-text-2)' }}>{lookup.row.tier}</b>{' '}
            on its {lookup.row.quarter} filing of {lookup.row.filing_date}.
            {(lookup.row.tier === 'MIXED' || lookup.row.tier === 'AVOID')
              ? ' That is why it is not on the bench — only BLOCKBUSTER and STRONG are kept. The full card is below so you can see the numbers behind that call.'
              : ' It qualifies; if it is not on the bench above, the session it filed in is outside your current window — widen the window or press Reload bench.'}
            <button onClick={() => setLookup({ state: 'idle' })}
              style={{ fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 7, marginLeft: 8, cursor: 'pointer', border: '1px solid var(--mc-bg-4)', background: 'transparent', color: 'var(--mc-text-2)' }}>dismiss</button>
          </div>
          <div style={{ maxWidth: 460 }}>
            <UsEarningsCard r={lookup.row} open onToggle={() => setLookup({ state: 'idle' })} panelId="cb-lookup-card" />
          </div>
        </div>
      )}

      {/* ── WHAT THIS BENCH IS BUILT FROM ──────────────────────────────
          A book that is short because two sessions never scanned must say so.
          Without this line the only visible fact is a small number of names,
          which reads as "nothing qualified" — and the two days missing from
          the run that prompted this carried a dozen names that did. */}
      {/* A SESSION STILL BEING GRADED AND A SESSION THAT FAILED ARE DIFFERENT
          FACTS, and lumping them together is what made a working sweep read as
          a broken one: "13 could not be scanned" on thirteen days that were
          simply still in the server's queue, and which arrived a few minutes
          later. Amber and a button belong to the first kind only. */}
      {coverage && (() => {
        const grading = coverage.grading || [];
        const dead = coverage.failed || [];
        if (!dead.length && !grading.length) {
          return <div style={{ fontSize: 'var(--mc-text-xs)', marginBottom: 12, color: 'var(--mc-text-3)' }}>Built from all <b>{coverage.total}</b> sessions in the window — nothing was skipped.</div>;
        }
        return (
          <div style={{ fontSize: 'var(--mc-text-xs)', marginBottom: 12, color: dead.length ? 'var(--mc-caution, #F59E0B)' : 'var(--mc-text-3)' }}>
            Built from <b>{coverage.swept} of {coverage.total}</b> sessions.
            {grading.length > 0 && (
              <> <b style={{ color: 'var(--mc-text-1)' }}>{grading.length}</b> {grading.length > 1 ? 'are' : 'is'} still being graded
                on the server ({grading.slice(0, 5).join(', ')}{grading.length > 5 ? ` +${grading.length - 5}` : ''}) — the server takes
                cold sessions one at a time, which is the only way the heavy ones finish at all. They fold into the bench by themselves.</>
            )}
            {dead.length > 0 && (
              <> <b>{dead.length}</b> could not be scanned ({dead.slice(0, 5).join(', ')}{dead.length > 5 ? ` +${dead.length - 5}` : ''}),
                so names that reported on {dead.length > 1 ? 'those days' : 'that day'} are missing.
                {sweeping ? ' Filling the gaps now…' : (
                  <button onClick={fillGaps} style={{ ...chip(false), marginLeft: 8 }}>scan the missing sessions</button>
                )}</>
            )}
          </div>
        );
      })()}
      {sweepMsg && <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-2)', marginBottom: 12 }}>{sweepMsg}</div>}
      {backfillMsg && <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-3)', marginBottom: 12 }}>⏳ {backfillMsg}</div>}
      {/* A BENCH THAT CANNOT BE SAVED MUST SAY SO. The whole reason names went
          missing for a day was a storage failure that was caught and thrown
          away, so the page looked healthy while losing most of the book. */}
      {persistError && (
        <div style={{ fontSize: 'var(--mc-text-xs)', color: 'var(--mc-caution, #F59E0B)', marginBottom: 12, padding: '8px 12px', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 'var(--mc-radius)' }}>
          ⚠ {persistError}
        </div>
      )}

      {entries.length === 0 && (
        <div style={panel()}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>The bench is empty</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            It fills itself from graded US results, or you can rebuild it now.
          </div>
          {/* THE ACTION THE EMPTY STATE DESCRIBES HAS TO BE IN THE EMPTY STATE.
              This used to say "hit Rebuild + re-price above" — and above is a
              status strip that, on a bench with nothing in it, is a row of
              zeroes the eye skips, with the button last in a wrapping flex row.
              Right after "Clear all" the auto-sweep also greys that button out,
              so the one instruction on screen pointed at a control that was
              both hard to find and disabled. */}
          <button onClick={() => sweepWindow()} disabled={sweeping}
            style={{
              marginTop: 12, padding: '9px 16px', borderRadius: 'var(--mc-radius)',
              border: '1px solid var(--mc-cyan)', background: 'var(--mc-cyan)',
              color: '#04121A', fontWeight: 800, fontSize: 'var(--mc-text-sm)',
              cursor: sweeping ? 'default' : 'pointer', opacity: sweeping ? 0.6 : 1,
            }}>
            <RefreshCw className="w-3 h-3" style={{ display: 'inline', verticalAlign: '-2px', marginRight: 6, animation: sweeping ? 'spin 1s linear infinite' : undefined }} />
            {sweeping ? 'Rebuilding…' : `Rebuild the bench (last ${WINDOWS.find(([, n]) => n === benchWindow)?.[0] ?? `${benchWindow} sessions`})`}
          </button>
          <div style={{ marginTop: 10, color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)' }}>
            Or open <Link href="/us-earnings-opportunities" prefetch style={{ color: 'var(--mc-cyan)' }}>US Earnings Opportunities</Link> — every graded window syncs here automatically.
          </div>
        </div>
      )}
      {entries.length > 0 && filtered.length === 0 && (
        <div style={panel()}>
          <div style={{ fontWeight: 700, color: 'var(--mc-text-0)', marginBottom: 6 }}>Nothing passes the current filters</div>
          <div style={{ color: 'var(--mc-text-2)', fontSize: 'var(--mc-text-sm)' }}>
            {presetOn ? 'The Quality Preset is strict by design — open the detail filters to see which gate is doing the cutting (each chip shows how many names it would leave), or turn the preset off.' : 'Loosen a filter or clear them all.'}
          </div>
        </div>
      )}

      {view === 'cards' ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 12 }}>
          {filtered.map((e) => {
            const k = cardKey(e);
            return (
              <BenchCard key={k} e={e}
                open={openCards.has(k)} onToggle={() => toggleCard(k)}
                onRemove={() => { removeUsConviction(e.bench_key || e.ticker); reload(); }} />
            );
          })}
        </div>
      ) : (
        <BenchTable rows={filtered} sort={sort} dir={sortDir} onSort={setSortKey} onRemove={(t) => { removeUsConviction(t); reload(); }} />
      )}

      <style>{'@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}

// ─── helpers ───────────────────────────────────────────────────────────────
const rowLabel: React.CSSProperties = { color: 'var(--mc-text-3)', fontSize: 'var(--mc-text-xs)', fontWeight: 700, minWidth: 96 };

function chip(active: boolean, color = 'var(--mc-cyan)'): React.CSSProperties {
  return {
    fontSize: 'var(--mc-text-xs)', fontWeight: 700, padding: '6px 10px', borderRadius: 999, cursor: 'pointer', whiteSpace: 'nowrap',
    border: `1px solid ${active ? color : 'var(--mc-bg-4)'}`, color: active ? color : 'var(--mc-text-2)',
    backgroundColor: active ? `color-mix(in srgb, ${color} 12%, transparent)` : 'var(--mc-bg-2)',
  };
}
function panel(): React.CSSProperties {
  return { padding: 20, borderRadius: 'var(--mc-radius)', backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)' };
}
function download(name: string, text: string, mime = 'text/csv') {
  try {
    const blob = new Blob([text], { type: `${mime};charset=utf-8;` });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  } catch { /* download blocked */ }
}

function ChipRow<T extends number>({ label, value, opts, fmt, onSet, count }: {
  label: string; value: T | null; opts: T[]; fmt: (v: T) => string; onSet: (v: T | null) => void; count: (v: T | null) => number;
}) {
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <span style={rowLabel}>{label}</span>
      <button onClick={() => onSet(null)} style={chip(value == null)}>Any ({count(null)})</button>
      {opts.map((v) => (
        <button key={String(v)} onClick={() => onSet(value === v ? null : v)} style={chip(value === v)}>{fmt(v)} ({count(v)})</button>
      ))}
    </div>
  );
}

/**
 * THE BENCH CARD.
 *
 * It IS the Opportunities card — same five metric tiles, same secondary tiles,
 * same R40 / ROCE / SETUP chips, same expand panel with the guidance, the
 * four-period results and margin tables, the balance-sheet context and the
 * post-earnings setup scorecard. What the bench adds is the three things only
 * it knows: its own verdict, how the name has drifted since the print, and the
 * button that takes it off the bench. Those go in through the card's slots
 * rather than into a second card of our own, which is how the two tabs used to
 * end up showing the same company two different ways.
 *
 * The row handed to the card is the bench entry with three normalisations:
 *   • `filing_url` — the bench stores the same link under `source_url`.
 *   • `rule40` / `roce` — the stored figures, or the same computation over the
 *     stored series for an entry benched before the payload carried them. Null
 *     stays null: a name whose filing does not support either shows no chip.
 *   • the two tag arrays, which the card reads `.length` off.
 * Nothing else is touched, and nothing is invented.
 */
function BenchCard({ e, open, onToggle, onRemove }: {
  e: UsConvictionEntry; open: boolean; onToggle: () => void; onRemove: () => void;
}) {
  const v = usVerdict(e);
  const age = usFilingAgeDays(e.filing_date);
  const ds = driftState(e);
  const driftColor = ds === 'DRIFTING' ? '#EF4444' : ds === 'FADING' ? '#F59E0B' : ds === 'RUNNING' ? '#10B981' : 'var(--mc-text-3)';

  const row = useMemo(() => ({
    ...e,
    filing_url: e.source_url ?? null,
    rule40: usRule40(e),
    roce: usRoce(e),
    caveat_tags: Array.isArray(e.caveat_tags) ? e.caveat_tags : [],
    methodology_tags: Array.isArray(e.methodology_tags) ? e.methodology_tags : [],
  }), [e]);

  return (
    <UsEarningsCard
      r={row as any}
      open={open}
      onToggle={onToggle}
      panelId={`us-cb-panel-${String(e.bench_key || e.ticker).replace(/[^A-Za-z0-9_-]/g, '-')}`}
      topRight={
        <button onClick={onRemove} title="Remove from bench"
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-4)', padding: 2, lineHeight: 0 }}>
          <X className="w-3 h-3" />
        </button>
      }
      extraChips={
        <>
          {/* AN EARLIER QUARTER IS NOT A DUPLICATE CARD.
              When a benched name reports again, the outgoing quarter is kept
              under `TICKER@Q2-2026` so its beat history survives — and it then
              renders as a second, identical-looking card for the same ticker.
              Nothing on it said which quarter it was, so the bench read as
              though it had listed the same company twice. It is history, and
              it now says so before anything else on the card. */}
          {typeof e.bench_key === 'string' && e.bench_key.includes('@') && (
            <Chip text={`ARCHIVED · ${e.quarter || 'earlier quarter'}`} color="#8B5CF6" />
          )}
          <Chip text={e.tier} color={e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981'} />
          {/* The bench's own earnings-quality verdict, with the reasons behind
              it on the tooltip — the card is a scanning surface and a second
              line of prose under every one of them is what made the old bench
              card twice as tall as it needed to be. */}
          <span title={v.reasons.length ? v.reasons.join(' · ') : undefined}>
            <Chip text={v.verdictLabel} color={VERDICT_COLOR[v.verdictLabel]} />
          </span>
          {ds && ds !== 'HOLDING' && (
            <Chip text={`${ds === 'DRIFTING' ? '⚠ ' : ''}${ds} ${fmtPct(e.move_pct, 0)}`} color={driftColor} />
          )}
          {age != null && <Chip text={`·${age}d`} />}
          {/* Tradeability. Two numbers, because a small cap that cannot be
              bought in size is not an opportunity however good the print was:
              under $2M traded a day a position of any size moves the price. */}
          {e.addv_musd != null && (
            <span title="20-day median dollar volume">
              <Chip text={`$Vol $${e.addv_musd.toFixed(1)}M/d`} color={e.addv_musd < 2 ? '#EF4444' : undefined} />
            </span>
          )}
          {e.pct_from_52w_high != null && (
            <span title="Distance from the 52-week high">
              <Chip text={`52w ${fmtPct(e.pct_from_52w_high, 0)}`} color={e.pct_from_52w_high >= -15 ? undefined : '#F59E0B'} />
            </span>
          )}
        </>
      }
      /* NO subFooter. The collapsed card ENDS AT THE NARRATIVE — everything
         else (the filing links, the filed date, the full guidance, the results
         and margin tables, the balance sheet) is in the expand panel, which is
         the same panel the Opportunities tab shows. */
    />
  );
}

function BenchTable({ rows, sort, dir, onSort, onRemove }: { rows: UsConvictionEntry[]; sort: SortKey; dir: 'asc' | 'desc'; onSort: (k: SortKey) => void; onRemove: (t: string) => void }) {
  const th = (label: string, k?: SortKey, left = false): React.CSSProperties & { children?: any } => ({
    textAlign: left ? 'left' : 'right', padding: '8px 10px', fontSize: 10, fontWeight: 800, whiteSpace: 'nowrap',
    color: k && sort === k ? 'var(--mc-cyan)' : 'var(--mc-text-3)', borderBottom: '1px solid var(--mc-bg-4)',
    cursor: k ? 'pointer' : 'default', position: 'sticky', top: 0, backgroundColor: 'var(--mc-bg-1)', zIndex: 1,
  });
  const td: React.CSSProperties = { textAlign: 'right', padding: '7px 10px', fontSize: 'var(--mc-text-xs)', color: 'var(--mc-text-1)', whiteSpace: 'nowrap' };
  const H = ({ label, k, left }: { label: string; k?: SortKey; left?: boolean }) => (
    <th style={th(label, k, left)} onClick={() => k && onSort(k)}>{label}{k && sort === k ? (dir === 'desc' ? ' ▼' : ' ▲') : ''}</th>
  );
  return (
    <div style={{ overflow: 'auto', maxHeight: '75vh', borderRadius: 'var(--mc-radius)', border: '1px solid var(--mc-bg-4)', backgroundColor: 'var(--mc-bg-1)' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1480 }}>
        <thead>
          <tr>
            <H label="Ticker" left /><H label="Company" left /><H label="Tier" left />
            <th style={th('Quadrant', undefined, true)}
              title="Quality × Inflection — what the business IS against what it is BECOMING. Blank on an entry benched before the second axis existed.">Quadrant</th>
            <th style={th('Q · I')} title="Quality score · Inflection score, each out of 100.">Q · I</th>
            <H label="Verdict" left />
            <H label="Rev YoY" k="sales" /><H label="EPS YoY" k="eps" /><th style={th('OPM Δ')}>OPM Δ</th><th style={th('CFO/NI')}>CFO/NI</th>
            <th style={th('R40')} title="Revenue growth % + FCF margin %, trailing twelve months. Blank where the filing does not support it.">R40</th>
            <th style={th('ROCE')} title="TTM operating income ÷ (total assets − current liabilities). Blank for a filer with no classified balance sheet.">ROCE</th>
            <H label="PEAD" k="pead" /><H label="Score" k="score" /><th style={th('RS')}>RS</th><th style={th('Stg')}>Stg</th>
            <H label="$Vol/d" k="addv" /><H label="Mkt cap" k="mcap" /><H label="P/E" k="pe" /><th style={th('D1')}>D1</th>
            <H label="Since" k="drift" /><H label="Filed" k="fresh" left /><th style={th('')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const v = usVerdict(e);
            const opmD = (e.opm_pct != null && e.opm_prev_pct != null) ? e.opm_pct - e.opm_prev_pct : null;
            const tierColor = e.tier === 'BLOCKBUSTER' ? '#F59E0B' : '#10B981';
            const ds = driftState(e);
            const r40 = usRule40(e);
            const roce = usRoce(e);
            const qm = e.quadrant ? QUADRANT_META[e.quadrant] : null;
            return (
              <tr key={`${e.ticker}-${e.filing_date}`} style={{ borderBottom: '1px solid var(--mc-bg-3)' }}>
                <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: 'var(--mc-text-0)' }}>
                  {e.source_url ? <a href={e.source_url} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{e.ticker}</a> : e.ticker}
                </td>
                <td style={{ ...td, textAlign: 'left', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }} title={e.company}>{e.company}</td>
                <td style={{ ...td, textAlign: 'left', color: tierColor, fontWeight: 800 }}>{e.tier}</td>
                {/* A blank cell is the honest rendering of "this entry carries
                    no quadrant"; a dash or a zero would both read as a
                    measurement that was actually taken. */}
                <td style={{ ...td, textAlign: 'left', fontWeight: 800, color: qm ? qm.color : undefined }}
                  title={e.quadrant ? quadrantTitle(e.quadrant, e.quality_score ?? null, e.inflection_score ?? null) : undefined}>
                  {qm ? `${qm.icon} ${e.quadrant}` : ''}
                </td>
                <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: 'var(--mc-text-2)' }}>
                  {e.quality_score != null || e.inflection_score != null
                    ? `${e.quality_score ?? '—'} · ${e.inflection_score ?? '—'}` : ''}
                </td>
                <td style={{ ...td, textAlign: 'left', color: VERDICT_COLOR[v.verdictLabel], fontWeight: 800 }}>{v.verdictLabel}</td>
                <td style={td}>{fmtPct(e.sales_yoy_pct)}</td>
                <td style={td}>{fmtPct(e.eps_yoy_pct)}</td>
                <td style={td}>{opmD != null ? `${opmD >= 0 ? '+' : ''}${opmD.toFixed(1)}pp` : '—'}</td>
                <td style={td}>{e.cfo_to_pat_ratio != null ? e.cfo_to_pat_ratio.toFixed(2) : (e.is_financial ? 'n/a' : '—')}</td>
                {/* A blank cell is the honest rendering of "the filing does not
                    support this figure"; a zero or a dash would both read as a
                    measurement that was actually taken. */}
                {/* The quarter/TTM basis is shown with the same superscript badge
                    and the same words as the card's R40 chip (see
                    us-earnings-card.tsx) — the "·q" suffix this used to print
                    read as a typo on both surfaces. */}
                <td style={{ ...td, color: r40 == null ? undefined : r40.passes ? '#10B981' : undefined, fontWeight: r40?.passes ? 800 : undefined }}
                  title={r40 == null ? undefined : rule40Title(r40 as Rule40Like)}>
                  {r40?.score ?? ''}{r40 && r40.basis === 'quarter' ? <QuarterBasisBadge /> : null}
                </td>
                <td style={{ ...td, color: roce == null ? undefined : roce.pct != null && roce.pct >= 20 ? '#10B981' : undefined }}
                  title={roce == null ? undefined : `TTM EBIT $${roce.ebit_ttm_musd}M ÷ capital employed $${roce.capital_employed_musd}M`}>
                  {roce?.pct != null ? `${roce.pct.toFixed(0)}%` : ''}
                </td>
                <td style={td}>{e.pead_score ?? '—'}</td>
                <td style={{ ...td, fontWeight: 800, color: 'var(--mc-text-0)' }}>{e.composite_score}</td>
                <td style={td}>{e.rs_rating ?? '—'}</td>
                <td style={{ ...td, color: e.stage === 4 ? '#EF4444' : e.stage === 2 ? '#10B981' : undefined }}>{e.stage ?? '—'}</td>
                <td style={{ ...td, color: (e.addv_musd ?? 0) < 2 ? '#EF4444' : undefined }}>{e.addv_musd != null ? `$${e.addv_musd.toFixed(1)}M` : '—'}</td>
                <td style={td}>{fmtUsd(e.market_cap_musd)}</td>
                <td style={td}>{e.pe ?? '—'}</td>
                <td style={{ ...td, color: (e.d1_pct ?? 0) >= 0 ? '#10B981' : '#EF4444' }}>{fmtPct(e.d1_pct, 1)}</td>
                <td style={{ ...td, color: ds === 'DRIFTING' ? '#EF4444' : ds === 'FADING' ? '#F59E0B' : (e.move_pct ?? 0) >= 0 ? '#10B981' : 'var(--mc-text-2)', fontWeight: ds === 'DRIFTING' ? 800 : undefined }}>{fmtPct(e.move_pct, 1)}</td>
                <td style={{ ...td, textAlign: 'left', color: 'var(--mc-text-3)' }}>{e.filing_date}</td>
                <td style={td}><button onClick={() => onRemove(e.ticker)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--mc-text-4)' }}><X className="w-3 h-3" /></button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
