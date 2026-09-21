// ═══════════════════════════════════════════════════════════════════════════
// PORTFOLIO CATALYSTS — WHAT CHANGED IN THE NAMES YOU OWN.          (zzz708)
//
// Everything else in this portal is a discovery surface: it finds companies.
// This one finds CHANGES, and only in the book. The question it answers is
// not "what should I buy" but "has anything happened to what I already hold
// that should make me add, trim or exit".
//
// WHY THIS IS NOT THE PORTFOLIO PAGE. That page answers "what am I worth" —
// positions, cost, P&L. It cannot tell you that a holding just commissioned a
// plant, raised guidance, or quietly stopped converting profit into cash.
// Those are the facts that end a thesis, and they were scattered across the
// earnings grader, the concall radar and the AI summary with no surface that
// gathered them per holding.
//
// WHAT IT SHOWS, and where each comes from — all existing engines, nothing
// new invented:
//
//   · the GRADE of the latest result (the India/US earnings graders)
//   · the CATALYSTS the AI Summary read out of the filing — capex with its
//     completion date, capacity, utilisation before and expected, order book,
//     guidance changes, one-offs
//   · WHY THE MARGIN MOVED, split structural vs cyclical
//   · the A/B/F/G pattern and, more importantly, ITS EXIT CONDITION
//   · the TRANSFORMATION radar score where the name appears in the concall feed
//
// THE EXIT CONDITION IS THE POINT. The owner's own forensic review priced his
// selling behaviour at roughly Rs 1.9 Cr of foregone gains, and every item on
// the "what does NOT end it" list — a drawdown, a weak market, one flat
// quarter — has triggered a sale in his ledger. So each holding carries the
// pattern-specific condition that actually ends its thesis, in words, next to
// the evidence. A price is never one of them.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { readPortfolioSymbols, normSymbol } from '@/lib/portfolio-symbols';
import { classifyGradedRow, ABFG_META, type AbfgResult } from '@/lib/earnings/pattern-abfg';
import { readConvictionBeats } from '@/lib/conviction-beats';

type Mkt = 'IN' | 'US';

interface HoldingRow {
  symbol: string;
  market: Mkt;
  graded: any | null;
  pattern: AbfgResult | null;
  radarScore: number | null;
  summary: any | null;          // the verified `structured` AI summary
  summaryState: 'idle' | 'loading' | 'done' | 'error';
  summaryError?: string;
}

const C = {
  bg: 'var(--mc-bg-1)', border: 'var(--mc-bg-4)', text: 'var(--mc-text-1)',
  dim: 'var(--mc-text-3)', faint: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#F59E0B', cyan: 'var(--mc-cyan)',
};

const said = (v: unknown): boolean => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 && !/^(not\s+(stated|disclosed|quantified|available|applicable|given|provided)|n\/?a|none|unknown|—|-)$/i.test(s);
};

export default function PortfolioCatalystsPage() {
  const [symbols, setSymbols] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, HoldingRow>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [onlyChanged, setOnlyChanged] = useState(false);

  // ── 1. The book. ────────────────────────────────────────────────────────
  useEffect(() => {
    try { setSymbols(Array.from(readPortfolioSymbols())); }
    catch { setSymbols([]); }
  }, []);

  // ── 2. The latest grade for each holding, from the engines that already
  //      produced one. The conviction bench is read first because it is a
  //      local store and answers instantly for the names on it.
  useEffect(() => {
    if (!symbols.length) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr(null);
      const next: Record<string, HoldingRow> = {};
      let bench: Record<string, any> = {};
      try { bench = readConvictionBeats(); } catch { bench = {}; }
      const benchByNorm = new Map(Object.entries(bench).map(([k, v]) => [normSymbol(k), v]));

      // Radar scores, one request for the whole feed.
      let radar = new Map<string, number>();
      try {
        const r = await fetch('/api/v1/concall-intel/transformation-screener?days=90&limit=200', { cache: 'no-store' });
        if (r.ok) {
          const j = await r.json();
          for (const e of (j?.entries || [])) {
            radar.set(normSymbol(e.symbol), e.transformation_score);
          }
        }
      } catch { /* the radar is an enrichment, not a dependency */ }

      for (const sym of symbols) {
        const g = benchByNorm.get(sym) || null;
        next[sym] = {
          symbol: sym,
          market: g?.market === 'US' || /^[A-Z]{1,5}$/.test(sym) && !!g?.eps_adj_curr ? 'US' : 'IN',
          graded: g,
          pattern: g ? classifyGradedRow(g) : null,
          radarScore: radar.get(sym) ?? null,
          summary: null,
          summaryState: 'idle',
        };
      }
      if (!cancelled) { setRows(next); setLoading(false); }
    })().catch((e) => {
      if (!cancelled) { setErr(String(e?.message || e)); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [symbols]);

  // ── 3. The catalysts, read on demand per holding. Each is a model call
  //      against a filing, so they are never fired for the whole book at once.
  const loadSummary = useCallback(async (sym: string) => {
    setRows((r) => ({ ...r, [sym]: { ...r[sym], summaryState: 'loading' } }));
    const row = rows[sym];
    try {
      const isUs = row?.market === 'US';
      const url = isUs
        ? `/api/v1/us/ai-summary?ticker=${encodeURIComponent(sym)}`
        : `/api/v1/india/ai-summary?ticker=${encodeURIComponent(sym)}`;
      const res = await fetch(url, { cache: 'no-store' });
      const j = await res.json();
      setRows((r) => ({
        ...r,
        [sym]: j?.ok && j.structured
          ? { ...r[sym], summary: j.structured, summaryState: 'done' }
          : { ...r[sym], summaryState: 'error', summaryError: j?.error || 'No reading available for this holding.' },
      }));
    } catch (e: any) {
      setRows((r) => ({ ...r, [sym]: { ...r[sym], summaryState: 'error', summaryError: String(e?.message || e) } }));
    }
  }, [rows]);

  const list = useMemo(() => {
    const all = Object.values(rows);
    const scored = all.map((r) => {
      // A holding is "changed" when an engine has something to say about it.
      const changed = !!r.pattern || (r.radarScore ?? 0) >= 25
        || !!(r.summary?.catalysts?.length) || !!(r.summary?.one_offs?.length);
      return { r, changed };
    });
    const f = onlyChanged ? scored.filter((x) => x.changed) : scored;
    return f.sort((a, b) =>
      (b.r.radarScore ?? 0) - (a.r.radarScore ?? 0)
      || a.r.symbol.localeCompare(b.r.symbol));
  }, [rows, onlyChanged]);

  if (!symbols.length && !loading) {
    return (
      <div style={{ padding: 24, color: C.dim, fontSize: 13, lineHeight: 1.6 }}>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, marginBottom: 8 }}>Portfolio Catalysts</h1>
        Your book is empty, so there is nothing to watch. Add holdings on the Portfolio page and they will appear
        here with their latest grade, the catalysts read out of their filings, and the condition that ends each thesis.
      </div>
    );
  }

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 800, color: C.text, margin: 0 }}>
          Portfolio Catalysts
        </h1>
        <div style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 760 }}>
          What has <b style={{ color: C.text }}>changed</b> in the names you already own — capex and when it earns,
          capacity and utilisation, order book, guidance, one-offs, and why the margin moved. Each holding carries the
          condition that actually ends its thesis. A price is never one of them.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={() => setOnlyChanged((v) => !v)}
          style={{
            fontSize: 11, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
            border: `1px solid ${onlyChanged ? C.cyan : C.border}`,
            background: onlyChanged ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : C.bg,
            color: onlyChanged ? C.cyan : C.dim,
          }}>
          {onlyChanged ? 'Showing only what changed' : 'Show only what changed'}
        </button>
        <span style={{ fontSize: 11, color: C.faint }}>
          {list.length} of {symbols.length} holdings
        </span>
      </div>

      {err && <div style={{ fontSize: 12, color: C.amber }}>{err}</div>}
      {loading && <div style={{ fontSize: 12, color: C.dim }}>Reading your book…</div>}

      {list.map(({ r, changed }) => (
        <div key={r.symbol} style={{
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px',
          borderLeft: `3px solid ${changed ? C.cyan : C.border}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>{r.symbol}</span>
            <span style={{ fontSize: 9.5, fontWeight: 800, color: C.faint }}>{r.market}</span>
            {r.graded?.tier && (
              <span style={{ fontSize: 9.5, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
                border: `1px solid ${C.border}`, color: C.dim }}>{r.graded.tier}</span>
            )}
            {r.pattern && (() => {
              const m = ABFG_META[r.pattern.pattern];
              return (
                <span title={r.pattern.because} style={{
                  fontSize: 9.5, fontWeight: 800, padding: '1px 7px', borderRadius: 3,
                  border: `1px solid ${m.color}`, background: `${m.color}18`, color: m.color,
                }}>{m.icon} {r.pattern.pattern} · {m.name}</span>
              );
            })()}
            {r.radarScore != null && (
              <span style={{ fontSize: 9.5, fontWeight: 800, color: '#A78BFA' }}>🚀 T-{r.radarScore}</span>
            )}
            <span style={{ marginLeft: 'auto' }}>
              {r.summaryState === 'idle' && (
                <button onClick={() => loadSummary(r.symbol)}
                  style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
                    border: `1px solid ${C.border}`, background: C.bg, color: C.cyan, cursor: 'pointer' }}>
                  ✨ Read catalysts
                </button>
              )}
              {r.summaryState === 'loading' && <span style={{ fontSize: 10.5, color: C.dim }}>Reading the filing…</span>}
            </span>
          </div>

          {/* THE EXIT CONDITION — the reason this page exists. */}
          {r.pattern && (
            <div style={{ marginTop: 7, fontSize: 11, color: C.dim, lineHeight: 1.5 }}>
              <b style={{ color: C.amber }}>What ends this: </b>{r.pattern.exitCondition}
            </div>
          )}

          {r.summaryState === 'error' && (
            <div style={{ marginTop: 7, fontSize: 11, color: C.amber }}>{r.summaryError}</div>
          )}

          {r.summaryState === 'done' && r.summary && <CatalystBlock d={r.summary} />}
        </div>
      ))}
    </div>
  );
}

/** The structural changes, pulled out of the verified AI summary. Only
 *  sections the filing actually gave are rendered. */
function CatalystBlock({ d }: { d: any }) {
  const cats: any[] = Array.isArray(d?.catalysts) ? d.catalysts : [];
  const capex: any[] = Array.isArray(d?.capex_projects) ? d.capex_projects : [];
  const oneOffs: any[] = Array.isArray(d?.one_offs) ? d.one_offs : [];
  const ut = d?.utilisation || {};
  const ob = d?.order_book || {};
  const mb = d?.margin_bridge;
  const g = d?.guidance;
  const utRow = (['current', 'prior', 'expected', 'expected_by'] as const)
    .map((k) => ({ k, v: ut[k] })).filter((x) => said(x.v));
  const obRow = (['closing_value', 'growth', 'book_to_bill'] as const)
    .map((k) => ({ k, v: ob[k] })).filter((x) => said(x.v));
  const LBL: Record<string, string> = {
    current: 'Now', prior: 'Was', expected: 'Expected', expected_by: 'By',
    closing_value: 'Order book', growth: 'Growth', book_to_bill: 'Book-to-bill',
  };
  const Row = ({ label, color, children }: { label: string; color?: string; children: React.ReactNode }) => (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: 0.4, color: color || C.faint, marginBottom: 3 }}>
        {label}
      </div>
      {children}
    </div>
  );

  return (
    <div style={{ marginTop: 9, paddingTop: 8, borderTop: `1px solid ${C.border}` }}>
      {g?.action && g.action !== 'none' && (
        <Row label={`GUIDANCE ${String(g.action).toUpperCase()}`}
          color={g.action === 'raised' ? C.green : g.action === 'lowered' ? C.red : C.amber}>
          <div style={{ fontSize: 11.5, color: C.text }}>{said(g.detail) ? g.detail : '—'} {said(g.period) ? `(${g.period})` : ''}</div>
        </Row>
      )}
      {mb && (Array.isArray(mb.drivers) ? mb.drivers.length : 0) > 0 && (
        <Row label={`WHY THE MARGIN MOVED ${said(mb.opm_change_pp) ? `· ${mb.opm_change_pp}` : ''}`}>
          {mb.drivers.map((dr: any, i: number) => {
            const c = dr?.nature === 'structural' ? C.green : dr?.nature === 'cyclical' ? C.amber : C.red;
            return (
              <div key={i} style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>
                <span style={{ color: c }}>›</span> {dr?.detail}
                <span style={{ color: c, fontSize: 9.5 }}> · {String(dr?.nature || '').replace('_', ' ')}</span>
              </div>
            );
          })}
        </Row>
      )}
      {cats.length > 0 && (
        <Row label="CATALYSTS" color={C.cyan}>
          {cats.map((c, i) => (
            <div key={i} style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>
              <b style={{ color: C.text }}>{c?.title}</b>
              {said(c?.expected_impact_period) && <span> · from {c.expected_impact_period}</span>}
            </div>
          ))}
        </Row>
      )}
      {capex.length > 0 && (
        <Row label="CAPEX &amp; CAPACITY">
          {capex.map((c, i) => (
            <div key={i} style={{ fontSize: 11.5, color: C.dim, lineHeight: 1.5 }}>
              <b style={{ color: C.text }}>{c?.name}</b>
              {[said(c?.amount) ? c.amount : '', said(c?.capacity_added) ? c.capacity_added : '',
                said(c?.completion_period) ? `completes ${c.completion_period}` : '',
                said(c?.revenue_from) ? `earns from ${c.revenue_from}` : '']
                .filter(Boolean).map((t, k) => <span key={k}> · {t}</span>)}
            </div>
          ))}
        </Row>
      )}
      {utRow.length > 0 && (
        <Row label="UTILISATION">
          <div style={{ fontSize: 11.5, color: C.text, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {utRow.map((x) => <span key={x.k}><span style={{ color: C.faint, fontSize: 10 }}>{LBL[x.k]} </span><b>{x.v}</b></span>)}
          </div>
        </Row>
      )}
      {obRow.length > 0 && (
        <Row label="ORDER BOOK">
          <div style={{ fontSize: 11.5, color: C.text, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {obRow.map((x) => <span key={x.k}><span style={{ color: C.faint, fontSize: 10 }}>{LBL[x.k]} </span><b>{x.v}</b></span>)}
          </div>
        </Row>
      )}
      {oneOffs.length > 0 && (
        <Row label="ONE-OFFS — WHAT WILL NOT REPEAT" color={C.red}>
          {oneOffs.map((o, i) => (
            <div key={i} style={{ fontSize: 11.5, color: C.dim }}>
              {o?.direction === 'gain' ? '+' : '−'} {o?.item}{said(o?.amount) ? ` — ${o.amount}` : ''}
            </div>
          ))}
        </Row>
      )}
    </div>
  );
}
