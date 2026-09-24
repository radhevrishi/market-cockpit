// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — RESEARCH TRIAGE.                        (zzz770, AG-B)
//
// An investor research-triage page: "Bloomberg event monitor + fundamental
// research triage + thesis evidence tracker", not a filing dump. The reader
// scans ten names in about a minute and knows which two or three deserve deep
// research.
//
// THE PAGE RENDERS ONLY FROM ResearchView (src/lib/ai-gainers/research-view.ts).
// It prefers `research.view` when the GET research response carries one and
// otherwise builds it here, client-side, with buildResearchView() from what
// the page already holds: the day's findings, the scanned board, the
// filed-result rows, the book, the errors and the session.
//
// WHAT THIS PAGE WILL NOT DO (unchanged since zzz713):
//   · Rank by percentage gain. Price is context, never the ranking.
//   · Show a trade instruction. The only words are Review / Investigate /
//     Monitor / Thesis evidence / No catalyst / Negative evidence.
//   · Invent a figure. A missing value is printed "Not disclosed"/"Unknown".
//   · Spend a model read without a click: "▶ Research catalysts" and
//     "↻ Re-score" run only on click; the rules-version re-score on open is
//     the zero-spend `rescoreOnly` path.
//
// The raw sweep tables, the scanned board and the filed-result rows (with
// their score arithmetic) are still here, collapsed under "Evidence /
// technical details" at the bottom. ?demo=1 renders a dev fixture instead of
// calling the APIs.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readJsonResponse, describeFetchError } from '@/lib/ai-gainers/client-fetch';
import { boardCoverage } from '@/lib/ai-gainers/research-present';
import { buildResearchView, type ResearchView } from '@/lib/ai-gainers/research-view';
import { ResearchTriage } from '@/components/ai-gainers/ResearchTriage';

type Mkt = 'IN' | 'US';
type TechTab = 'sweep' | 'scanned' | 'filed' | 'notes';

const C = {
  bg: 'var(--mc-bg-1)', bg2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  // zzz766 — one step brighter than before: --mc-text-4 on the dark panel is
  // under 4:1 contrast and the owner reads this page for minutes at a time.
  text: 'var(--mc-text-1)', dim: 'var(--mc-text-2)', faint: 'var(--mc-text-3)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#F59E0B',
  cyan: 'var(--mc-cyan)', violet: '#A78BFA',
};


interface Comp { key: string; label: string; points: number; max: number; because: string }
interface Row {
  ticker: string; company: string | null; market: Mkt;
  price_change_pct: number | null; volume_ratio: number | null;
  catalyst: string; information_status: string;
  materiality: string; structural_duration: string;
  evidence: Array<{ url: string; tier: 1 | 2 | 3; published?: string | null }>;
  claims: Array<{ text: string; sourceUrl: string; kind: string }>;
  research_priority: number;
  quadrant: 'high_information' | 'potentially_overlooked' | 'momentum_speculative' | 'early_unclear';
  components: Comp[]; penalties: Comp[];
}
interface Session { date: string; state: 'open' | 'pre_open' | 'closed' | 'weekend' | 'holiday'; isToday: boolean; label: string }
interface Payload {
  ok: boolean; market: Mkt; generated_at: string; served_from_cache?: boolean; session?: Session | null;
  funnel: { scanned: number; withCatalyst: number; structural: number; queue: number };
  gainers_scanned: number; graded_available: number;
  notes: string[]; queue: Row[];
  source_list?: {
    file: string | null; url?: string | null; synced_at: string | null; window: string | null;
    rows: number; total_reported?: number | null; pages_read?: number;
    error?: string | null; matched_to_a_filing: number;
    large_cap_min_cr?: number;
    excluded_large_caps?: Array<{ ticker: string; company: string | null; move_pct: number | null; market_cap: number | null }>;
    proxy_cache_age_ms?: number | null;
    // US only (zzz766)
    as_of?: { label: string; stale: boolean; intraday: boolean; synced_et: string; session: string } | null;
    sync_note?: string | null;
    excluded?: Array<{ ticker: string; exchange: string; reason: string; kind: string }>;
  };
  scanned?: Array<{ ticker: string; company: string | null; move_pct: number | null;
    volume_ratio: number | null; matched: boolean; volume?: number | null; price?: number | null; market_cap?: number | null }>;
}

// The quadrant is a DESCRIPTION OF A MISMATCH. Each label says what the
// mismatch is, and none of them says what to do about it.
const QUAD: Record<Row['quadrant'], { name: string; color: string; meaning: string }> = {
  high_information: {
    name: 'High information', color: C.green,
    meaning: 'Material news and a large move. The market has seen it — less of the move is left, but the fact is real.',
  },
  potentially_overlooked: {
    name: 'Possibly overlooked', color: C.cyan,
    meaning: 'Material news, muted price. The reaction may not yet reflect what was filed. This is where research pays.',
  },
  momentum_speculative: {
    name: 'Momentum / speculative', color: C.red,
    meaning: 'A large move with no material catalyst behind it. Most likely technical or sentiment. Scored low on purpose.',
  },
  early_unclear: {
    name: 'Early / unclear', color: C.faint,
    meaning: 'Neither the news nor the move is decisive yet. Not enough to act on, not enough to dismiss.',
  },
};

const TIER: Record<number, { label: string; color: string }> = {
  1: { label: 'Primary filing', color: C.green },
  2: { label: 'Reputable secondary', color: C.amber },
  3: { label: 'Unverified — alert only', color: C.red },
};

const pretty = (s: string) => String(s || '').replace(/_/g, ' ');

const pct = (v: number | null) => (typeof v === 'number' ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—');

const MKT_KEY = 'mc:ai-gainers:market';

/** The rows a sweep / re-score is told about: the board, with whether a
 *  filed result stands behind each name (a recent listing that has one is
 *  not a "listing artifact"). (zzz769) */
const boardRows = (scanned: Payload['scanned']) => (scanned || []).map((g) => ({ ticker: g.ticker, company: g.company, move_pct: g.move_pct, volume: g.volume ?? null, price: g.price ?? null, market_cap: g.market_cap ?? null, perf: (g as any).perf ?? null, filed_result: !!g.matched }));

export default function AiGainersPage() {
  const [market, setMarketState] = useState<Mkt>('US');
  // The URL / last choice is read once on mount, BEFORE the first load, so a
  // ?market=IN deep link does not first load (and discard) the US board.
  const [ready, setReady] = useState(false);
  const [demo, setDemo] = useState<ResearchView | null>(null);
  useEffect(() => {
    let m: string | null = null;
    let isDemo = false;
    try {
      const q = new URLSearchParams(window.location.search);
      m = q.get('market');
      isDemo = q.get('demo') === '1';
    } catch { m = null; }
    if (!m) { try { m = window.localStorage.getItem(MKT_KEY); } catch { m = null; } }
    if (m && m.toUpperCase() === 'IN') setMarketState('IN');
    if (isDemo) {
      // Dev fixture only — dynamically imported so it never ships in the
      // normal page chunk, and no API (and no model read) is called.
      import('@/components/ai-gainers/__fixture__').then((mod) => { setDemo(mod.DEMO_VIEW); setLoading(false); }).catch(() => setReady(true));
      return;
    }
    setReady(true);
  }, []);
  const setMarket = useCallback((m: Mkt) => {
    setMarketState(m);
    try { window.localStorage.setItem(MKT_KEY, m); } catch { /* per-viewer convenience only */ }
  }, []);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [techOpen, setTechOpen] = useState(false);
  const [techTab, setTechTab] = useState<TechTab>('sweep');
  // ── THE CATALYST SWEEP.                                         (zzz741)
  // Runs on a click (zzz767 — it spends model reads): every name on the board is researched
  // in ~40s chunks and persisted server-side, so a reload resumes rather than
  // restarts. Coverage is a fraction and it is printed.
  const [research, setResearch] = useState<ResearchPayload | null>(null);
  const [sweeping, setSweeping] = useState(false);
  // Every load and every sweep carries a generation number. Switching market
  // bumps it, so a slow answer for the OLD market can never land on the new
  // one — and a sweep still finishing for the old market no longer blocks
  // the new market's sweep from starting. (zzz766)
  const genRef = useRef(0);
  const sweepGenRef = useRef(-1);
  // Set when this page open re-scored the day's stored findings under the
  // current rules (no model read). (zzz769)
  const [rescored, setRescored] = useState<{ n: number; failed: number } | null>(null);
  const [rescoring, setRescoring] = useState(false);

  // ── AUTOMATIC RE-SCORE — NO AI.                                  (zzz769)
  // Findings stored under older rules are re-classified and re-scored from
  // the filings already fetched and the model reads already cached. The
  // server's `rescoreOnly` path cannot make a model read, add a name or
  // touch the day's read count, so it is safe on page open.
  const autoRescore = useCallback(async (m: Mkt, scanned: Payload['scanned'], gen: number) => {
    if (sweepGenRef.current === gen) return;
    sweepGenRef.current = gen;
    setSweeping(true); setRescoring(true);
    let total = 0, failed = 0;
    try {
      for (let i = 0; i < 25 && genRef.current === gen; i++) {
        let r: Response;
        try {
          r = await fetch('/api/v1/ai-gainers/research', {
            method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
            body: JSON.stringify({ market: m, rescoreOnly: true, rows: boardRows(scanned), budget_ms: 40_000 }),
            signal: AbortSignal.timeout(75_000),
          });
        } catch (e) { throw new Error(describeFetchError(e, 'The re-score')); }
        const res = await readJsonResponse<ResearchPayload & { rescored_now?: number; rescore_failed?: number }>(r, 'The re-score');
        if (!res.ok || !res.json) throw new Error(res.error || 'The re-score did not answer.');
        if (genRef.current !== gen) return;
        setResearch(res.json);
        total += res.json.rescored_now || 0;
        failed = res.json.rescore_failed || 0;
        if (!res.json.stale_rules || !res.json.rescored_now) break;
      }
      if (genRef.current === gen && total > 0) setRescored({ n: total, failed });
    } catch (e: any) {
      if (genRef.current !== gen) return;
      const msg = `Automatic re-score with the current rules did not complete (no AI was used): ${String(e?.message || e)}`;
      setResearch((cur) => cur ? { ...cur, error: msg } : cur);
    } finally {
      if (sweepGenRef.current === gen) sweepGenRef.current = -1;
      if (genRef.current === gen) { setSweeping(false); setRescoring(false); }
    }
  }, []);

  const sweep = useCallback(async (m: Mkt, scanned: Payload['scanned'], gen: number, reprocess = false, retryFailed = false) => {
    if (sweepGenRef.current === gen) return;          // this generation is already sweeping
    sweepGenRef.current = gen;
    setSweeping(true);
    try {
      const rows = boardRows(scanned);
      const pass = async (retry: boolean, first: boolean): Promise<ResearchPayload | null> => {
        let last: ResearchPayload | null = null;
        // A retry of failed sources is bounded to two calls: a source still
        // refusing after that is reported again, not hammered. (zzz773)
        for (let i = 0; i < (retry ? 2 : 40) && genRef.current === gen; i++) {
          let r: Response;
          try {
            r = await fetch('/api/v1/ai-gainers/research', {
              method: 'POST', headers: { 'content-type': 'application/json' }, cache: 'no-store',
              body: JSON.stringify({ market: m, rows: first && i === 0 ? rows : [], budget_ms: 40_000, ...(first && i === 0 && reprocess ? { reprocess: true } : {}), ...(retry ? { retry_failed: true } : {}) }),
              signal: AbortSignal.timeout(75_000),
            });
          } catch (e) { throw new Error(describeFetchError(e, 'The research service')); }
          const res = await readJsonResponse<ResearchPayload & { researched_now?: number }>(r, 'The research service');
          if (!res.ok || !res.json) throw new Error(res.error || 'The research service did not answer.');
          if (genRef.current !== gen) return null;
          setResearch(res.json);
          last = res.json;
          const failedLeft = Object.values(res.json.findings || {}).some((f) => f.status === 'source_failed');
          if (retry ? (res.json.researched_now === 0 || !failedLeft) : (!res.json.remaining || res.json.researched_now === 0)) break;
        }
        return last;
      };
      const out = await pass(retryFailed, true);
      // A source that refused under the first burst usually answers a few
      // seconds later: one automatic retry pass, so "source failed" is what
      // is left after trying twice, not after one throttled request.
      if (!retryFailed && out && genRef.current === gen && Object.values(out.findings || {}).some((f) => f.status === 'source_failed')) {
        await new Promise((r) => setTimeout(r, 3_000));
        await pass(true, false);
      }
    } catch (e: any) {
      if (genRef.current !== gen) return;
      const msg = String(e?.message || e);
      setResearch((cur) => cur ? { ...cur, error: msg } : { ok: false, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, error: msg });
    } finally {
      if (sweepGenRef.current === gen) sweepGenRef.current = -1;
      if (genRef.current === gen) setSweeping(false);
    }
  }, []);

  const load = useCallback(async (m: Mkt, fresh = false) => {
    const gen = ++genRef.current;
    setLoading(true); setErr(null);
    try {
      let r: Response;
      try {
        r = await fetch(`/api/v1/ai-gainers?market=${m}&limit=15${fresh ? '&fresh=1' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(90_000) });
      } catch (e) { throw new Error(describeFetchError(e, 'The gainers scan')); }
      const res = await readJsonResponse<Payload>(r, 'The gainers scan');
      if (!res.ok || !res.json) throw new Error(res.error || 'The gainers scan did not answer.');
      if (genRef.current !== gen) return;
      const j = res.json;
      setData(j);
      // What is already researched for this session shows immediately; the
      // sweep then fills the rest. A "Rescan" does not re-research.
      try {
        const rr = await fetch(`/api/v1/ai-gainers/research?market=${m}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
        const rres = await readJsonResponse<ResearchPayload>(rr, 'The research service');
        if (genRef.current !== gen) return;
        if (rres.ok && rres.json) {
          setResearch(rres.json);
          // Stored under older rules → re-score now, free (zzz769).
          if ((rres.json.stale_rules ?? 0) > 0) void autoRescore(m, j.scanned || [], gen);
        } else {
          // A store that could not be read is said, not shown as "nothing
          // researched yet". (zzz769)
          setResearch({ ok: false, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, error: `Today's stored research could not be read: ${rres.error || 'no answer'}. Nothing is lost — press ↻ Rescan to try again.` });
        }
      } catch (e) {
        if (genRef.current === gen) setResearch({ ok: false, coverage: { researched: 0, total: 0, pct: 0, byStatus: {} }, findings: {}, remaining: 0, error: `Today's stored research could not be read: ${describeFetchError(e, 'The research service')}` });
      }
      // The sweep spends model reads, so it runs only on a click — opening
      // the page is free. What was already researched today shows above. (zzz767)
    } catch (e: any) {
      if (genRef.current !== gen) return;
      setErr(String(e?.message || 'The gainers pipeline did not answer.'));
      setData(null);
    } finally { if (genRef.current === gen) setLoading(false); }
  }, [autoRescore]);

  // A market switch clears the previous market's board at once: showing US
  // rows under the India chip while India loads is a wrong answer, not a
  // loading state. (zzz766)
  useEffect(() => {
    if (!ready || demo) return;
    setData(null); setResearch(null); setSweeping(false); setRescored(null); setRescoring(false); load(market);
  }, [market, load, ready, demo]);

  // The filed-result rows as the API ranked them — never re-sorted here.
  const rows = data?.queue || [];

  // ── COVERAGE OF THE CURRENT BOARD.                               (zzz769)
  const board = useMemo(() => (data?.scanned || []).map((g) => String(g.ticker).toUpperCase()), [data]);
  const bcov = useMemo(
    () => (board.length ? boardCoverage(board, research?.findings || {}, research?.excluded_large_caps || []) : null),
    [board, research],
  );
  const boardSet = useMemo(() => (bcov ? new Set(board.filter((t) => !(research?.excluded_large_caps || []).includes(t))) : null), [bcov, board, research]);
  const covShown = bcov || (research ? { researched: research.coverage.researched, total: research.coverage.total } : null);
  const filedTickers = useMemo(() => new Set(rows.map((r) => r.ticker.toUpperCase())), [rows]);

  // ── THE RESEARCH VIEW.                                           (zzz770)
  // Which session the board describes is stated, never assumed: a screen read
  // after the close, overnight or on a weekend is the LAST session's move.
  const session = useMemo(() => {
    if (!data) return null;
    const s = data.session || research?.session || null;
    const asOf = data.source_list?.as_of || null;
    const live = s ? s.isToday && s.state === 'open' : !!(asOf && asOf.intraday && !asOf.stale);
    return {
      date: s?.date || research?.date || null,
      scanAt: data.generated_at || null,
      status: live ? 'Live' : 'Last completed session',
      cached: !!data.served_from_cache,
    };
  }, [data, research]);

  const built = useMemo((): { view: ResearchView | null; error: string | null } => {
    if (demo) return { view: demo, error: null };
    if (!data) return { view: null, error: null };
    if (research?.view && research.view.summary) return { view: { ...research.view, session: session || research.view.session }, error: null };
    try {
      const findings = Object.fromEntries(Object.entries(research?.findings || {})
        .filter(([, f]) => !boardSet || boardSet.has(String(f.ticker).toUpperCase()))) as any;
      const holdings = Object.values(research?.findings || {}).filter((f) => f.holding).map((f) => String(f.ticker).toUpperCase());
      const view = buildResearchView({
        market,
        findings,
        board: (data.scanned || []).map((g) => ({ ticker: g.ticker, company: g.company, move_pct: g.move_pct, market_cap: g.market_cap ?? null, perf: (g as any).perf ?? null, turnover: (g as any).turnover ?? null })),
        filedResults: rows,
        holdings,
        errors: research?.errors || [],
        session: session || undefined,
      });
      return { view, error: null };
    } catch (e: any) {
      return { view: null, error: String(e?.message || e) };
    }
  }, [demo, data, research, session, boardSet, market, rows]);
  const view = built.view;

  const researched = Object.keys(research?.findings || {}).length > 0;
  const missing = bcov ? bcov.missing.length : 0;

  const toolbar = (
    <>
      <span style={{ display: 'inline-flex', border: `1px solid ${C.border}`, borderRadius: 999, overflow: 'hidden' }}>
        {(['IN', 'US'] as Mkt[]).map((m) => (
          <button key={m} type="button" onClick={() => setMarket(m)} disabled={!!demo}
            style={{ fontSize: 12, fontWeight: 800, padding: '4px 12px', border: 'none', cursor: demo ? 'default' : 'pointer',
              background: market === m ? `color-mix(in srgb, ${C.cyan} 16%, transparent)` : 'transparent', color: market === m ? C.cyan : C.dim }}>
            {m === 'US' ? '🇺🇸 USA' : '🇮🇳 India'}
          </button>
        ))}
      </span>
      {data && !sweeping && missing > 0 && (() => {
        // Every board name without a finding. Runs only on the click. (zzz767/769)
        const fresh = !research || research.coverage.total === 0;
        return (
          <button type="button" onClick={() => sweep(market, data.scanned || [], genRef.current)}
            title={`Reads the filings behind each move with the AI model. Runs only when you click.${fresh ? '' : ` Not yet researched: ${bcov!.missing.slice(0, 30).join(', ')}${missing > 30 ? '…' : ''}`}`}
            style={{ fontSize: 12, fontWeight: 800, padding: '4px 12px', borderRadius: 999, border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan, cursor: 'pointer' }}>
            ▶ Research catalysts · {missing} {fresh ? `name${missing === 1 ? '' : 's'}` : `new name${missing === 1 ? '' : 's'}`} (uses AI)
          </button>
        );
      })()}
      {data && !sweeping && missing === 0 && researched && (
        <button type="button" onClick={() => sweep(market, data.scanned || [], genRef.current, true)}
          title="Re-researches today's names from scratch with the current rules. Filings already model-read come from the cache; a filing the current rules newly choose may be model-read (within the daily ceiling). Stored findings under older rules are already re-scored automatically, without AI, when the page opens."
          style={{ fontSize: 12, fontWeight: 700, padding: '4px 11px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer' }}>
          ↻ Re-score today with current rules
        </button>
      )}
      {sweeping && (
        <span style={{ fontSize: 12, color: C.cyan, fontWeight: 700 }}>
          {rescoring ? 'Re-scoring with current rules (no AI)…' : `Researching ${covShown ? `${covShown.researched}/${covShown.total}` : ''}…`}
        </span>
      )}
      {covShown && covShown.total > 0 && !sweeping && (
        <span style={{ fontSize: 12, color: C.faint }} title={`Research completion, not catalysts found: ${covShown.researched} of the ${covShown.total} small/mid-cap gainers have had their filings researched. ${board.length > covShown.total ? `The other ${board.length - covShown.total} of the ${board.length} scanned are large caps (≥ ₹${(research?.large_cap_min_cr ?? 100000).toLocaleString('en-IN')} Cr), excluded from catalyst research.` : ''}`}>Catalyst research {covShown.researched}/{covShown.total} small/mid caps{board.length > covShown.total ? ` · ${board.length - covShown.total} large caps excluded` : ''}</span>
      )}
      {!sweeping && rescored && (
        <span title="Findings stored under older rules were re-classified and re-scored from filings already fetched and model reads already cached. No model read was made." style={{ fontSize: 12, color: C.faint }}>
          Re-scored with current rules (no AI used){rescored.failed ? ` · ${rescored.failed} kept as stored (source unreachable)` : ''}
        </span>
      )}
    </>
  );

  const notice = (
    <>
      {demo && (
        <div style={{ fontSize: 12, fontWeight: 800, color: C.violet, border: `1px dashed ${C.violet}`, borderRadius: 8, padding: '6px 10px' }}>
          DEMO DATA (?demo=1) — illustrative fixture for layout checks. No API was called.
        </div>
      )}
      {data && !demo && research && !researched && !sweeping && !research.error && (
        <div style={{ fontSize: 13, color: C.dim, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px' }}>
          Catalyst research has not run for this session yet, so events are not classified. <b style={{ color: C.text }}>▶ Research catalysts</b> reads the filings behind each move — it runs only when you click, because it uses AI reads.
        </div>
      )}
      {research?.error && !demo && (
        <div role="alert" style={{ fontSize: 13, color: C.amber, background: C.bg, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '8px 12px' }}>
          {research.error}{' '}
          {!sweeping && data && (
            <button type="button" onClick={() => sweep(market, data.scanned || [], genRef.current)} style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer' }}>↻ Retry research (uses AI)</button>
          )}
        </div>
      )}
      {built.error && (
        <div role="alert" style={{ fontSize: 13, color: C.amber, background: C.bg, border: `1px solid ${C.amber}`, borderRadius: 8, padding: '8px 12px' }}>
          The research view could not be built: {built.error}. The raw tables are under “Evidence / technical details” below.
        </div>
      )}
    </>
  );

  const techTabs: Array<[TechTab, string]> = [['sweep', 'Full catalyst sweep'], ['scanned', 'Scanned board'], ['filed', `Filed results${rows.length ? ` (${rows.length})` : ''}`], ['notes', 'Method notes']];
  const technical = data && !demo ? (
    <section style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.bg, padding: '8px 12px' }}>
      <button type="button" onClick={() => setTechOpen((o) => !o)} aria-expanded={techOpen}
        style={{ all: 'unset', cursor: 'pointer', fontSize: 13, fontWeight: 900, letterSpacing: 0.5, color: C.dim }}>
        {techOpen ? '▾' : '▸'} EVIDENCE / TECHNICAL DETAILS <span style={{ fontWeight: 500, color: C.faint, letterSpacing: 0 }}>— full filing sweep, scanned board, filed-result scores, method notes</span>
      </button>
      {techOpen && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {techTabs.map(([k, l]) => <Chip key={k} on={techTab === k} onClick={() => setTechTab(k)} color={C.violet}>{l}</Chip>)}
          </div>
          {techTab === 'sweep' && (
            <ResearchLevel research={research} sweeping={sweeping} market={market} board={boardSet} bcov={bcov} filedTickers={filedTickers} rescored={rescored}
              onResume={() => data && sweep(market, data.scanned || [], genRef.current)}
              onRescore={() => data && sweep(market, data.scanned || [], genRef.current, true)}
              onRetryFailed={() => data && sweep(market, data.scanned || [], genRef.current, false, true)} />
          )}
          {techTab === 'scanned' && <ScannedLevel data={data} />}
          {techTab === 'filed' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, color: C.faint }}>
                Filed results behind today&rsquo;s gainers — context. A result filed weeks ago explains a re-rating, not today&rsquo;s print.
              </div>
              {rows.length === 0 && <div style={{ fontSize: 12, color: C.dim }}>No filed result stands behind any gainer on this board.</div>}
              {rows.map((r) => (
                <EventCard key={r.ticker} r={r} compact={false}
                  open={!!open[r.ticker]} onToggle={() => setOpen((o) => ({ ...o, [r.ticker]: !o[r.ticker] }))} />
              ))}
            </div>
          )}
          {techTab === 'notes' && (
            <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
              {(data.notes || []).map((n, i) => <div key={i}>· {n}</div>)}
            </div>
          )}
        </div>
      )}
    </section>
  ) : null;

  const asOf = data?.source_list?.as_of;
  const sessionNote = market === 'US' && asOf
    ? `${asOf.stale ? '⚠ ' : ''}${asOf.label} — the US move is the 1-week export column.`
    : market === 'IN' && data?.session && data.session.state === 'open' ? 'Moves are intraday and will change until 15:30 IST.' : null;

  return (
    <div style={{ padding: '16px 16px 28px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 1480, minWidth: 0, boxSizing: 'border-box' }}>
      {!view && (
        <header>
          <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: 0.8, color: C.text }}>AI DAILY GAINERS</h1>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>Fundamental events behind today&rsquo;s unusual moves — ranked by research value, not return.</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>{toolbar}</div>
        </header>
      )}

      {loading && !data && !demo && (
        <div style={{ fontSize: 13, color: C.dim, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
          Scanning the {market === 'IN' ? 'India (screener.in)' : 'US'} gainers list and matching it to filings… this can take up to a minute on a cold start.
        </div>
      )}
      {err && (
        <div role="alert" style={{ fontSize: 13, color: C.text, lineHeight: 1.55, background: C.bg,
          border: `1px solid ${C.amber}`, borderRadius: 10, padding: '12px 14px' }}>
          <b style={{ color: C.amber }}>The gainers scan did not complete.</b> {err}
          <div style={{ marginTop: 8 }}>
            <button type="button" onClick={() => load(market)} style={{ fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
              border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer' }}>↻ Retry</button>
          </div>
        </div>
      )}

      {view && (
        <ResearchTriage view={view} market={demo ? 'IN' : market} toolbar={toolbar} notice={notice}
          onRescan={demo ? undefined : () => load(market, true)} rescanning={loading}
          sessionNote={sessionNote} technical={technical} />
      )}
      {!view && data && (<>{notice}{technical}</>)}
    </div>
  );
}

// ── Catalyst research payload + view ─────────────────────────────── (zzz741)
interface ScoreComponents {
  freshness: number; materiality: number; materialityRaw?: number; materialityConfidence?: number;
  transmission: number; persistence: number; sourceMult: number; pricedIn: number; pricingAdj?: number;
  base?: number; netUncapped?: number; caps?: string[];
  evidence?: 'DOCUMENT_VERIFIED' | 'SUMMARY_ONLY' | 'UNVERIFIED' | 'SOURCE_UNAVAILABLE' | 'NO_RELEVANT_FILING';
  pricing?: { state: string; text: string; adj: number };
  response?: { d1: number | null; m1: number | null; m3: number | null; sinceFiling: number | null; preFiling20: number | null; sessionsSinceFiling: number | null };
}
interface Finding {
  ticker: string; company: string | null; movePct: number | null; marketCap: number | null; turnover: number | null;
  status: string; category: string | null; stage: string | null; headline: string | null; evidenceQuote: string | null;
  sourceUrl: string | null; sourceDate: string | null; ageDays: number | null; valueStated: number | null; valuePctMcap: number | null;
  net: number | null; components: ScoreComponents | null;
  verdict: string | null; returns: { m1: number | null; m3: number | null; m6: number | null; y1: number | null; history: number } | null;
  bandPrint: boolean; bandLevel: number | null; listingDays: number | null; routine: string[]; filingsInWindow: number; windowDays: number;
  holding: boolean; notes: string[]; modelRead: boolean; sources: string[];
  news?: {
    items: Array<{ title: string; url: string; date: string; source: string; themes: string[] }>;
    themes: Array<{ theme: string; label: string; count: number; firstDate: string; lastDate: string }>;
    narrative: { theme: string; label: string; count: number; days: number; firstDate: string; lastDate: string; lead: string } | null;
    windowDays: number; fetched: number; query: string;
  } | null;
}
interface ResearchPayload {
  ok: boolean; coverage: { researched: number; total: number; pct: number; byStatus: Record<string, number> };
  findings: Record<string, Finding>; remaining: number; model_reads?: number; errors?: string[]; error?: string; updated_at?: string;
  date?: string; session?: Session | null; excluded_large_caps?: string[]; large_cap_min_cr?: number | null;
  /** Full text behind each short error line, same order (tooltip). (zzz769) */
  error_details?: string[];
  rules_version?: string | null; rules_version_current?: string; stale_rules?: number;
  /** The research view, when the server builds it (zzz770). */
  view?: ResearchView | null;
}
type BoardCov = ReturnType<typeof boardCoverage>;

const VERDICT: Record<string, { label: string; color: string }> = {
  // NET RESEARCH PRIORITY — how much of your research time the catalyst
  // deserves. Never a pricing claim and never buy/sell. (zzz773: the old
  // "not yet priced in" / "largely priced" labels asserted what only the
  // pricing assessment may say.)
  FIRE: { label: 'P1 · research first', color: C.green }, ROOM: { label: 'P2 · worth research', color: C.green },
  PRICED: { label: 'P3 · lower priority', color: C.amber }, WEAK: { label: 'P4 · weak', color: C.amber },
  NONE: { label: 'P5 · nothing to research', color: C.red }, THIN: { label: 'THIN · under 1% of mcap', color: C.faint },
};
const EVIDENCE: Record<string, { label: string; color: string; tip: string }> = {
  DOCUMENT_VERIFIED: { label: 'DOCUMENT VERIFIED', color: C.green, tip: 'The filing was model-read and the quote was found verbatim in it. Materiality counted in full.' },
  SUMMARY_ONLY: { label: 'SUMMARY ONLY', color: C.amber, tip: "Headline and figures come from the source's summary; the document was not read. Materiality counted at 60%." },
  UNVERIFIED: { label: 'UNVERIFIED', color: C.red, tip: 'Only the filing subject line was available. Materiality counted at 40%.' },
  SOURCE_UNAVAILABLE: { label: 'SOURCE FAILED', color: C.red, tip: 'The filing source could not be reached.' },
};
const PRICING: Record<string, { label: string; color: string }> = {
  INSUFFICIENT_EVIDENCE: { label: 'INSUFFICIENT EVIDENCE', color: C.faint },
  RAN_UP_BEFORE_FILING: { label: 'RAN UP BEFORE FILING', color: C.amber },
  REACTION_SMALL_VS_SIZE: { label: 'REACTION SMALL VS SIZE', color: C.green },
  REACTION_IN_LINE: { label: 'REACTION IN LINE', color: C.cyan },
  REACTION_EXCEEDS_SIZE: { label: 'REACTION EXCEEDS SIZE', color: C.amber },
  FELL_AFTER_FILING: { label: 'FELL AFTER FILING', color: C.dim },
};
const CAT_COLOR: Record<string, string> = {
  order_win: '#22C55E', acquisition: '#A78BFA', merger: '#A78BFA', open_offer: '#A78BFA', demerger: '#A78BFA', divestiture: '#A78BFA',
  production_ramp: '#38BDF8', capacity_expansion: '#38BDF8', new_product: '#38BDF8', new_customer: '#22C55E', joint_venture: '#A78BFA',
  regulatory_approval: '#2DD4BF', product_qualification: '#2DD4BF', quarterly_result: '#FACC15', revenue_guidance_increase: '#FACC15',
  fundraising: '#F59E0B', buyback: '#F59E0B', promoter_purchase: '#F59E0B', rating_action: '#94A3B8', management_change: '#94A3B8',
};
const sgn = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v.toFixed(1)}%` : '—');
const pill = (color: string): React.CSSProperties => ({ display: 'inline-block', fontSize: 12, fontWeight: 800, letterSpacing: 0.4, padding: '2px 7px', borderRadius: 999, border: `1px solid ${color}`, color, whiteSpace: 'nowrap' });

function money(v: number | null | undefined, m: Mkt): string {
  if (v == null || !Number.isFinite(v)) return '—';
  // US: $M below a billion, $B above (zzz766 US) — "$2,083M" read as noise.
  if (m === 'US') { const a = Math.abs(v); return a >= 1000 ? `$${(v / 1000).toFixed(a >= 100_000 ? 0 : 1)}B` : `$${a >= 100 ? Math.round(v) : v.toFixed(1)}M`; }
  return `₹${v >= 100 ? Math.round(v).toLocaleString('en-IN') : v.toFixed(1)} Cr`;
}

const istTime = (iso: string | null | undefined) => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  return `${d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })} IST`;
};
/** A US timestamp in New York time, with IST beside it — a bare browser-local
 *  "23/09/2026, 05:52:58" named no zone. (zzz767) */
const etTime = (iso: string | null | undefined) => {
  if (!iso) return 'unknown';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  const et = d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${et} ET · ${istTime(iso)}`;
};

function ResearchLevel({ research, sweeping, market, onResume, onRescore, onRetryFailed, scoredOnly, board, bcov, filedTickers, rescored }: { research: ResearchPayload | null; sweeping: boolean; market: Mkt; onResume: () => void; onRescore?: () => void; onRetryFailed?: () => void; scoredOnly?: boolean; board?: Set<string> | null; bcov?: BoardCov | null; filedTickers?: Set<string>; rescored?: { n: number; failed: number } | null }) {
  if (!research) return <div style={{ fontSize: 13, color: C.dim }}>{sweeping ? 'Researching…' : 'No catalyst research for this session yet. Click “▶ Research catalysts” above — it runs only when you click, because it uses AI reads.'}</div>;
  // Only names on the CURRENT board are listed and counted; names researched
  // from an earlier scan today are counted once, in a note. (zzz769)
  const all = Object.values(research.findings || {}).filter((f) => !board || board.has(String(f.ticker).toUpperCase()));
  const cov = bcov ? { researched: bcov.researched, total: bcov.total, pct: bcov.pct } : research.coverage;
  const pendingOnBoard = bcov ? bcov.missing.length : research.remaining;
  const errLines = research.errors || [];
  const errFull = research.error_details || [];
  // ── zzz773: ONE exclusive status per name. The groups below partition the
  // processed names, so they add up to the total; the band print is an
  // overlay flag counted inside them, never a group of its own.
  const scored = all.filter((f) => f.status === 'catalyst').sort((a, b) => (b.net ?? -1) - (a.net ?? -1));
  const rejected = all.filter((f) => f.status === 'denied' || f.status === 'negative');
  const listings = all.filter((f) => f.status === 'listing_artifact');
  const failed = all.filter((f) => f.status === 'source_failed').sort((a, b) => (b.movePct ?? 0) - (a.movePct ?? 0));
  const noCat = all.filter((f) => f.status === 'none' || f.status === 'routine_only');
  const bandsNoCat = noCat.filter((f) => f.bandPrint).sort((a, b) => (b.movePct ?? 0) - (a.movePct ?? 0));
  const unexplained = noCat.filter((f) => !f.bandPrint).sort((a, b) => (b.movePct ?? 0) - (a.movePct ?? 0));
  const processed = scored.length + rejected.length + listings.length + failed.length + noCat.length;
  const other = all.length - processed;          // unresearched / unknown status
  const evid = (f: Finding) => f.components?.evidence || (f.modelRead ? 'DOCUMENT_VERIFIED' : 'SUMMARY_ONLY');
  const nDoc = scored.filter((f) => evid(f) === 'DOCUMENT_VERIFIED').length;
  const nSum = scored.filter((f) => evid(f) === 'SUMMARY_ONLY').length;
  const nUnv = scored.length - nDoc - nSum;
  const bandTotal = all.filter((f) => f.bandPrint).length;
  const bandWhere = (['catalyst', 'denied', 'negative', 'listing_artifact', 'source_failed'] as const)
    .map((st) => [st, all.filter((f) => f.bandPrint && f.status === st).length] as const).filter(([, n]) => n > 0);
  const UNEXPLAINED_SHOWN = 80;
  const holdings = all.filter((f) => f.holding);
  const th: React.CSSProperties = { fontSize: 12, fontWeight: 800, letterSpacing: 0.3, color: C.faint, textAlign: 'left', padding: '5px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' };
  const td: React.CSSProperties = { fontSize: 13, color: C.dim, padding: '6px 8px', borderBottom: `1px solid ${C.border}`, verticalAlign: 'top' };
  const turnoverLabel = market === 'IN' ? 'Avg value/day (1W)' : 'Traded';
  // The US move is the 1-WEEK export column; calling it "1d" was false. (zzz766)
  const mv = market === 'US' ? '1W' : '1D';
  const Wrap = ({ children }: { children: React.ReactNode }) => <div style={{ overflowX: 'auto' }}><table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>{children}</table></div>;
  const Name = ({ f }: { f: Finding }) => (
    <span><TickerLink ticker={f.ticker} market={market} />{f.holding && <span title="In your book" style={{ marginLeft: 5, fontSize: 12, fontWeight: 800, color: C.cyan }}>📗</span>}
      {f.company && <div style={{ fontSize: 12, color: C.faint }}>{f.company}</div>}</span>
  );
  const Src = ({ f }: { f: Finding }) => f.sourceUrl ? <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" title={f.sourceUrl} style={{ color: C.cyan, textDecoration: 'none', fontSize: 12, whiteSpace: 'nowrap' }}>↗ filing · {f.sourceDate ? f.sourceDate.slice(0, 10) : 'undated'}</a> : <span style={{ color: C.faint }}>—</span>;
  const Section = ({ title, sub, children, right }: { title: string; sub?: string; children: React.ReactNode; right?: React.ReactNode }) => (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg, padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>{title}</div>{right}
      </div>
      {sub && <div style={{ fontSize: 12, color: C.faint, marginTop: 2, marginBottom: 6, lineHeight: 1.5 }}>{sub}</div>}
      {children}
    </div>
  );
  const Tier = ({ n, label, color, children }: { n: number; label: string; color?: string; children?: React.ReactNode }) => (
    <span style={{ whiteSpace: 'nowrap' }}><b style={{ color: color || C.text, fontSize: 13 }}>{n}</b> <span style={{ color: C.dim }}>{label}</span>{children}</span>
  );
  const retryBtn = onRetryFailed && failed.length > 0 && !sweeping ? (
    <button onClick={onRetryFailed} title="Re-fetches only the names whose filing source failed, with backoff. No AI unless a newly reached filing is a catalyst." style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer' }}>↻ Retry {failed.length} failed source{failed.length === 1 ? '' : 's'}</button>
  ) : null;

  // Press coverage: secondary, dated, linked. It says where to look and which
  // story keeps running; it never scores. (zzz773)
  const News = ({ f, compact }: { f: Finding; compact?: boolean }) => {
    const n = f.news;
    if (!n) return null;
    if (!n.items.length) return compact ? null : <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Press: nothing company-specific in the last {n.windowDays} days.</div>;
    const shown = n.items.slice(0, compact ? 2 : 4);
    return (
      <div style={{ marginTop: 8, border: `1px dashed ${C.border}`, borderRadius: 6, padding: '6px 8px' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.5, color: C.faint }}>PRESS · SECONDARY, UNVERIFIED</span>
          {n.narrative && <span style={pill(C.violet)} title={`Covered on ${n.narrative.days} different days, ${n.narrative.firstDate} → ${n.narrative.lastDate}. A story that keeps running can keep a stock moving after the event.`}>RUNNING STORY: {n.narrative.label.toUpperCase()} · {n.narrative.days}d · {n.narrative.firstDate.slice(5)}→{n.narrative.lastDate.slice(5)}</span>}
          {n.themes.filter((t) => t.theme !== n.narrative?.theme).slice(0, compact ? 2 : 4).map((t) => <span key={t.theme} style={pill(C.faint)}>{t.label} ×{t.count}</span>)}
        </div>
        {shown.map((it, k) => (
          <div key={k} style={{ fontSize: 12, color: C.dim, marginTop: 3, lineHeight: 1.45 }}>
            <span style={{ color: C.faint, fontVariantNumeric: 'tabular-nums' }}>{it.date}</span>{' '}
            <a href={it.url} target="_blank" rel="noopener noreferrer" style={{ color: C.text, textDecoration: 'none' }}>{it.title}</a>
            {it.source && <span style={{ color: C.faint }}> — {it.source}</span>}
          </div>
        ))}
      </div>
    );
  };

  const ScoredCard = ({ f, i }: { f: Finding; i: number }) => {
    const v = VERDICT[f.verdict || 'NONE'] || VERDICT.NONE;
    const c = f.components;
    const ev = EVIDENCE[evid(f)] || EVIDENCE.UNVERIFIED;
    const catColor = CAT_COLOR[String(f.category || '')] || C.violet;
    const resp = c?.response;
    const pr = c?.pricing;
    const prm = PRICING[pr?.state || 'INSUFFICIENT_EVIDENCE'] || PRICING.INSUFFICIENT_EVIDENCE;
    const conf = c?.materialityConfidence;
    const cell: React.CSSProperties = { fontSize: 12, color: C.dim, padding: '2px 6px', whiteSpace: 'nowrap' };
    const num: React.CSSProperties = { ...cell, color: C.text, fontWeight: 700, textAlign: 'right', fontVariantNumeric: 'tabular-nums' };
    return (
      <div style={{ border: `1px solid ${C.border}`, borderLeft: `4px solid ${catColor}`, borderRadius: 8, padding: '10px 12px', background: C.bg2, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(250px, 320px)', gap: 14 }} className="mc-gainer-card">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, color: C.faint, fontWeight: 800 }}>#{i + 1}</span>
            <Name f={f} />
            <span style={{ fontSize: 13, fontWeight: 800, color: (f.movePct ?? 0) >= 0 ? C.green : C.red }}>{pct(f.movePct)} <span style={{ fontSize: 12, color: C.faint, fontWeight: 600 }}>{mv}</span></span>
            {f.bandPrint && <span style={pill(C.amber)} title="Closed at an exchange price band — the band limits the move, not demand.">{f.bandLevel}% BAND</span>}
          </div>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: C.faint, marginTop: 8 }}>WHAT HAPPENED</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: C.text, lineHeight: 1.45, marginTop: 2, wordBreak: 'break-word' }}>{f.headline}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 7, alignItems: 'center' }}>
            <span style={pill(catColor)}>{pretty(String(f.category || 'catalyst')).toUpperCase()}</span>
            {f.stage && <span style={pill(f.stage === 'executed' ? C.green : C.amber)} title={f.stage === 'executed' ? 'Done, not proposed.' : f.stage === 'enabling' ? 'Proposed / board to consider — no size, price or counterparty yet.' : 'Dated in the future.'}>{f.stage.toUpperCase()}</span>}
            <span style={pill(ev.color)} title={ev.tip}>{ev.label}</span>
            {f.valueStated != null
              ? <span style={pill(C.cyan)}>{money(f.valueStated, market)}{f.valuePctMcap != null ? ` · ${f.valuePctMcap.toFixed(1)}% of mcap` : ''}</span>
              : <span style={pill(C.faint)}>NO VALUE STATED</span>}
            <span style={{ fontSize: 12, color: C.faint }}>{f.ageDays != null ? (f.ageDays === 0 ? 'filed today' : `${f.ageDays}d ago`) : ''}</span>
            <Src f={f} />
          </div>
          {f.evidenceQuote && (
            <blockquote style={{ margin: '8px 0 0', padding: '6px 10px', borderLeft: `3px solid ${C.green}`, background: C.bg, fontSize: 13, color: C.dim, fontStyle: 'italic', lineHeight: 1.5, wordBreak: 'break-word' }}>
              “{f.evidenceQuote}”<div style={{ fontSize: 12, fontStyle: 'normal', color: C.faint, marginTop: 3 }}>verbatim from the filing</div>
            </blockquote>
          )}
          {f.notes.length > 0 && (
            <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 12, color: C.amber, lineHeight: 1.55 }}>
              {f.notes.map((n, k) => <li key={k}>{n}</li>)}
            </ul>
          )}
          <News f={f} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: C.faint }}>NET RESEARCH PRIORITY</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: v.color }}>{v.label}</div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 900, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{typeof f.net === 'number' ? f.net.toFixed(1) : '—'}</div>
          </div>
          {c && (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}><tbody>
              <tr><td style={cell}>Freshness ×0.30</td><td style={num}>{c.freshness}</td></tr>
              <tr><td style={cell} title="Materiality = raw score × evidence confidence">Materiality ×0.30{conf != null && c.materialityRaw != null ? <span style={{ color: C.faint }}> ({c.materialityRaw} × {conf})</span> : null}</td><td style={num}>{c.materiality}</td></tr>
              <tr><td style={cell}>Transmission ×0.25</td><td style={num}>{c.transmission}</td></tr>
              <tr><td style={cell}>Persistence ×0.15</td><td style={num}>{c.persistence}</td></tr>
              {c.base != null && <tr><td style={{ ...cell, borderTop: `1px solid ${C.border}` }}>= Base</td><td style={{ ...num, borderTop: `1px solid ${C.border}` }}>{c.base.toFixed(1)}</td></tr>}
              <tr><td style={cell}>× Source factor</td><td style={num}>{c.sourceMult.toFixed(2)}</td></tr>
              <tr><td style={cell}>× Pricing adjustment</td><td style={num}>{(c.pricingAdj ?? 1 - c.pricedIn / 100).toFixed(2)}</td></tr>
              {c.netUncapped != null && <tr><td style={cell}>= Uncapped</td><td style={num}>{c.netUncapped.toFixed(1)}</td></tr>}
              {(c.caps || []).map((cp, k) => <tr key={k}><td colSpan={2} style={{ ...cell, whiteSpace: 'normal', color: C.amber }}>Cap: {cp}</td></tr>)}
              <tr><td style={{ ...cell, borderTop: `1px solid ${C.border}`, fontWeight: 800, color: C.text }}>= NET</td><td style={{ ...num, borderTop: `1px solid ${C.border}`, fontSize: 13 }}>{typeof f.net === 'number' ? f.net.toFixed(1) : '—'}</td></tr>
            </tbody></table>
          )}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: C.faint }}>MARKET RESPONSE</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginTop: 3, fontSize: 12, color: C.dim }}>
              <span>{mv} <b style={{ color: C.text }}>{sgn(resp?.d1 ?? f.movePct)}</b></span>
              <span>1M <b style={{ color: C.text }}>{sgn(resp?.m1 ?? f.returns?.m1)}</b></span>
              <span>3M <b style={{ color: C.text }}>{sgn(resp?.m3 ?? f.returns?.m3)}</b></span>
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>
              Since the close before the filing: <b style={{ color: C.text }}>{sgn(resp?.sinceFiling)}</b>{resp?.sessionsSinceFiling != null ? ` (${resp.sessionsSinceFiling} session${resp.sessionsSinceFiling === 1 ? '' : 's'})` : ''}
              {resp?.preFiling20 != null && <> · 20 sessions before it: <b style={{ color: C.text }}>{sgn(resp.preFiling20)}</b></>}
            </div>
          </div>
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: '6px 8px' }}>
            <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.6, color: C.faint }}>PRICING ASSESSMENT</div>
            <div style={{ marginTop: 3 }}><span style={pill(prm.color)}>{prm.label}</span></div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.45 }}>{pr?.text || 'Scored under older rules — re-score to assess the reaction to the filing.'}</div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <style>{'@media (max-width: 760px) { .mc-gainer-card { grid-template-columns: 1fr !important; } }'}</style>
      <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.6 }}>
        <b style={{ color: C.text }} title="Research completion — names whose filings were checked — not the number with a catalyst.">Catalyst research {cov.researched}/{cov.total} small/mid caps researched ({cov.pct}%)</b>
        {research.date && <span style={{ color: C.faint }}> · session {research.date}</span>}
        {sweeping ? <span style={{ color: C.cyan }}> · researching…</span>
          : pendingOnBoard > 0 ? <button onClick={onResume} title="Reads the filings behind each move with the AI model. Runs only when you click." style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.cyan}`, background: 'transparent', color: C.cyan, cursor: 'pointer' }}>▶ Research · {pendingOnBoard} not yet researched (uses AI)</button>
            : onRescore && cov.total > 0 ? <button onClick={onRescore} title="Re-researches today's names from scratch with the current rules. Filings already model-read come from the cache; a filing the current rules newly choose may be model-read (within the daily ceiling). Stored findings under older rules are already re-scored automatically, without AI, when the page opens." style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer' }}>↻ Re-score today with current rules</button> : null}
        {/* The partition: every processed name in exactly one group. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'baseline', marginTop: 6, padding: '8px 10px', border: `1px solid ${C.border}`, borderRadius: 8, background: C.bg }}>
          <Tier n={processed} label={`of ${all.length} processed →`} />
          <Tier n={scored.length} label="catalyst confirmed" color={C.green}>
            {scored.length > 0 && <span style={{ color: C.faint }}> ({nDoc} document-verified · {nSum} summary-only{nUnv ? ` · ${nUnv} unverified` : ''})</span>}
          </Tier>
          <Tier n={noCat.length} label="no catalyst" color={C.dim}>{bandsNoCat.length > 0 && <span style={{ color: C.faint }}> ({bandsNoCat.length} band / technical)</span>}</Tier>
          <Tier n={rejected.length} label="denied / negative" color={C.amber} />
          <Tier n={listings.length} label="listing" color={C.faint} />
          <Tier n={failed.length} label="source unavailable" color={failed.length ? C.red : C.faint} />
          {other > 0 && <Tier n={other} label="pending" color={C.cyan} />}
          {retryBtn}
        </div>
        <div style={{ fontSize: 12, color: C.faint, marginTop: 3 }}>
          The groups are exclusive and add up to {processed}. Band prints are a flag, not a group: {bandTotal} name{bandTotal === 1 ? '' : 's'} closed at a price band{bandWhere.length ? ` (${bandWhere.map(([st, n]) => `${n} ${st === 'source_failed' ? 'source unavailable' : pretty(st)}`).join(', ')}${bandsNoCat.length ? `, ${bandsNoCat.length} no catalyst` : ''})` : ''}.
          {research.model_reads != null && <> {research.model_reads} document{research.model_reads === 1 ? '' : 's'} model-read today.</>}
          {bcov && bcov.offBoard > 0 && <> {bcov.offBoard} name{bcov.offBoard === 1 ? '' : 's'} researched from an earlier scan today are no longer on this board and not listed.</>}
        </div>
        {rescored && !sweeping && <div style={{ fontSize: 12, color: C.faint }}>Re-scored with current rules (no AI used) — {rescored.n} stored finding{rescored.n === 1 ? '' : 's'} rebuilt from filings already fetched and reads already cached{rescored.failed ? `; ${rescored.failed} kept as stored because the source could not be reached` : ''}.</div>}
        {research.error && (
          <div role="alert" style={{ color: C.amber, marginTop: 4 }}>
            {research.error}{' '}
            {!sweeping && <button onClick={onResume} style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999, border: `1px solid ${C.amber}`, background: 'transparent', color: C.amber, cursor: 'pointer' }}>↻ Retry research</button>}
          </div>
        )}
        {market === 'IN' && research.excluded_large_caps && research.excluded_large_caps.length > 0 && (
          <div style={{ fontSize: 12, color: C.faint }}>Excluded as large caps (≥ ₹{(research.large_cap_min_cr ?? 100000).toLocaleString('en-IN')} Cr): {research.excluded_large_caps.join(', ')}.</div>
        )}
        <div style={{ fontSize: 12, color: C.faint }}>
          Every name is swept against its exchange filings of the last 21 days and a year of price history; a name with nothing is an explicit <i>none</i>, never a silence.
          {market === 'IN' ? ' Sources: BSE\'s complete announcement list for the window, plus screener.in\'s five newest with their summaries; dated press coverage is shown beside each finding as secondary context and never scores. A name is SOURCE UNAVAILABLE only when every filing source failed.' : ' Source: SEC EDGAR submissions, classified by form and 8-K item. Offerings (424B, S-1/S-3, Item 3.02, Form D) are flagged as dilution, never as a catalyst; Item 2.02/10-Q are results; Item 1.01/7.01/8.01 are read before they are called anything. Forms 3/4/144 are excluded. Universe: US-listed small/mid caps ($50M–$10B); the move is the 1-week export column.'}
        </div>
      </div>

      {holdings.length > 0 && (
        <Section title="Your book on the board" sub="Position reviews, not ideas.">
          <Wrap><thead><tr><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Finding</th><th style={th}>Source</th></tr></thead>
            <tbody>{holdings.map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td><td style={td}>{f.headline || pretty(f.status)}{f.notes.length > 0 && <div style={{ fontSize: 12, color: C.faint }}>{f.notes.join(' ')}</div>}</td><td style={td}><Src f={f} /></td></tr>)}</tbody></Wrap>
        </Section>
      )}

      <Section title={`Scored — ${scored.length} name${scored.length === 1 ? '' : 's'} carry a catalyst`}
        sub="Gainer → event → source status → classification → materiality → transmission → persistence → market response → pricing assessment → NET research priority. NET = (0.30·Freshness + 0.30·Materiality + 0.25·Transmission + 0.15·Persistence) × Source × Pricing, then the caps listed on the card — every number shown reproduces it. Materiality is value ÷ market cap where a value is stated, times the evidence confidence (document 1.0 · summary 0.6 · subject line 0.4); under 1% of market cap is THIN. Pricing is assessed only from the reaction since the close before the filing against the event's size — a falling stock is a response, not proof the news is unpriced.">
        {scored.length === 0 ? <div style={{ fontSize: 13, color: C.dim }}>No confirmed catalyst: nothing on the board carries a dated, sourced catalyst{cov.researched < cov.total ? ' yet' : ''}. An empty top of the table is a valid result.</div> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{scored.map((f, i) => <ScoredCard key={f.ticker} f={f} i={i} />)}</div>
        )}
      </Section>

      {!scoredOnly && (rejected.length > 0 || listings.length > 0) && (
        <Section title={`Denied, negative or listing — ${rejected.length + listings.length}`} sub="Rejected catalysts are findings, not omissions. A company formally denying a catalyst while the stock moves is more actionable than most confirmed ones.">
          <Wrap><thead><tr><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Finding</th><th style={th}>Source</th></tr></thead>
            <tbody>
              {rejected.map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}{f.bandPrint && <div><span style={pill(C.amber)}>{f.bandLevel}% BAND</span></div>}</td><td style={{ ...td, minWidth: 300 }}><b style={{ color: f.status === 'denied' ? C.amber : C.red }}>{f.status.toUpperCase()}.</b> <span style={{ color: C.text }}>{f.headline}</span>{f.notes.length > 0 && <div style={{ fontSize: 12, color: C.faint }}>{f.notes.join(' ')}</div>}<News f={f} compact /></td><td style={td}><Src f={f} /></td></tr>)}
              {listings.map((f) => {
                // A recent listing with a filed result behind it: the result is
                // the context (research queue), the listing is a caveat on it —
                // never "an artifact" that contradicts it. (zzz769, MILKYMIST)
                const withResult = !!filedTickers?.has(String(f.ticker).toUpperCase());
                return <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}</td><td style={{ ...td, minWidth: 300 }}>{withResult
                  ? <><b style={{ color: C.amber }}>RECENT LISTING · FILED RESULT.</b> A quarterly result is on file behind this move (see the filed-result rows in the research queue). Caveat: {String(f.headline || '').replace(/^Listed/, 'listed').replace(/ — no comparable prior close.*$/, '')} — no comparable prior close, so the size of the move is unreliable.</>
                  : <><b style={{ color: C.faint }}>LISTING ARTIFACT.</b> {f.headline}</>}</td><td style={td}><Src f={f} /></td></tr>;
              })}
            </tbody></Wrap>
        </Section>
      )}

      {!scoredOnly && noCat.length > 0 && (
        <Section title={`No confirmed catalyst — ${noCat.length} move${noCat.length === 1 ? '' : 's'}`} sub="Filings were read and none is a catalyst. Name, move, and what the filings actually show for the window; band prints are marked. An unclassified filing is worth opening yourself.">
          <Wrap><thead><tr><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Mcap</th><th style={th}>{turnoverLabel}</th><th style={th}>Filings in window</th><th style={th}>1M / 3M</th></tr></thead>
            <tbody>{[...bandsNoCat, ...unexplained].slice(0, UNEXPLAINED_SHOWN).map((f) => <tr key={f.ticker}><td style={td}><Name f={f} /></td><td style={td}>{pct(f.movePct)}{f.bandPrint && <div><span style={pill(C.amber)} title="Closed at an exchange price band — the band limits the move, not demand.">{f.bandLevel}% BAND</span></div>}</td><td style={td}>{money(f.marketCap, market)}</td><td style={td}>{money(f.turnover, market)}</td><td style={{ ...td, minWidth: 260 }}>{f.filingsInWindow === 0 ? <span>{f.headline || `no filing in ${f.windowDays} days`}</span> : <span>{f.headline}</span>}{f.sourceUrl && <> · <Src f={f} /></>}{f.notes.filter((n) => !/^Closed at the \d+% band/.test(n)).length > 0 && <div style={{ fontSize: 12, color: C.faint }}>{f.notes.filter((n) => !/^Closed at the \d+% band/.test(n)).join(' ')}</div>}<News f={f} compact /></td><td style={td}>{f.returns ? `${pct(f.returns.m1)} / ${pct(f.returns.m3)}` : '—'}</td></tr>)}</tbody></Wrap>
          {noCat.length > UNEXPLAINED_SHOWN && <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>+{noCat.length - UNEXPLAINED_SHOWN} more not shown (smallest moves).</div>}
        </Section>
      )}

      {!scoredOnly && failed.length > 0 && (
        <Section title={`Source unavailable — ${failed.length}`} right={retryBtn}
          sub="SOURCE_UNAVAILABLE: the filing source did not answer for these, so whether anything was filed is unknown. Never read as “no catalyst”.">
          <Wrap><thead><tr><th style={th}>Name</th><th style={th}>{mv}</th><th style={th}>Mcap</th><th style={th}>What the press says meanwhile</th></tr></thead>
            <tbody>{failed.map((f) => (
              <tr key={f.ticker}>
                <td style={td}><Name f={f} /></td>
                <td style={td}>{pct(f.movePct)}{f.bandPrint && <div><span style={pill(C.amber)}>{f.bandLevel}% BAND</span></div>}</td>
                <td style={td}>{money(f.marketCap, market)}</td>
                <td style={{ ...td, minWidth: 300 }}>{f.news ? <News f={f} compact /> : <span style={{ color: C.faint }}>Not read yet — press is fetched on the next research or retry pass.</span>}</td>
              </tr>
            ))}</tbody></Wrap>
        </Section>
      )}
      {!scoredOnly && errLines.length > 0 && (
        // One short line per ticker, at most five; the full text is the tooltip. (zzz769)
        <div style={{ fontSize: 12, color: C.faint, lineHeight: 1.6 }}>
          <span style={{ fontWeight: 700 }}>Last errors:</span>
          {errLines.slice(-5).map((e, i) => (
            <div key={i} title={errFull[i] || e} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 640 }}>· {e}</div>
          ))}
        </div>
      )}
    </div>
  );
}

/** A ticker that opens its screener.in page (India) — the one place the
 *  owner checks a name by hand. BSE-code tickers resolve there too. */
function TickerLink({ ticker, market }: { ticker: string; market: Mkt }) {
  if (market !== 'IN') return <b style={{ color: C.text }}>{ticker}</b>;
  return (
    <a href={`https://www.screener.in/company/${encodeURIComponent(ticker)}/`} target="_blank" rel="noopener noreferrer"
      title={`Open ${ticker} on screener.in`} style={{ color: C.text, fontWeight: 800, textDecoration: 'none' }}>{ticker}</a>
  );
}

function ScannedLevel({ data }: { data: Payload }) {
  const sl = data.source_list;
  const rows = data.scanned || [];
  const isIN = data.market === 'IN';
  const excluded = sl?.excluded_large_caps || [];
  if (!sl || !rows.length) {
    return (
      <div style={{ fontSize: 13, color: C.dim, lineHeight: 1.6, background: C.bg,
        border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px' }}>
        <b style={{ color: C.amber }}>No gainers list was read for this market.</b>{' '}
        {sl?.error || (isIN
          ? (excluded.length ? 'Every name on the screen was a large cap, and this brief is small and mid caps only.' : 'The screener.in screen returned nothing.')
          : 'The TradingView export could not be read.')}
        {' '}This is a failure to read the list, not a day with no gainers — nothing on the other tabs has been
        checked against a gainers list.
      </div>
    );
  }
  // India shows what the screen actually carries (market cap and price);
  // "REL VOL" is a US column and read "—" on every Indian row.
  const cols = isIN ? '96px minmax(120px,1fr) 78px 96px 84px 108px' : '84px 1fr 78px 70px 108px';
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>
          {sl.rows} rows read from{' '}
          {sl.url
            ? <a href={sl.url} target="_blank" rel="noopener noreferrer" style={{ color: C.cyan }}>{sl.file}</a>
            : <code style={{ color: C.cyan }}>{sl.file}</code>}
          {sl.total_reported && sl.total_reported !== sl.rows
            ? <span style={{ color: C.faint, fontWeight: 400 }}> (of {sl.total_reported} reported{excluded.length ? `, ${excluded.length} large cap${excluded.length === 1 ? '' : 's'} excluded` : ''})</span> : null}
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 3, lineHeight: 1.5 }}>
          Read {isIN ? istTime(sl.synced_at) : etTime(sl.synced_at)}
          {sl.window ? <> · window: <b style={{ color: C.text }}>{sl.window}</b></> : null}
          {' · '}{sl.matched_to_a_filing} of {sl.rows} matched to a filed result.
        </div>
        {sl.error && (
          <div style={{ fontSize: 12, color: C.amber, marginTop: 4 }}>⚠ {sl.error}</div>
        )}
        {isIN && excluded.length > 0 && (
          <div style={{ fontSize: 12, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
            Excluded as large caps (≥ ₹{(sl.large_cap_min_cr ?? 100000).toLocaleString('en-IN')} Cr — small/mid caps only):{' '}
            {excluded.map((x) => `${x.ticker} ${pct(x.move_pct)} (${money(x.market_cap, 'IN')})`).join(' · ')}
          </div>
        )}
        {data.market === 'US' && (sl.as_of || sl.sync_note) && (
          <div style={{ fontSize: 12, color: sl.as_of?.stale || sl.sync_note ? C.amber : C.dim, marginTop: 4, lineHeight: 1.5 }}>
            {sl.as_of ? <>{sl.as_of.stale ? '⚠ ' : ''}{sl.as_of.label} <span style={{ color: C.faint }}>(synced {sl.as_of.synced_et})</span></> : <>⚠ {sl.sync_note}</>}
          </div>
        )}
        {data.market === 'US' && sl.excluded && sl.excluded.length > 0 && (
          <details style={{ fontSize: 12, color: C.faint, marginTop: 4 }}>
            <summary style={{ cursor: 'pointer' }}>{sl.excluded.length} export row{sl.excluded.length === 1 ? '' : 's'} excluded — not US-listed small/mid-cap gainers</summary>
            <div style={{ marginTop: 3, lineHeight: 1.6 }}>{sl.excluded.map((e) => <div key={`${e.ticker}:${e.exchange}:${e.kind}`}><b style={{ color: C.dim }}>{e.ticker}</b> <span>({e.exchange || '—'})</span> — {e.reason}</div>)}</div>
          </details>
        )}
        {data.market === 'US' && (
          <div style={{ fontSize: 12, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
            &ldquo;Daily&rdquo; in this tab&rsquo;s name is the cadence of the review, not the window of the move: the
            US screen is a <b>weekly</b> performance export. India reads a genuine 1-day-return screen, live.
          </div>
        )}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: isIN ? 600 : 480 }}>
          <div style={{ display: 'grid', gridTemplateColumns: cols,
            gap: 8, padding: '6px 14px', borderBottom: `1px solid ${C.border}`,
            fontSize: 12, fontWeight: 800, letterSpacing: 0.3, color: C.faint }}>
            <span>TICKER</span><span>COMPANY</span>
            <span style={{ textAlign: 'right' }}>{isIN ? '1D MOVE' : '1W MOVE'}</span>
            {isIN
              ? <><span style={{ textAlign: 'right' }}>MCAP</span><span style={{ textAlign: 'right' }}>PRICE</span></>
              : <span style={{ textAlign: 'right' }}>REL VOL</span>}
            <span>FILED RESULT?</span>
          </div>
          {rows.map((r) => (
            <div key={r.ticker} style={{ display: 'grid', gridTemplateColumns: cols,
              gap: 8, padding: '5px 14px', fontSize: 13, alignItems: 'baseline',
              borderBottom: `1px solid ${C.border}` }}>
              <TickerLink ticker={r.ticker} market={data.market} />
              <span style={{ color: C.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.company}
              </span>
              <span style={{ textAlign: 'right', fontWeight: 700,
                color: (r.move_pct ?? 0) >= 0 ? C.green : C.red }}>{pct(r.move_pct)}</span>
              {isIN
                ? <>
                  <span style={{ textAlign: 'right', color: C.dim }}>{money(r.market_cap ?? null, 'IN')}</span>
                  <span style={{ textAlign: 'right', color: C.dim }}>{typeof r.price === 'number' ? `₹${r.price.toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—'}</span>
                </>
                : <span style={{ textAlign: 'right', color: C.faint }}>
                  {typeof r.volume_ratio === 'number' ? `×${r.volume_ratio.toFixed(1)}` : '—'}
                </span>}
              <span style={{ fontSize: 12, fontWeight: 700, color: r.matched ? C.green : C.faint }}>
                {r.matched ? '✓ filed result' : 'no filed result'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Chip({ on, onClick, children, color }: { on: boolean; onClick: () => void; children: React.ReactNode; color?: string }) {
  const c = color || C.cyan;
  return (
    <button onClick={onClick} style={{
      fontSize: 12, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${on ? c : C.border}`,
      background: on ? `color-mix(in srgb, ${c} 14%, transparent)` : C.bg,
      color: on ? c : C.dim,
    }}>{children}</button>
  );
}

function EventCard({ r, compact, open, onToggle }: { r: Row; compact: boolean; open: boolean; onToggle: () => void }) {
  const q = QUAD[r.quadrant] || QUAD.early_unclear;
  const best = r.evidence.length ? Math.min(...r.evidence.map((e) => e.tier)) : 3;
  const t = TIER[best] || TIER[3];
  return (
    <div style={{ background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '11px 14px', borderLeft: `3px solid ${q.color}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{r.ticker}</span>
        {r.company && <span style={{ fontSize: 12, color: C.dim, maxWidth: 260, overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>}
        <span style={{ fontSize: 13, fontWeight: 800,
          color: (r.price_change_pct ?? 0) >= 0 ? C.green : C.red }}>{pct(r.price_change_pct)}</span>
        {typeof r.volume_ratio === 'number' && (
          <span style={{ fontSize: 12, color: C.faint }}>vol ×{r.volume_ratio.toFixed(1)}</span>
        )}
        <Tag color={q.color} title={q.meaning}>{q.name}</Tag>
        <Tag color={t.color} title={
          best === 3 ? 'An unverified source can raise an alert. It can never, alone, produce a research score.'
            : 'Evidence tier is a property of where the source came from, not of how confident the text sounds.'
        }>{t.label}</Tag>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 17, fontWeight: 900, color: q.color }}>{r.research_priority}</span>
          <button onClick={onToggle} style={{ fontSize: 12, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
            border: `1px solid ${C.border}`, background: 'transparent', color: C.dim, cursor: 'pointer' }}>
            {open ? 'Hide the maths' : 'Why this score'}
          </button>
        </span>
      </div>

      <div style={{ marginTop: 6, fontSize: 13, color: C.dim, lineHeight: 1.55 }}>
        <b style={{ color: C.text }}>{pretty(r.catalyst)}</b>
        {' · '}{pretty(r.information_status)}
        {' · '}{r.materiality} materiality
        {' · '}{r.structural_duration}-lived
      </div>

      {!compact && r.claims.filter((c) => c.text).map((c, i) => (
        <div key={i} style={{ marginTop: 7, fontSize: 13, color: C.text, lineHeight: 1.55,
          paddingLeft: 9, borderLeft: `2px solid ${C.border}` }}>
          {c.text}
          <span style={{ fontSize: 12, color: C.faint, marginLeft: 6 }}>
            {c.kind === 'fact' ? 'stated in the filing' : 'inferred — not stated'}
          </span>
        </div>
      ))}

      {!compact && r.evidence.length > 0 && (
        <div style={{ marginTop: 7, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {r.evidence.map((e, i) => (
            <a key={i} href={e.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: (TIER[e.tier] || TIER[3]).color, textDecoration: 'none' }}>
              ↗ source {i + 1} · tier {e.tier}{e.published ? ` · ${String(e.published).slice(0, 10)}` : ''}
            </a>
          ))}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: C.faint, marginBottom: 5 }}>
            HOW THE {r.research_priority} WAS BUILT
          </div>
          {[...r.components, ...r.penalties].map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '2px 0' }}>
              <span style={{ fontSize: 12, fontWeight: 800, minWidth: 54, textAlign: 'right',
                color: c.points < 0 ? C.red : c.points === 0 ? C.faint : C.text }}>
                {c.points >= 0 ? '+' : ''}{c.points}<span style={{ color: C.faint, fontWeight: 600 }}>/{Math.abs(c.max)}</span>
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text, minWidth: 168 }}>{c.label}</span>
              <span style={{ fontSize: 12, color: C.dim }}>{c.because}</span>
            </div>
          ))}
          <div style={{ marginTop: 7, fontSize: 12, color: C.faint, lineHeight: 1.5 }}>
            {q.meaning} A quadrant describes a mismatch between news and price. It is not a recommendation, and nothing
            on this page is.
          </div>
        </div>
      )}
    </div>
  );
}

function Tag({ color, title, children }: { color: string; title?: string; children: React.ReactNode }) {
  return (
    // Appending a hex alpha to the colour produced "var(--mc-bullish)18" — invalid CSS, so every tag
    // built on a theme variable rendered with no fill. (zzz766)
    <span title={title} style={{
      fontSize: 12, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
      border: `1px solid ${color}`, background: `color-mix(in srgb, ${color} 12%, transparent)`, color,
    }}>{children}</span>
  );
}
