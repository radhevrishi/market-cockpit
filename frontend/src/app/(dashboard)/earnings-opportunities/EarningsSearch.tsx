// zzz276 — Typeahead search for the earnings-opportunities toolbar.
//
// zzz812 — rebuilt after "I search FCL and it's not going". What it does now:
//   1. Searches the LOADED filing date first, instantly, on the client —
//      exact ticker, then ticker prefix, then company words (lib/earnings-search).
//      A match hidden by a filter or a collapsed tier is listed with the reason
//      and can be shown anyway; nothing is dropped silently.
//   2. If the loaded date has no match, looks in the graded history that is
//      already on file — the server index over the graded results cache (fixed:
//      it was reading a namespace nothing writes to any more), the Conviction
//      Beats / EI Elite benches, and this browser's cached graded days —
//      newest first, and offers to jump the page to that date.
//   3. If it is in none of those, says so plainly and offers "grade X now"
//      (the existing single-company force-include via /enrich).
// The text lives in ?q= so a refresh or a shared link keeps it, and a 150 ms
// debounce + per-query memo keeps typing smooth.

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  resolveSearch, normalizeTicker, type SearchOutcome, type SearchableRow,
  type WindowHit, type RankedHit, type HistoryResult, type ParsedQuery,
} from '@/lib/earnings-search';
import { useUrlSearchQuery, SearchResultsPanel } from '@/components/earnings-search-kit';

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

export type EarningsSearchResult = {
  ticker: string;
  company: string;
  filing_date: string;      // YYYY-MM-DD ('' when unknown)
  tier: Tier;
  sector?: string;
  market_cap_cr?: number | null;
  quarter?: string;
  composite_score?: number;
  via_scan?: boolean;
  source?: 'server' | 'bench' | 'browser';
};

type Props<T extends SearchableRow> = {
  /** Every graded row on the currently loaded date, filters ignored. */
  windowRows: readonly T[];
  /** e.g. "the 14 Aug 2026 results". */
  windowLabel: string;
  /** Why the page's current filters hide a row ([] = visible). */
  hiddenReasons: (row: T) => string[];
  onRevealInWindow: (row: T, reasons: string[]) => void;
  onJumpToDate: (r: EarningsSearchResult) => void;
  /** Single-company grade (force-include) — offered only when nothing is on file. */
  onGradeNow?: (ticker: string) => void;
  placeholder?: string;
};

const RECENT_KEY = 'mc:eo:search-recent:v1';
const LS_GRADED_RE = /^mc:graded:v\d+:(\d{4}-\d{2}-\d{2})$/;
const MEMO_TTL_MS = 5 * 60_000;
const DEFAULT_LOOKBACK_DAYS = 168;   // 120 business days

function pushRecent(r: EarningsSearchResult) {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const cur: EarningsSearchResult[] = raw ? JSON.parse(raw) : [];
    const next = [r, ...(Array.isArray(cur) ? cur : []).filter((x) => x.ticker !== r.ticker || x.filing_date !== r.filing_date)].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

const asTier = (t: any): Tier => (t === 'BLOCKBUSTER' || t === 'STRONG' || t === 'MIXED' || t === 'AVOID' ? t : 'STRONG');

/** Conviction Beats + EI Elite benches (localStorage) — every entry, unranked. */
function readLocalBench(): EarningsSearchResult[] {
  const out: EarningsSearchResult[] = [];
  try {
    const raw = localStorage.getItem('mc:conviction-beats:v1');
    const map = raw ? JSON.parse(raw) : {};
    for (const key of Object.keys(map || {})) {
      const e = map[key];
      if (!e || !e.ticker) continue;
      out.push({
        ticker: normalizeTicker(e.ticker),
        company: e.company || e.ticker,
        filing_date: e.filing_date || '',
        tier: asTier(e.tier),
        sector: e.sector,
        market_cap_cr: typeof e.market_cap_cr === 'number' ? e.market_cap_cr : null,
        quarter: e.quarter && e.fiscal_year ? `${e.quarter} FY${String(e.fiscal_year).slice(-2)}` : undefined,
        composite_score: typeof e.composite_score === 'number' ? e.composite_score : undefined,
        source: 'bench',
      });
    }
  } catch {}
  try {
    const raw = localStorage.getItem('mc:ei-elite:v1');
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) for (const e of arr) {
      if (!e || !e.symbol) continue;
      out.push({
        ticker: normalizeTicker(e.symbol), company: e.company || e.symbol,
        filing_date: e.filed_date || e.resultDate || '', tier: 'STRONG',
        market_cap_cr: typeof e.marketCapCr === 'number' ? e.marketCapCr : null,
        quarter: e.period || undefined, source: 'bench',
      });
    }
  } catch {}
  return out;
}

/** Graded days this browser already cached (mc:graded:vN:<date>), matching rows only. */
function readBrowserGraded(pq: ParsedQuery): EarningsSearchResult[] {
  const out: EarningsSearchResult[] = [];
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && LS_GRADED_RE.test(k)) keys.push(k);
    }
    // Cheap pre-filter before JSON.parse: the ticker or first word must occur.
    const needle = (pq.ticker || pq.words[0] || '').toUpperCase();
    for (const k of keys) {
      const raw = localStorage.getItem(k);
      if (!raw || (needle && !raw.toUpperCase().includes(needle))) continue;
      let p: any; try { p = JSON.parse(raw); } catch { continue; }
      const date = (k.match(LS_GRADED_RE) || [])[1] || '';
      for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as Tier[]) {
        for (const e of (p?.by_tier?.[t] || [])) {
          if (!e?.ticker) continue;
          out.push({
            ticker: normalizeTicker(e.ticker), company: e.company || e.ticker,
            filing_date: String(e.filing_date || date).slice(0, 10), tier: t,
            sector: e.sector, market_cap_cr: e.market_cap_cr ?? null, quarter: e.quarter,
            composite_score: e.composite_score, source: 'browser',
          });
        }
      }
    }
  } catch {}
  return out;
}

export default function EarningsSearch<T extends SearchableRow>(p: Props<T>) {
  const { q, setQ, debounced } = useUrlSearchQuery();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<SearchOutcome<T, EarningsSearchResult> | null>(null);
  const [busy, setBusy] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const memo = useRef<Map<string, { at: number; value: HistoryResult<EarningsSearchResult> }>>(new Map());
  const autoOpened = useRef(false);

  // A ?q= that arrived with the URL opens the panel once the rows exist.
  useEffect(() => {
    if (!autoOpened.current && debounced.trim()) { autoOpened.current = true; setOpen(true); }
  }, [debounced]);

  const fetchHistory = useMemo(() => async (pq: ParsedQuery): Promise<HistoryResult<EarningsSearchResult>> => {
    const key = pq.ticker + '|' + pq.words.join(' ');
    const hit = memo.current.get(key);
    if (hit && Date.now() - hit.at < MEMO_TTL_MS) return hit.value;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let rows: EarningsSearchResult[] = [];
    let reason: string | null = null;
    let lookbackDays: number | null = null;
    try {
      const res = await fetch(`/api/v1/earnings/search?q=${encodeURIComponent(pq.raw)}&limit=25`, { cache: 'no-store', signal: ctrl.signal });
      if (res.ok) {
        const j = await res.json();
        rows = (Array.isArray(j?.results) ? j.results : []).map((r: any) => ({ ...r, source: 'server' }));
        if (typeof j?.lookback_days === 'number') lookbackDays = j.lookback_days;
        if ((j?._idx ?? 1) === 0) reason = 'the graded results store returned nothing — it may be unreachable right now';
      } else {
        reason = `the search index could not be read (HTTP ${res.status})`;
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') throw e;
      reason = 'the search index could not be reached';
    }
    rows = rows.concat(readLocalBench());
    const value: HistoryResult<EarningsSearchResult> = { rows, reason, lookbackDays };
    // Only if neither the server nor the bench knows it: this browser's cache.
    const pqHit = rows.some((r) => normalizeTicker(r.ticker) === pq.ticker);
    if (!pqHit) value.rows = rows.concat(readBrowserGraded(pq));
    if (!reason) memo.current.set(key, { at: Date.now(), value });
    return value;
  }, []);

  // Window rows change on every poll; key the search on their identity so a
  // refetch with the same rows does not re-run it.
  const rowsSig = useMemo(
    () => p.windowRows.map((r) => `${r.ticker}:${r.tier || ''}`).join(','),
    [p.windowRows],
  );
  const reasonsRef = useRef(p.hiddenReasons);
  reasonsRef.current = p.hiddenReasons;
  const rowsRef = useRef(p.windowRows);
  rowsRef.current = p.windowRows;

  useEffect(() => {
    const text = debounced.trim();
    if (!text) { setOutcome(null); setBusy(false); return; }
    let alive = true;
    setBusy(true);
    resolveSearch<T, EarningsSearchResult>({
      q: text,
      windowRows: rowsRef.current,
      hiddenReasons: (r) => reasonsRef.current(r),
      fetchHistory,
      lookbackDays: DEFAULT_LOOKBACK_DAYS,
    }).then((o) => { if (alive) setOutcome(o); })
      .catch(() => { /* aborted by a newer query */ })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
    // hiddenReasons changes with every filter toggle — include a cheap signature.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, rowsSig, fetchHistory, p.windowLabel, p.hiddenReasons]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const pickWindow = (h: WindowHit<T>) => {
    pushRecent({ ticker: h.row.ticker, company: String(h.row.company || h.row.ticker), filing_date: String(h.row.filing_date || ''), tier: asTier(h.row.tier) });
    setOpen(false);
    p.onRevealInWindow(h.row, h.hiddenBy);
  };
  const pickHistory = (h: RankedHit<EarningsSearchResult>) => {
    pushRecent(h.row);
    setOpen(false);
    p.onJumpToDate(h.row);
  };
  const typed = normalizeTicker(debounced) || debounced.trim();
  const gradeNow = p.onGradeNow && outcome?.kind === 'none' && /^[A-Z0-9][A-Z0-9&\-]{0,19}$/.test(typed)
    ? { label: `grade ${typed} now`, onClick: () => { setOpen(false); p.onGradeNow!(typed); } }
    : null;

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: '1 1 320px', minWidth: 0, maxWidth: 560 }}>
      <div style={{ position: 'relative' }}>
        <input
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); return; }
            if (e.key !== 'Enter') return;
            e.preventDefault();
            setOpen(true);
            if (!outcome) return;
            if (outcome.kind === 'window' && outcome.hits[0]) pickWindow(outcome.hits[0]);
            else if (outcome.kind === 'history' && outcome.hits[0]) pickHistory(outcome.hits[0]);
          }}
          placeholder={p.placeholder || 'Search ticker or company (e.g. FCL, Fineotex)…'}
          aria-label="Search earnings results by ticker or company"
          inputMode="search"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 32px', fontSize: 13,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            background: 'var(--mc-bg-1)', color: 'var(--mc-text-1)',
            border: '1px solid var(--mc-border-1)', borderRadius: 6, outline: 'none',
          }}
        />
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--mc-text-3)', pointerEvents: 'none' }}>🔍</span>
        {busy && <span style={{ position: 'absolute', right: 26, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--mc-text-3)' }}>…</span>}
        {q && (
          <button type="button" onClick={() => { setQ(''); setOutcome(null); }} aria-label="Clear search"
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--mc-text-3)', cursor: 'pointer', fontSize: 14, padding: 2 }}>×</button>
        )}
      </div>
      {open && q.trim() && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, boxShadow: '0 8px 24px rgba(0,0,0,0.25)' }}>
          <SearchResultsPanel<T, EarningsSearchResult>
            outcome={outcome}
            loading={busy || debounced !== q}
            windowLabel={p.windowLabel}
            onPickWindow={pickWindow}
            onPickHistory={pickHistory}
            gradeNow={gradeNow}
          />
        </div>
      )}
    </div>
  );
}
