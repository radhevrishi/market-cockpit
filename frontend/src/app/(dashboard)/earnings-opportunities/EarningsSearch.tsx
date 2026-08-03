// zzz276 — Typeahead search for the earnings-opportunities toolbar.
// Type "asian" → dropdown of Asian Paints / Asian Energy / etc. across the
// last 120 business days. Click → parent handler jumps to the filing date
// and scrolls to the highlighted card.
//
// Institutional patterns applied:
//   • Debounced 250ms fetch (avoid spamming the backend on every keystroke)
//   • Keyboard nav: ArrowUp/Down navigates, Enter selects, Escape closes
//   • Recent picks persisted in localStorage (last 10)
//   • Result rows show TICKER · Company · Sector · date-ago · tier chip

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Tier = 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';

export type EarningsSearchResult = {
  ticker: string;
  company: string;
  filing_date: string;      // YYYY-MM-DD (empty when via_scan — filing date unknown)
  tier: Tier;
  sector?: string;
  market_cap_cr?: number | null;
  quarter?: string;
  composite_score?: number;
  // zzz280 — set when the entry came from the earnings-scan fallback (not
  // in the graded index). Parent should force-include on current date
  // instead of jumping, since we don't know the real filing date.
  via_scan?: boolean;
};

type Props = {
  onSelect: (r: EarningsSearchResult) => void;   // parent handles setFilterDate + scroll
  placeholder?: string;
};

const RECENT_KEY = 'mc:eo:search-recent:v1';
const RECENT_CAP = 10;

const TIER_CHIP: Record<Tier, { bg: string; fg: string; label: string }> = {
  BLOCKBUSTER: { bg: '#F59E0B22', fg: '#F59E0B', label: '⭐ BLOCKBUSTER' },
  STRONG:      { bg: '#10B98122', fg: '#10B981', label: '🟢 STRONG' },
  MIXED:       { bg: '#64748B22', fg: '#94A3B8', label: '⚪ MIXED' },
  AVOID:       { bg: '#EF444422', fg: '#EF4444', label: '🔴 AVOID' },
};

function daysAgo(iso: string): string {
  try {
    const d = new Date(iso).getTime();
    const days = Math.floor((Date.now() - d) / (1000 * 3600 * 24));
    if (days <= 0) return 'today';
    if (days === 1) return '1d';
    if (days < 30) return `${days}d`;
    if (days < 90) return `${Math.floor(days / 7)}w`;
    return `${Math.floor(days / 30)}mo`;
  } catch { return iso; }
}

function readRecent(): EarningsSearchResult[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

function pushRecent(r: EarningsSearchResult) {
  if (typeof window === 'undefined') return;
  try {
    const cur = readRecent().filter((x) => x.ticker !== r.ticker || x.filing_date !== r.filing_date);
    const next = [r, ...cur].slice(0, RECENT_CAP);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {}
}

// zzz277 — Local Conviction Beats + EI Elite bench fallback. Reads the user's
// persistent localStorage bench so search works even when the server-side KV
// cache has aged out (older filings drop from KV; the bench keeps them forever).
function searchLocalBench(q: string): EarningsSearchResult[] {
  if (typeof window === 'undefined') return [];
  const Q = q.trim().toUpperCase();
  if (Q.length < 2) return [];
  const out: EarningsSearchResult[] = [];
  const scoreMatch = (t: string, c: strine): number => {
    if (t === Q) return 100;
    if (t.startsWith(Q)) return 70;
    if (t.includes(Q)) return 35;
    if (c.startsWith(Q)) return 50;
    if (c.includes(Q)) return 20;
    return 0;
  };
  // Conviction Beats bench (map keyed by TICKER or TICKER@Q-FY).
  // zzz281 — dedup by ticker, keep the LATEST filing_date. User bench often has
  // both a bare-ticker entry (older Q) and composite-key entries (newer Qs);
  // returning both makes clicks land on the stale older date.
  try {
    const raw = localStorage.getItem('mc:conviction-beats:v1');
    const map = raw ? JSON.parse(raw) : {};
    const bestByTicker = new Map<string, EarningsSearchResult>();
    for (const key of Object.keys(map || {})) {
      const e = map[key];
      if (!e || !e.ticker) continue;
      const t = String(e.ticker).toUpperCase();
      const c = String(e.company || '').toUpperCase();
      if (scoreMatch(t, c) <= 0) continue;
      const tier = (e.tier === 'BLOCKBUSTER' || e.tier === 'STRONG') ? e.tier : 'STRONG';
      const candidate: EarningsSearchResult = {
        ticker: t,
        company: e.company || t,
        filing_date: e.filing_date || '',
        tier,
        sector: e.sector,
        market_cap_cr: typeof e.market_cap_cr === 'number' ? e.market_cap_cr : null,
        quarter: e.quarter && e.fiscal_year ? `${e.quarter} FY${String(e.fiscal_year).slice(-2)}` : undefined,
        composite_score: typeof e.composite_score === 'number' ? e.composite_score : undefined,
      };
      const existing = bestByTicker.get(t);
      if (!existing || (candidate.filing_date && candidate.filing_date > (existing.filing_date || ''))) {
        bestByTicker.set(t, candidate);
      }
    }
    for (const r of bestByTicker.values()) out.push(r);
  } catch {}
  // EI Elite bench (mc:ei-elite:v1) — array of {symbol, company, grade, ...}
  try {
    const raw = localStorage.getItem('mc:ei-elite:v1');
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) {
      for (const e of arr) {
        if (!e || !e.symbol) continue;
        const t = String(e.symbol).toUpperCase();
        const c = String(e.company || '').toUpperCase();
        if (scoreMatch(t, c) <= 0) continue;
        out.push({
          ticker: t,
          company: e.company || t,
          filing_date: e.filed_date || e.resultDate || '',
          tier: 'STRONG',
          market_cap_cr: typeof e.marketCapCr === 'number' ? e.marketCapCr : null,
          quarter: e.period || undefined,
        });
      }
    }
  } catch {}
  return out;
}

function mergeResults(server: EarningsSearchResult[], local: EarningsSearchResult[]): EarningsSearchResult[] {
  const seen = new Set<string>();
  const merged: EarningsSearchResult[] = [];
  for (const r of server) {
    const k = r.ticker + '@' + (r.quarter || r.filing_date);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(r);
  }
  for (const r of local) {
    const k = r.ticker + '@' + (r.quarter || r.filing_date);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(r);
  }
  return merged;
}

export default function EarningsSearch({ onSelect, placeholder = 'Search company or ticker (e.g. Asian, LAURUS)…' }: Props) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<EarningsSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [recent, setRecent] = useState<EarningsSearchResult[]>(() => readRecent());
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Debounced fetch (250ms)
  useEffect(() => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        abortRef.current?.abort();
        const ctrl = new AbortController();
        abortRef.current = ctrl;
        const res = await fetch(`/api/v1/earnings/search?q=${encodeURIComponent(trimmed)}&limit=25`, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) { setResults(searchLocalBench(trimmed)); return; }
        const j = await res.json();
        const serverResults = Array.isArray(j?.results) ? j.results : [];
        // zzz277 — always merge local bench so KV-expired entries still surface
        let merged = mergeResults(serverResults, searchLocalBench(trimmed));
        // zzz279 — Last-resort ticker probe: if the graded pipeline missed this
        // filing (e.g. Syrma reported Q1 FY27 on 2026-07-29 but wasn't graded),
        // hit /api/market/earnings-scan which has broader coverage. Only fires
        // when the query looks like a bare ticker AND server+bench came up empty.
        if (merged.length === 0 && /^[A-Za-z][A-Za-z0-9\-]{2,14}$/.test(trimmed)) {
          try {
            const scanRes = await fetch('/api/market/earnings-scan?symbols=' + encodeURIComponent(trimmed.toUpperCase()), { cache: 'no-store', signal: ctrl.signal });
            if (scanRes.ok) {
              const scanJ = await scanRes.json();
              const card = Array.isArray(scanJ?.cards) ? scanJ.cards[0] : null;
              if (card && card.symbol) {
                // Derive filing_date from `period` quarter label (e.g. "Jun 2026" → filed Jul-Aug 2026 → use last day of that filing month heuristic)
                let filingDate = '';
                const pm = String(card.period || '').match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})/i);
                if (pm) {
                  const monthMap: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
                  const qEndMonth = monthMap[pm[1].toLowerCase().slice(0,3)];
                  // Filings typically land ~00-45 days after quarter end. Use mid-of-next-month as approximation.
                  const filedMonth = qEndMonth + 1 > 12 ? 1 : qEndMonth + 1;
                  const filedYear = qEndMonth + 1 > 12 ? Number(im[2]) + 1 : Number(pm[2]);
                  filingDate = `${filedYear}-${String(filedMonth).padStart(2,'0')}-15`;
                }
                const grade = String(card.grade || '').toUpperCase();
                const tier: Tier = grade === 'EXCELLENT' ? 'BLOCKBUSTER' : grade === 'STRONG' || grade === 'GOOD' ? 'STRONG' : 'MIXED';
                merged = [{
                  ticker: String(card.symbol).toUpperCase(),
                  company: card.company || card.symbol,
                  filing_date: '',
                  tier,
                  quarter: card.period || undefined,
                  composite_score: typeof card.totalScore === 'number' ? card.totalScore : undefined,
                  via_scan: true,
                }];
              }
            }
          } catch {}
        }
        setResults(merged);
        setActiveIdx(0);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const view: EarningsSearchResult[] = useMemo(() => {
    if (q.trim().length < 2) return recent;
    return results;
  }, [q, results, recent]);

  const handleSelect = useCallback((r: EarningsSearchResult) => {
    pushRecent(r);
    setRecent(readRecent());
    setOpen(false);
    setQ('');
    setResults([]);
    onSelect(r);
  }, [onSelect]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') { setOpen(true); e.preventDefault(); }
      return;
    }
    if (e.key === 'ArrowDown') { setActiveIdx((i) => Math.min(view.length - 1, i + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setActiveIdx((i) => Math.max(0, i - 1)); e.preventDefault(); }
    else if (e.key === 'Enter') {
      const picked = view[activeIdx];
      if (picked) handleSelect(picked);
      e.preventDefault();
    }
    else if (e.key === 'Escape') { setOpen(false); e.preventDefault(); }
  }, [open, view, activeIdx, handleSelect]);

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth: 280, flex: '0 1 380px' }}>
      <div style={{ position: 'relative' }}>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          style={{
            width: '100%',
            padding: '8px 32px 8px 32px',
            fontSize: 13,
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
            background: 'var(--mc-bg-1)',
            color: 'var(--mc-text-1)',
            border: '1px solid var(--mc-border-1)',
            borderRadius: 6,
            outline: 'none',
          }}
        />
        <span style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--mc-text-3)', pointerEvents: 'none' }}>🔍</span>
        {loading && (
          <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontSize: 10, color: 'var(--mc-text-3)' }}>…</span>
        )}
        {!loading && q && (
          <button
            onClick={() => { setQ(''); setResults([]); inputRef.current?.focus(); }}
            style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', color: 'var(--mc-text-3)', cursor: 'pointer', fontSize: 14, padding: 2 }}
            aria-label="Clear"
          >×</button>
        )}
      </div>

      {open && view.length > 0 && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 50,
            maxHeight: 400,
            overflowY: 'auto',
            background: 'var(--mc-bg-1)',
            border: '1px solid var(--mc-border-2)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          }}
        >
          {q.trim().length < 2 && recent.length > 0 && (
            <div style={{ padding: '6px 12px', fontSize: 9, color: 'var(--mc-text-4)', letterSpacing: 0.5, fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid var(--mc-border-1)' }}>
              ⏱ RECENT PICKS
            </div>
          )}
          {view.map((r, i) => {
            const chip = TIER_CHIP[r.tier];
            const active = i === activeIdx;
            return (
              <div
                key={r.ticker + ':' + r.filing_date + ':' + (r.quarter || '')}
                onMouseEnter={() => setActiveIdx(i)}
                onMouseDown={(e) => { e.preventDefault(); handleSelect(r); }}
                role="option"
                aria-selected={active}
                style={{
                  padding: '8px 12px',
                  cursor: 'pointer',
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr auto',
                  gap: 10,
                  alignItems: 'center',
                  background: active ? 'color-mix(in srgb, var(--mc-cyan) 12%, transparent)' : 'transparent',
                  borderBottom: '1px solid var(--mc-border-1)',
                  fontSize: 12,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', color: 'var(--mc-cyan)', fontWeight: 800, fontSize: 12 }}>{r.ticker}</span>
                  <span style={{ fontSize: 9, color: 'var(--mc-text-4)' }}>{r.quarter || ''}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ color: 'var(--mc-text-1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.company}</span>
                  <span style={{ fontSize: 10, color: 'var(--mc-text-3)' }}>
                    {r.sector ? r.sector + ' · ' : ''}{r.filing_date} <span style={{ color: 'var(--mc-text-4)' }}>({daysAgo(r.filing_date)})</span>
                  </span>
                </div>
                <span style={{ background: chip.bg, color: chip.fg, padding: '2px 8px', borderRadius: 4, fontSize: 9, fontWeight: 800, letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
                  {chip.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {open && q.trim().length >= 2 && !loading && view.length === 0 && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 50, padding: '12px 14px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)', borderRadius: 8, fontSize: 12, color: 'var(--mc-text-3)' }}>
          No filings match <b style={{ color: 'var(--mc-text-1)' }}>{q}</b> in the last 120 days.
        </div>
      )}
    </div>
  );
}
