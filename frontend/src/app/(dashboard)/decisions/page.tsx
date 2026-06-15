'use client';

// ═══════════════════════════════════════════════════════════════════════════
// DECISION LOGBOOK — PATCH 0454 TIER1-A
//
// Queryable journal of every BUY / WATCH / NEUTRAL / REJECTED decision the
// user has logged across Multibagger India + USA. Per audit:
//   • Filter by status × market × date range × free-text search.
//   • Sort by date / symbol / score-at-decision.
//   • Inline "current vs decision" delta (score then vs now).
//   • CSV export for compliance / audit / external review.
// Builds entirely from the existing /lib/decisions.ts localStorage store.
// No new API surface needed.
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useState } from 'react';
import { Trash2, Download, Filter, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { readDecisions, clearDecision, subscribeDecisions, setDecision, DECISION_META, type Decision, type DecisionStatus, type DecisionMarket } from '@/lib/decisions';
import { canonicalTicker } from '@/lib/ticker-normalize'; // PATCH 0721

type StatusFilter = 'ALL' | DecisionStatus;
type MarketFilter = 'ALL' | DecisionMarket;
type SortKey = 'date' | 'symbol' | 'score';

// PATCH 0569 (UX #7) — Pre-populated example decisions shown only when
// the logbook is empty. Rendered greyed-out below the empty-state CTA so
// first-time users see what the table looks like once they start logging.
// These are never persisted; they exist purely as visual scaffolding.
const EXAMPLE_DECISIONS: Decision[] = [
  {
    symbol: 'EXAMPLE-1',
    market: 'IN',
    status: 'BUY',
    company: 'Example Industrial Co.',
    reason: 'Operating leverage cluster — capacity util 78 → 92%, margin inflection confirmed.',
    scoreAtDecision: 87,
    gradeAtDecision: 'A',
    date: new Date(Date.now() - 12 * 24 * 3600_000).toISOString(),
  },
  {
    symbol: 'EXAMPLE-2',
    market: 'US',
    status: 'WATCH',
    company: 'Example Tech Holdings',
    reason: 'Pricing power signal but FCF margin lagging — wait for next Q before adding.',
    scoreAtDecision: 71,
    gradeAtDecision: 'B+',
    date: new Date(Date.now() - 5 * 24 * 3600_000).toISOString(),
  },
  {
    symbol: 'EXAMPLE-3',
    market: 'IN',
    status: 'REJECTED',
    company: 'Example Cyclicals Ltd.',
    reason: 'Mostly forward-looking commentary, debt rising, WC days deteriorating. Pass.',
    scoreAtDecision: 54,
    gradeAtDecision: 'C',
    date: new Date(Date.now() - 2 * 24 * 3600_000).toISOString(),
  },
];

const BG = '#0A0E1A';
const CARD = '#0D1623';
const BORDER = '#1A2540';
const TEXT = '#E6EDF3';
const DIM = '#8A95A3';

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>(() => readDecisions());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [marketFilter, setMarketFilter] = useState<MarketFilter>('ALL');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  // PATCH 0487 QA-#19 — manual entry modal so user can add a decision
  // directly without having to open Multibagger and expand a row.
  const [showAdd, setShowAdd] = useState(false);
  const [addSymbol, setAddSymbol] = useState('');
  const [addMarket, setAddMarket] = useState<DecisionMarket>('IN');
  const [addStatus, setAddStatus] = useState<DecisionStatus>('WATCH');
  const [addCompany, setAddCompany] = useState('');
  const [addReason, setAddReason] = useState('');
  // PATCH 0600 — ticker → company resolver. Built once from the same data
  // sources that power the other analytics surfaces, so adding a decision
  // by ticker auto-fills the company name field instead of forcing the
  // user to type it twice. Sources in priority order:
  //   1. mb_excel_scored_v2  (India Multibagger uploads)
  //   2. mb_usa_scored_v1    (USA Multibagger uploads)
  //   3. mc:conviction-beats:v1
  //   4. Existing decisions (for already-tagged tickers)
  const tickerToCompany = useMemo<Map<string, { company: string; market?: DecisionMarket }>>(() => {
    const m = new Map<string, { company: string; market?: DecisionMarket }>();
    if (typeof window === 'undefined') return m;
    const add = (sym: any, company: any, market?: DecisionMarket) => {
      const k = canonicalTicker(sym); // PATCH 0721
      const c = String(company || '').trim();
      if (k && c && !m.has(k)) m.set(k, { company: c, market });
    };
    try {
      const ind = JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]');
      if (Array.isArray(ind)) for (const r of ind) add(r?.symbol, r?.company, 'IN');
    } catch {}
    try {
      const us = JSON.parse(localStorage.getItem('mb_usa_scored_v1') || '[]');
      if (Array.isArray(us)) for (const r of us) add(r?.symbol, r?.company || r?.companyName, 'US');
    } catch {}
    try {
      const cb = JSON.parse(localStorage.getItem('mc:conviction-beats:v1') || '{}');
      if (cb && typeof cb === 'object') {
        for (const k of Object.keys(cb)) add(cb[k]?.ticker || k, cb[k]?.company);
      }
    } catch {}
    // Also seed from existing decisions so the next manual entry of the same
    // ticker auto-fills from the user's prior tagging.
    for (const d of Object.values(decisions)) {
      if (d.company) add(d.symbol, d.company, d.market);
    }
    return m;
  }, [decisions]);

  // When user types in SYMBOL field, look up + auto-fill company + market.
  // Doesn't overwrite if user has already typed something in COMPANY NAME.
  const handleSymbolChange = (raw: string) => {
    const upper = raw.toUpperCase();
    setAddSymbol(upper);
    const stripped = canonicalTicker(upper); // PATCH 0721
    const hit = tickerToCompany.get(stripped);
    if (hit) {
      if (!addCompany.trim()) setAddCompany(hit.company);
      if (hit.market) setAddMarket(hit.market);
    }
  };

  const submitNewDecision = () => {
    const sym = addSymbol.trim().toUpperCase();
    if (!sym) return;
    setDecision({
      symbol: sym, market: addMarket, status: addStatus,
      company: addCompany.trim() || undefined,
      reason: addReason.trim(),
    });
    // Reset & close
    setAddSymbol(''); setAddCompany(''); setAddReason('');
    setAddStatus('WATCH'); setAddMarket('IN');
    setShowAdd(false);
  };

  // Subscribe to cross-tab decision updates.
  useEffect(() => {
    const unsub = subscribeDecisions(() => setDecisions(readDecisions()));
    return unsub;
  }, []);

  // PATCH 0852 — Live-price lookup for buy-the-dip helper on REJECTED entries.
  // Fetch /api/market/quotes once on mount, build a ticker→price map.
  // PATCH 0966 — Pattern C: add 18s AbortSignal timeout so a hung quotes
  // endpoint doesn't leave the request dangling; dev-only warn on failure.
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  useEffect(() => {
    let cancelled = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 18_000);
    (async () => {
      try {
        const r = await fetch('/api/market/quotes?market=india', { cache: 'no-store', signal: ctl.signal });
        if (!r.ok) return;
        const j = await r.json();
        if (cancelled) return;
        const map: Record<string, number> = {};
        for (const s of (j?.stocks || [])) {
          if (s.ticker && s.price) map[String(s.ticker).toUpperCase()] = Number(s.price);
        }
        setLivePrices(map);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (process.env.NODE_ENV !== 'production') console.warn('[decisions] livePrices fetch failed:', err);
      } finally { clearTimeout(timer); }
    })();
    return () => { cancelled = true; clearTimeout(timer); ctl.abort(); };
  }, []);

  // PATCH 0856 — News-since-decision feed. Bulk-fetch /api/v1/news once,
  // index by ticker, then for each decision row filter to articles
  // published AFTER the decision date. Helps user audit thesis evolution:
  // 'I bought at ₹X, here are the N news items that came after — did any
  // contradict my thesis?'.
  const [newsByTicker, setNewsByTicker] = useState<Record<string, Array<{title: string; published_at: string; url?: string; source?: string}>>>({});
  // PATCH 0966 — Pattern C: news fetch had no timeout; news service is often
  // the slowest dependency. 20s ceiling + dev-only warn.
  useEffect(() => {
    let cancelled = false;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    (async () => {
      try {
        const r = await fetch('/api/v1/news?limit=300', { cache: 'no-store', signal: ctl.signal });
        if (!r.ok || cancelled) return;
        const list = await r.json();
        if (!Array.isArray(list) || cancelled) return;
        const map: Record<string, Array<{title: string; published_at: string; url?: string; source?: string}>> = {};
        for (const a of list) {
          const tickers: string[] = a?.ticker_symbols || [];
          const title = a?.title || a?.headline;
          if (!tickers.length || !title || !a?.published_at) continue;
          for (const t of tickers) {
            const k = String(t).toUpperCase();
            if (!map[k]) map[k] = [];
            map[k].push({ title, published_at: a.published_at, url: a.url || a.source_url, source: a.source_name || a.source });
          }
        }
        if (!cancelled) setNewsByTicker(map);
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (process.env.NODE_ENV !== 'production') console.warn('[decisions] newsByTicker fetch failed:', err);
      } finally { clearTimeout(timer); }
    })();
    return () => { cancelled = true; clearTimeout(timer); ctl.abort(); };
  }, []);

  // Filtered + sorted rows.
  const rows = useMemo(() => {
    const all = Object.values(decisions);
    const q = search.trim().toLowerCase();
    const filtered = all.filter(d => {
      if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
      if (marketFilter !== 'ALL' && d.market !== marketFilter) return false;
      if (q) {
        const blob = `${d.symbol} ${d.company || ''} ${d.reason || ''}`.toLowerCase();
        if (!blob.includes(q)) return false;
      }
      return true;
    });
    filtered.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') cmp = (a.date || '').localeCompare(b.date || '');
      else if (sortBy === 'symbol') cmp = a.symbol.localeCompare(b.symbol);
      else if (sortBy === 'score') cmp = (a.scoreAtDecision ?? 0) - (b.scoreAtDecision ?? 0);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [decisions, statusFilter, marketFilter, search, sortBy, sortDir]);

  // AUDIT_100 #59 — outcome tracking. Look up the current score from the
  // multibagger localStorage so each decision shows score-now vs score-at-
  // decision. Price tracking would require fresh quotes; deferred. Score
  // alone is signal-rich because re-scoring on a fresh CSV upload captures
  // earnings/fundamentals updates.
  const currentScoreMap = useMemo(() => {
    if (typeof window === 'undefined') return new Map<string, { score?: number; grade?: string }>();
    const m = new Map<string, { score?: number; grade?: string }>();
    try {
      const inScored = JSON.parse(localStorage.getItem('mb_excel_scored_v2') || '[]');
      if (Array.isArray(inScored)) for (const r of inScored) {
        if (r?.symbol) m.set(String(r.symbol).toUpperCase() + '|IN', { score: r.composite ?? r.score, grade: r.grade });
      }
    } catch {}
    try {
      const usScored = JSON.parse(localStorage.getItem('mb_usa_scored_v1') || '[]');
      if (Array.isArray(usScored)) for (const r of usScored) {
        if (r?.symbol) m.set(String(r.symbol).toUpperCase() + '|US', { score: r.score, grade: r.grade });
      }
    } catch {}
    return m;
  }, [decisions]);

  const counts = useMemo(() => {
    const c: Record<DecisionStatus, number> = { BUY: 0, WATCH: 0, NEUTRAL: 0, REJECTED: 0 };
    Object.values(decisions).forEach(d => { c[d.status]++; });
    return c;
  }, [decisions]);

  const exportCsv = () => {
    const header = ['Symbol', 'Market', 'Status', 'Date', 'Company', 'Score@Decision', 'Grade@Decision', 'Reason'];
    const lines = [header.join(',')];
    for (const d of rows) {
      const row = [
        d.symbol,
        d.market,
        d.status,
        d.date ? new Date(d.date).toISOString().slice(0, 10) : '',
        (d.company || '').replace(/,/g, ';'),
        d.scoreAtDecision != null ? String(d.scoreAtDecision) : '',
        d.gradeAtDecision || '',
        (d.reason || '').replace(/[,\r\n]/g, ' ').slice(0, 200),
      ];
      lines.push(row.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `decisions-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div style={{ minHeight: '100%', background: BG, color: TEXT, padding: '20px 24px' }}>
      <div style={{ maxWidth: 1400, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>📒 Decision Logbook</h1>
          <span style={{ fontSize: 12, color: DIM }}>
            Every BUY / WATCH / NEUTRAL / REJECTED you logged. Survives uploads + clears.
          </span>
          <button
            onClick={() => setShowAdd(true)}
            style={{
              marginLeft: 'auto', padding: '6px 12px', borderRadius: 6,
              background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', color: 'var(--mc-bullish)',
              fontSize: 12, fontWeight: 700, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
            title="Add a decision manually without opening Multibagger"
          >
            <Plus size={12} /> NEW DECISION
          </button>
          <button
            onClick={exportCsv}
            disabled={rows.length === 0}
            style={{
              padding: '6px 12px', borderRadius: 6,
              background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)',
              fontSize: 12, fontWeight: 700, cursor: rows.length ? 'pointer' : 'not-allowed',
              display: 'inline-flex', alignItems: 'center', gap: 6,
              opacity: rows.length ? 1 : 0.4,
            }}
          >
            <Download size={12} /> EXPORT CSV ({rows.length})
          </button>
        </div>

        {/* PATCH 0487 QA-#19 — Manual decision entry modal */}
        {showAdd && (
          <div onClick={() => setShowAdd(false)} style={{
            position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 200,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div onClick={(e) => e.stopPropagation()} style={{
              backgroundColor: CARD, border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: 24, minWidth: 420, maxWidth: 520, width: '90vw',
            }}>
              <h2 style={{ margin: 0, marginBottom: 16, fontSize: 18, fontWeight: 800, color: TEXT }}>
                + New Decision
              </h2>
              <div style={{ display: 'grid', gap: 12 }}>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>
                  SYMBOL
                  {/* PATCH 0600 — onChange goes through handleSymbolChange
                      which auto-resolves the company name from
                      Multibagger / Conviction Beats / prior decisions
                      caches the moment the user finishes typing. */}
                  <input
                    autoFocus
                    value={addSymbol}
                    onChange={(e) => handleSymbolChange(e.target.value)}
                    placeholder="e.g. RELIANCE / TCS / NVDA"
                    style={{
                      width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 5,
                      border: `1px solid ${BORDER}`, background: BG, color: TEXT,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      fontSize: 14, fontWeight: 700, textTransform: 'uppercase',
                    }}
                    list="decision-ticker-suggestions"
                  />
                  {/* PATCH 0600 — datalist drives browser-native autocomplete
                      from the same resolver Map. User types 'REL' and sees
                      RELIANCE / RELAXO / etc. */}
                  <datalist id="decision-ticker-suggestions">
                    {Array.from(tickerToCompany.entries()).slice(0, 200).map(([sym, meta]) => (
                      <option key={sym} value={sym}>{meta.company}</option>
                    ))}
                  </datalist>
                  {/* PATCH 0600 — Show the resolved company below the field
                      when the user has typed a known ticker. Gives instant
                      visual confirmation the auto-fill happened. */}
                  {(() => {
                    const k = canonicalTicker(addSymbol); // PATCH 0721
                    const hit = k && tickerToCompany.get(k);
                    if (hit) {
                      return (
                        <div style={{ marginTop: 4, fontSize: 10, color: 'var(--mc-bullish)', fontWeight: 600 }}>
                          ✓ resolved: {hit.company}{hit.market ? ` · ${hit.market === 'IN' ? '🇮🇳' : '🇺🇸'}` : ''}
                        </div>
                      );
                    }
                    if (k && k.length >= 3) {
                      return (
                        <div style={{ marginTop: 4, fontSize: 10, color: DIM, fontStyle: 'italic' }}>
                          ↳ not in Multibagger / Conviction Beats cache — type the company name below manually.
                        </div>
                      );
                    }
                    return null;
                  })()}
                </label>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>
                  COMPANY NAME (auto-filled when ticker is recognised)
                  <input
                    value={addCompany}
                    onChange={(e) => setAddCompany(e.target.value)}
                    placeholder="e.g. Reliance Industries"
                    style={{
                      width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 5,
                      border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 13,
                    }}
                  />
                </label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 4 }}>MARKET</div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {(['IN', 'US'] as DecisionMarket[]).map((m) => (
                        <button key={m} onClick={() => setAddMarket(m)} style={{
                          flex: 1, padding: '6px 10px', borderRadius: 5,
                          border: `1px solid ${addMarket === m ? 'var(--mc-cyan)' : BORDER}`,
                          background: addMarket === m ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
                          color: addMarket === m ? 'var(--mc-cyan)' : DIM,
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}>{m}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: DIM, fontWeight: 700, marginBottom: 4 }}>STATUS</div>
                    <select
                      value={addStatus}
                      onChange={(e) => setAddStatus(e.target.value as DecisionStatus)}
                      style={{
                        width: '100%', padding: '6px 10px', borderRadius: 5,
                        border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 12, fontWeight: 700,
                      }}
                    >
                      {(['BUY','WATCH','NEUTRAL','REJECTED'] as DecisionStatus[]).map((s) => (
                        <option key={s} value={s}>{DECISION_META[s].emoji} {s}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <label style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>
                  REASON / NOTE
                  <textarea
                    value={addReason}
                    onChange={(e) => setAddReason(e.target.value)}
                    placeholder="Why this decision? Thesis, risk note, or trigger."
                    rows={3}
                    style={{
                      width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 5,
                      border: `1px solid ${BORDER}`, background: BG, color: TEXT, fontSize: 12,
                      resize: 'vertical', fontFamily: 'inherit',
                    }}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <button onClick={() => setShowAdd(false)} style={{
                    flex: 1, padding: '8px 12px', borderRadius: 5,
                    border: `1px solid ${BORDER}`, background: 'transparent', color: DIM,
                    fontSize: 12, fontWeight: 700, cursor: 'pointer',
                  }}>Cancel</button>
                  <button onClick={submitNewDecision} disabled={!addSymbol.trim()} style={{
                    flex: 2, padding: '8px 12px', borderRadius: 5,
                    border: '1px solid var(--mc-bullish)',
                    background: addSymbol.trim() ? 'color-mix(in srgb, var(--mc-bullish) 15%, transparent)' : 'transparent',
                    color: addSymbol.trim() ? 'var(--mc-bullish)' : DIM,
                    fontSize: 12, fontWeight: 700, cursor: addSymbol.trim() ? 'pointer' : 'not-allowed',
                  }}>Save Decision</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status summary chips */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
          {(['ALL', 'BUY', 'WATCH', 'NEUTRAL', 'REJECTED'] as const).map(s => {
            const isActive = statusFilter === s;
            const meta = s === 'ALL' ? { color: '#22D3EE', emoji: '🎯', label: 'ALL' } : DECISION_META[s];
            const n = s === 'ALL' ? Object.keys(decisions).length : counts[s];
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: `1px solid ${isActive ? meta.color : BORDER}`,
                  background: isActive ? `${meta.color}20` : 'transparent',
                  color: isActive ? meta.color : DIM,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {meta.emoji} {meta.label} · {n}
              </button>
            );
          })}
          <span style={{ width: 1, background: BORDER, margin: '4px 4px' }} />
          {(['ALL', 'IN', 'US'] as const).map(m => {
            const isActive = marketFilter === m;
            return (
              <button
                key={m}
                onClick={() => setMarketFilter(m)}
                style={{
                  padding: '6px 12px', borderRadius: 6,
                  border: `1px solid ${isActive ? 'var(--mc-state-persistent)' : BORDER}`,
                  background: isActive ? 'color-mix(in srgb, var(--mc-state-persistent) 13%, transparent)' : 'transparent',
                  color: isActive ? 'var(--mc-state-persistent)' : DIM,
                  fontSize: 12, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {m === 'IN' ? '🇮🇳 INDIA' : m === 'US' ? '🇺🇸 USA' : '🌐 ALL'}
              </button>
            );
          })}
        </div>

        {/* Search + sort */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search symbol / company / reason…"
            style={{
              flex: '1 1 280px', maxWidth: 480,
              padding: '7px 12px', borderRadius: 6,
              border: `1px solid ${BORDER}`, background: CARD, color: TEXT,
              fontSize: 13, outline: 'none',
            }}
          />
          <span style={{ fontSize: 11, color: DIM, fontWeight: 700 }}>SORT:</span>
          {(['date', 'symbol', 'score'] as const).map(k => {
            const isActive = sortBy === k;
            return (
              <button
                key={k}
                onClick={() => {
                  if (sortBy === k) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
                  else { setSortBy(k); setSortDir('desc'); }
                }}
                style={{
                  padding: '5px 10px', borderRadius: 5,
                  border: `1px solid ${isActive ? 'var(--mc-cyan)' : BORDER}`,
                  background: isActive ? 'color-mix(in srgb, var(--mc-cyan) 13%, transparent)' : 'transparent',
                  color: isActive ? 'var(--mc-cyan)' : DIM,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer',
                }}
              >
                {k.toUpperCase()} {isActive ? (sortDir === 'asc' ? '↑' : '↓') : ''}
              </button>
            );
          })}
        </div>

        {/* Table */}
        {rows.length === 0 ? (
          <>
            <div style={{ padding: '32px 24px', textAlign: 'center', color: DIM, border: `1px solid ${BORDER}`, borderRadius: 8, background: CARD }}>
              <div style={{ fontSize: 36, marginBottom: 10 }}>📒</div>
              <p style={{ margin: 0, fontWeight: 700, color: TEXT }}>No decisions logged yet</p>
              <p style={{ margin: '6px 0 0', fontSize: 12 }}>
                Open Multibagger India or USA, expand any row, and click BUY / WATCH / NEUTRAL / REJECTED to start your logbook —
                or use the <strong style={{ color: 'var(--mc-bullish)' }}>+ NEW DECISION</strong> button above to add one manually.
              </p>
              <button onClick={() => setShowAdd(true)} style={{
                marginTop: 14, padding: '8px 18px', borderRadius: 6,
                background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 38%, transparent)', color: 'var(--mc-bullish)',
                fontSize: 12, fontWeight: 700, cursor: 'pointer',
              }}>+ Add Your First Decision</button>
            </div>

            {/* PATCH 0569 (UX #7) — Greyed-out example rows. Pre-populated
                so first-time users see what the table looks like once they
                start logging. These are not persisted and won't appear once
                a real decision exists. */}
            <div style={{ marginTop: 18, opacity: 0.42, pointerEvents: 'none' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: DIM, letterSpacing: '0.6px', margin: '0 0 8px', textTransform: 'uppercase' }}>
                ↓ Example layout — these rows are illustrative and will be replaced by your actual decisions
              </div>
              <div style={{ background: CARD, border: `1px dashed ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--mc-bg-0)', borderBottom: `1px solid ${BORDER}` }}>
                      <th style={th}>STATUS</th>
                      <th style={th}>SYMBOL</th>
                      <th style={th}>MKT</th>
                      <th style={th}>COMPANY</th>
                      <th style={{ ...th, textAlign: 'right' }}>SCORE</th>
                      <th style={{ ...th, textAlign: 'right' }}>GRADE</th>
                      <th style={th}>DATE</th>
                      <th style={th}>REASON</th>
                    </tr>
                  </thead>
                  <tbody>
                    {EXAMPLE_DECISIONS.map((d, i) => {
                      const meta = DECISION_META[d.status];
                      return (
                        <tr key={d.symbol} style={{ borderBottom: i < EXAMPLE_DECISIONS.length - 1 ? `1px solid ${BORDER}` : 'none' }}>
                          <td style={td}>
                            <span style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '2px 8px', borderRadius: 4,
                              background: `${meta.color}20`, color: meta.color,
                              border: `1px solid ${meta.color}40`,
                              fontSize: 11, fontWeight: 800,
                            }}>{meta.emoji} {meta.label}</span>
                          </td>
                          <td style={{ ...td, fontWeight: 700, color: 'var(--mc-cyan)' }}>{d.symbol}</td>
                          <td style={td}>{d.market === 'IN' ? '🇮🇳' : '🇺🇸'}</td>
                          <td style={{ ...td, color: TEXT, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.company || '—'}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                            {d.scoreAtDecision != null ? d.scoreAtDecision.toFixed(0) : '—'}
                          </td>
                          <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{d.gradeAtDecision || '—'}</td>
                          <td style={{ ...td, color: DIM, fontSize: 12, whiteSpace: 'nowrap' }}>
                            {d.date ? new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                          </td>
                          <td style={{ ...td, color: DIM, fontStyle: 'italic', fontSize: 12, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {d.reason || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--mc-bg-0)', borderBottom: `1px solid ${BORDER}` }}>
                  <th style={th}>STATUS</th>
                  <th style={th}>SYMBOL</th>
                  <th style={th}>MKT</th>
                  <th style={th}>COMPANY</th>
                  <th style={{ ...th, textAlign: 'right' }}>SCORE</th>
                  <th style={{ ...th, textAlign: 'right' }} title="Score now (from latest CSV upload). Δ vs decision-time score below.">NOW</th>
                  <th style={{ ...th, textAlign: 'right' }}>GRADE</th>
                  <th style={th}>DATE</th>
                  <th style={th}>REASON</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => {
                  const meta = DECISION_META[d.status];
                  return (
                    <tr key={d.symbol} style={{ borderBottom: i < rows.length - 1 ? `1px solid ${BORDER}` : 'none', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={td}>
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '2px 8px', borderRadius: 4,
                          background: `${meta.color}20`, color: meta.color,
                          border: `1px solid ${meta.color}40`,
                          fontSize: 11, fontWeight: 800,
                        }}>{meta.emoji} {meta.label}</span>
                      </td>
                      <td style={{ ...td, fontWeight: 700, color: 'var(--mc-cyan)' }}>{d.symbol}</td>
                      <td style={td}>{d.market === 'IN' ? '🇮🇳' : '🇺🇸'}</td>
                      <td style={{ ...td, color: TEXT, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {d.company || '—'}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {d.scoreAtDecision != null ? d.scoreAtDecision.toFixed(0) : '—'}
                      </td>
                      {/* AUDIT_100 #59 — outcome tracking (score now). */}
                      <td style={{ ...td, textAlign: 'right', fontFamily: 'ui-monospace, monospace' }}>
                        {(() => {
                          const now = currentScoreMap.get(d.symbol.toUpperCase() + '|' + d.market);
                          // PATCH 1086 — MED-07: signal pending/failed fetch with loading dots instead of bare em-dash
                          if (!now || now.score == null) return <span style={{ color: DIM }} title="live price unavailable">⋯</span>;
                          const delta = (d.scoreAtDecision != null) ? Math.round(now.score) - Math.round(d.scoreAtDecision) : null;
                          const deltaColor = delta == null ? DIM : delta > 0 ? '#10B981' : delta < 0 ? '#EF4444' : DIM;
                          return (
                            <span title={`Latest re-score from CSV upload. Decision-time score was ${d.scoreAtDecision ?? 'n/a'}.`}>
                              <span style={{ color: TEXT }}>{Math.round(now.score)}</span>
                              {delta != null && <span style={{ color: deltaColor, marginLeft: 4, fontSize: 11 }}>{delta > 0 ? '▲+' : delta < 0 ? '▼' : '='}{Math.abs(delta) || ''}</span>}
                            </span>
                          );
                        })()}
                      </td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{d.gradeAtDecision || '—'}</td>
                      <td style={{ ...td, color: DIM, fontSize: 12, whiteSpace: 'nowrap' }}>
                        {d.date ? new Date(d.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}
                      </td>
                      <td style={{ ...td, color: DIM, fontStyle: 'italic', fontSize: 12, maxWidth: 360 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.reason || '—'}</div>
                        {/* PATCH 0852 — Buy-the-dip helper for REJECTED entries.
                            When live price has dropped >25% since rejection date,
                            surface a 'RE-EVALUATE?' chip with the price-drop %
                            so the user is prompted to reconsider previously-rejected
                            names where the bear case may have already played out. */}
                        {(() => {
                          if (d.status !== 'REJECTED') return null;
                          const live = livePrices[(d.symbol || '').toUpperCase()];
                          if (!live || !d.priceAtDecision || d.priceAtDecision <= 0) return null;
                          const dropPct = ((live - d.priceAtDecision) / d.priceAtDecision) * 100;
                          if (dropPct > -25) return null;  // only fire when price fell ≥25%
                          return (
                            <div style={{ marginTop: 4, fontSize: 10, fontWeight: 800, color: 'var(--mc-bullish)', background: 'color-mix(in srgb, var(--mc-bullish) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-bullish) 25%, transparent)', borderRadius: 3, padding: '3px 7px', display: 'inline-block', fontStyle: 'normal' }} title={`Rejected at ₹${d.priceAtDecision.toFixed(0)}, now ₹${live.toFixed(0)} — fundamentals unchanged?`}>
                              ⤴ RE-EVALUATE? · {dropPct.toFixed(0)}% since reject
                            </div>
                          );
                        })()}
                        {/* Bull/Bear quick-glance when present */}
                        {(d.bullCase || d.bearCase || d.wouldChangeMind) && (
                          <div style={{ marginTop: 4, fontSize: 10, color: DIM, fontStyle: 'normal' }}>
                            {d.bullCase && <span style={{ color: 'var(--mc-bullish)', marginRight: 8 }} title={d.bullCase}>▲ bull</span>}
                            {d.bearCase && <span style={{ color: 'var(--mc-bearish)', marginRight: 8 }} title={d.bearCase}>▼ bear</span>}
                            {d.wouldChangeMind && <span style={{ color: 'var(--mc-cyan)' }} title={d.wouldChangeMind}>↻ change-mind</span>}
                          </div>
                        )}
                        {/* PATCH 0856 — News-since-decision feed */}
                        {(() => {
                          const ticker = (d.symbol || '').toUpperCase();
                          const since = d.date ? new Date(d.date).getTime() : 0;
                          if (!since) return null;
                          const articles = newsByTicker[ticker] || [];
                          const fresh = articles.filter(a => {
                            const t = new Date(a.published_at).getTime();
                            return Number.isFinite(t) && t > since;
                          }).sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime());
                          if (fresh.length === 0) return null;
                          const tooltipText = fresh.slice(0, 5).map(a => `${a.published_at.slice(0,10)} · ${a.title}`).join('\n');
                          return (
                            <div style={{ marginTop: 4, fontSize: 10, fontStyle: 'normal' }}>
                              <span title={tooltipText}
                                style={{ color: 'var(--mc-cyan)', background: 'color-mix(in srgb, var(--mc-cyan) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', padding: '2px 6px', borderRadius: 3, fontWeight: 800 }}>
                                📰 {fresh.length} news since decision
                              </span>
                              {fresh[0]?.url ? (
                                <a href={fresh[0].url} target="_blank" rel="noreferrer noopener" style={{ marginLeft: 6, fontSize: 9, color: DIM }}>
                                  → latest: {fresh[0].title.slice(0, 60)}{fresh[0].title.length > 60 ? '…' : ''}
                                </a>
                              ) : (
                                <span style={{ marginLeft: 6, fontSize: 9, color: DIM }}>
                                  → latest: {fresh[0].title.slice(0, 60)}{fresh[0].title.length > 60 ? '…' : ''}
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </td>
                      <td style={td}>
                        <button
                          onClick={() => {
                            // AUDIT_100 #5 — toast confirm in place of native window.confirm (iframe-safe + consistent app-wide).
                            toast((t) => (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <span>Remove decision for <strong>{d.symbol}</strong>?</span>
                                <button onClick={() => { clearDecision(d.symbol); toast.dismiss(t.id); toast.success(`${d.symbol} removed`); }}
                                  style={{ padding: '4px 10px', background: 'var(--mc-bearish)', color: '#fff', borderRadius: 4, border: 0, cursor: 'pointer', fontSize: 12 }}>Delete</button>
                                <button onClick={() => toast.dismiss(t.id)}
                                  style={{ padding: '4px 10px', background: 'transparent', color: 'var(--mc-text-3)', borderRadius: 4, border: '1px solid var(--mc-border-2)', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
                              </div>
                            ), { duration: 8000 });
                          }}
                          title="Remove this decision"
                          style={{ background: 'none', border: 'none', color: 'var(--mc-bearish)', cursor: 'pointer', padding: 4 }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 11, color: DIM, textAlign: 'right' }}>
            Logbook persists in your browser. Decisions survive Multibagger re-uploads, clear operations, and tab switches.
          </div>
        )}
      </div>
    </div>
  );
}

const th: React.CSSProperties = {
  padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 700,
  color: '#8BA3C1', letterSpacing: '0.5px',
};
const td: React.CSSProperties = { padding: '8px 12px', verticalAlign: 'middle' };
