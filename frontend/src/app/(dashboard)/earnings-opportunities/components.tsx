'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState, useMemo, useCallback } from 'react';
import { QUADRANT_META } from '@/lib/earnings-grade-shared';
import { CommentaryScoreBlock, SummaryView } from '@/components/us-earnings-card';
import { scoreReleaseCommentary } from '@/lib/earnings/commentary-score';
import { partWord, axisWord, decodeEntities, type MarginView } from '@/lib/india-eo-card-data';
import { inGuideLine, IN_GUIDE_GLYPH, type InGuideLine } from '@/lib/in-guide-line';
import type { CalendarPayload, ParsedEarning } from './types';

/**
 * QUALITY × INFLECTION badge — the second axis, rendered beside the tier.
 *
 * The badge shows the quadrant plus BOTH raw scores, because the quadrant alone
 * hides how close a row is to its boundary: Q48/I72 and Q12/I95 are both
 * TURNAROUND ACCELERATORs and are not the same bet. The title attribute lists
 * the components that actually contributed, so the card can show its work
 * rather than asking to be trusted — and components India could not assess are
 * simply absent from that list, never listed as zero.
 */
export function QuadrantBadge({ stock }: { stock: ParsedEarning }) {
  const q = stock.quadrant;
  const qual = stock.quality_score;
  const infl = stock.inflection_score;
  // Null renders as nothing. A row we could not score gets no badge at all.
  if (!q || typeof qual !== 'number' || typeof infl !== 'number') return null;
  const meta = QUADRANT_META[q];
  if (!meta) return null;
  const parts = stock.quadrant_parts;
  // zzz820 — words, not the 0–100 numbers (owner rule: no visible scores).
  const fmtParts = (ps?: Array<{ label: string; points: number; of: number }>) =>
    (ps && ps.length) ? ps.map(partWord).join(', ') : 'not assessable from this filing';
  const qualW = axisWord(qual, 'quality');
  const inflW = axisWord(infl, 'inflection');
  const title =
    `${meta.label} — ${meta.tagline}.\n` +
    `QUALITY — ${qualW} (what the business IS): ${fmtParts(parts?.quality)}\n` +
    `INFLECTION — ${inflW} (what it is BECOMING): ${fmtParts(parts?.inflection)}\n` +
    `Independent of the tier — the quadrant never promotes a row.`;
  return (
    <span title={title} style={{
      padding: '1px 6px', borderRadius: 3,
      border: `1px solid ${meta.color}`,
      backgroundColor: `${meta.color}1F`,
      color: meta.color, fontWeight: 800, letterSpacing: '0.3px', whiteSpace: 'nowrap',
    }}>
      {meta.icon} {meta.label}
      <span style={{ fontWeight: 700, opacity: 0.85, marginLeft: 5 }}>· {qualW} · {inflW}</span>
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// THE INDIA AI SUMMARY BLOCK.                                       (zzz700)
//
// The 📝 line above this is template text — tier plus three growth rates,
// assembled in `lib/earnings/grader.ts`. This is the written reading: the
// same tool schema, the same figure verification and the same renderer the US
// card uses, against the results PDF filed with the exchange.
//
// It is opt-in per card because each open costs a model call against a PDF
// that must first be fetched and parsed, and most cards are scrolled past.
// ═══════════════════════════════════════════════════════════════════════════
export function IndiaAiSummary({ stock }: { stock: ParsedEarning }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [struct, setStruct] = useState<any>(null);
  // zzz726 — WHICH document was read now travels with the summary. The reader
  // falls back from the exchange results filing to the company's concall
  // transcript, and a transcript read as though it were this quarter's results
  // would be a quietly wrong answer.
  const [prov, setProv] = useState<{
    source_url: string | null; model: string | null;
    kind: string | null; period: string | null; note: string | null;
  }>({ source_url: null, model: null, kind: null, period: null, note: null });
  const [err, setErr] = useState('');
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState('');

  const commentary = useMemo(() => (struct ? scoreReleaseCommentary(struct) : null), [struct]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const q = new URLSearchParams({ ticker: stock.ticker });
      if (stock.quarter) q.set('quarter', stock.quarter);
      if (stock.filing_date) q.set('filing_date', String(stock.filing_date).slice(0, 10));
      const res = await fetch(`/api/v1/india/ai-summary?${q}`, { cache: 'no-store' });
      const j = await res.json();
      if (j?.ok && j.structured) {
        setStruct(j.structured);
        setProv({
          source_url: j.source_url || null, model: j.model || null,
          kind: j.document_kind || null, period: j.document_period || null, note: j.document_note || null,
        });
        setState('done');
      } else {
        setErr(j?.error || 'No summary is available for this filing.');
        setState('error');
      }
    } catch (e: any) {
      setErr(`The summary could not be fetched (${String(e?.message || e)}).`);
      setState('error');
    }
  }, [stock.ticker, stock.quarter, stock.filing_date]);

  const downloadPdf = useCallback(async () => {
    if (!struct) return;
    setPdfBusy(true); setPdfErr('');
    try {
      const { exportUsSummaryPdf } = await import('@/lib/earnings/us-summary-pdf');
      await exportUsSummaryPdf({
        ticker: stock.ticker, company: stock.company, quarter: stock.quarter,
        tier: stock.tier, filingDate: stock.filing_date,
        sourceUrl: prov.source_url, model: prov.model, d: struct, commentary,
      });
    } catch (e: any) {
      setPdfErr(`The PDF could not be written (${String(e?.message || e)}).`);
    } finally { setPdfBusy(false); }
  }, [struct, stock, prov, commentary]);

  const chip = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer',
    fontSize: 10.5, fontWeight: 700, padding: '3px 10px', borderRadius: 999,
    border: `1px solid ${active ? 'color-mix(in srgb, var(--mc-cyan) 45%, transparent)' : 'var(--mc-bg-4)'}`,
    backgroundColor: active ? 'color-mix(in srgb, var(--mc-cyan) 14%, transparent)' : 'var(--mc-bg-1)',
    color: active ? 'var(--mc-cyan)' : 'var(--mc-text-2)',
  });

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={() => { const n = !open; setOpen(n); if (n && state === 'idle') void load(); }}
          aria-expanded={open}
          title="A written reading of the results PDF filed with the exchange — why the margin moved, the catalysts, capex, utilisation, order book and what will not repeat. Every figure is checked against the filing."
          style={chip(open)}
        >
          ✨ {state === 'loading' ? 'Reading the filing…' : 'AI Summary'}
        </button>
        {state === 'done' && struct && (
          <button onClick={downloadPdf} disabled={pdfBusy} style={{ ...chip(false), cursor: pdfBusy ? 'progress' : 'pointer', opacity: pdfBusy ? 0.6 : 1 }}
            title="Download this summary as a one-page A4 PDF on white.">
            ⬇ {pdfBusy ? 'Writing PDF…' : 'PDF'}
          </button>
        )}
        {prov.source_url && (
          <a href={prov.source_url} target="_blank" rel="noreferrer" title={prov.note || undefined}
            style={{ ...chip(false), textDecoration: 'none' }}>
            📄 {prov.kind === 'transcript' ? 'Concall transcript'
              : prov.kind === 'ppt' ? 'Investor presentation'
                : prov.kind === 'annual_report' ? 'Annual report' : 'Filing'}
            {prov.period ? ` · ${prov.period}` : ''}
          </a>
        )}
      </div>
      {pdfErr && <div style={{ marginTop: 5, fontSize: 10, color: '#F59E0B' }}>{pdfErr}</div>}
      {open && (
        <div style={{
          marginTop: 7, padding: '10px 12px', borderRadius: 8,
          backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)',
          borderLeft: '3px solid var(--mc-cyan)',
        }}>
          {state === 'loading' && (
            <div style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>
              Fetching and reading the latest document for {stock.ticker} — the filed results if the exchange feed still
              carries them, otherwise the concall transcript from its screener.in document list. A few seconds the first time.
            </div>
          )}
          {state === 'error' && <div style={{ fontSize: 11, color: '#F59E0B' }}>{err}</div>}
          {state === 'done' && prov.note && (
            <div style={{ marginBottom: 8, fontSize: 10, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
              ℹ {prov.note}
            </div>
          )}
          {state === 'done' && commentary && (
            <CommentaryScoreBlock c={commentary} hasTranscript={prov.kind === 'transcript'} />
          )}
          {state === 'done' && struct && <SummaryView d={struct} />}
          {state === 'done' && (
            <div style={{ marginTop: 8, fontSize: 9.5, color: 'var(--mc-text-4)', lineHeight: 1.5 }}>
              Written from the company&rsquo;s own filed results only — no news, no estimates, no market reaction. Every
              figure is checked against the filing before it is shown, and any line carrying a figure the filing does
              not print is dropped. Empty sections mean the filing is silent on them. Educational, not investment advice.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── CalendarView ───────────────────────────────────────────────────────────
export function CalendarView({ data, loading, from, to, onPickDate }: { data: CalendarPayload | undefined; loading: boolean; from: string; to: string; onPickDate: (d: string) => void }) {
  // PATCH 0154 — per-date expand-all toggle
  const [expandedDates, setExpandedDates] = useState<Record<string, boolean>>({});

  // Build all dates in [from, to] range (inclusive)
  const dates = useMemo(() => {
    const out: string[] = [];
    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }, [from, to]);

  if (loading && !data) {
    // PATCH 0253 — Calendar loads from localStorage instantly when cached
    // (which is the typical case after first visit). Reaching this state
    // means no cache exists yet; show a more honest message + skeleton.
    return (
      <div style={{ color: 'var(--mc-text-4)', fontSize: 13, padding: 40, textAlign: 'center' }}>
        <div style={{ marginBottom: 8 }}>Fetching the earnings calendar for the first time…</div>
        <div style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>
          This is a one-time fetch per month. Subsequent visits hit cache instantly.
        </div>
      </div>
    );
  }
  if (data?.empty_reason === 'scraper_has_not_run_yet') {
    return (
      <div style={{ color: 'var(--mc-text-3)', fontSize: 13, padding: 30, backgroundColor: 'var(--mc-bg-1)', border: '1px solid color-mix(in srgb, var(--mc-warn) 25%, transparent)', borderRadius: 10 }}>
        <div style={{ fontSize: 24, marginBottom: 10 }}>⏳</div>
        <strong style={{ color: 'var(--mc-warn)' }}>Scraper has not run yet.</strong>
        <p style={{ marginTop: 8, lineHeight: 1.6 }}>
          The NSE Earnings Calendar GitHub Action needs to run at least once to populate the KV cache. Either:
        </p>
        <ol style={{ marginTop: 6, paddingLeft: 22, lineHeight: 1.7, fontSize: 12 }}>
          <li>Wait for the next 30-minute cron tick (runs 03:00–13:00 UTC on weekdays)</li>
          <li>Trigger manually: GitHub repo → Actions → "NSE Earnings Calendar Scrape" → Run workflow</li>
        </ol>
        <p style={{ marginTop: 8, fontSize: 11, color: 'var(--mc-text-4)' }}>
          Make sure these GitHub repo secrets are set: <code>UPSTASH_REDIS_REST_URL</code>, <code>UPSTASH_REDIS_REST_TOKEN</code>.
        </p>
      </div>
    );
  }

  const byDate = data?.by_date || {};
  // 3-state: dates NOT in ingested_dates were never captured (source window) => UNKNOWN, not zero.
  const ingestedSet = new Set<string>(data?.ingested_dates || []);
  // PATCH 0909 — Build a flat de-duped list of all tickers in the visible
  // calendar window so the user can copy them as a single comma-separated
  // string (TradingView-ready) or as NSE: prefixed string (Investing.com / Zerodha).
  // User report: "i am trying to copy tickers in the earninsg calendar in
  // earning opportunities its not posible".
  const allTickers: string[] = (() => {
    const set = new Set<string>();
    for (const items of Object.values(byDate)) {
      for (const it of items) {
        if (it?.symbol) set.add(String(it.symbol).toUpperCase().replace(/\.(NS|BO)$/i, ''));
      }
    }
    return Array.from(set).sort();
  })();
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      // Lightweight toast — uses native alert as fallback if no toast lib.
      console.log(`[calendar] copied ${label}: ${text.slice(0, 80)}...`);
    } catch {
      // navigator.clipboard fails in non-https contexts; fall back to textarea + execCommand
      try {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.top = '-1000px';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy');
        document.body.removeChild(ta);
      } catch {}
    }
  };
  return (
    <div style={{ backgroundColor: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 10, padding: '14px 18px' }}>
      <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--mc-text-1)', letterSpacing: '0.4px' }}>📅 NSE EARNINGS CALENDAR</h2>
        <span style={{ fontSize: 11, color: 'var(--mc-text-4)' }}>{from} → {to} · {Object.values(byDate).reduce((a, b) => a + b.length, 0)} filings</span>
        {/* PATCH 0909 — Copy-all-tickers controls */}
        {allTickers.length > 0 && (
          <span style={{ display: 'inline-flex', gap: 4, marginLeft: 4 }}>
            <button
              onClick={() => copyToClipboard(allTickers.join(','), 'plain CSV')}
              title="Copy all tickers (CSV — Excel-friendly)"
              style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            >📋 CSV ({allTickers.length})</button>
            <button
              onClick={() => copyToClipboard(allTickers.map(t => `NSE:${t}`).join(','), 'TradingView')}
              title="Copy as NSE:TICKER,NSE:TICKER (TradingView watchlist import format)"
              style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            >📊 TradingView</button>
            <button
              onClick={() => copyToClipboard(allTickers.join('\n'), 'one per line')}
              title="Copy one ticker per line"
              style={{ fontSize: 10, padding: '3px 8px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 38%, transparent)', color: 'var(--mc-cyan)', borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}
            >↓ Lines</button>
          </span>
        )}
        {data?.scraped_at && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--mc-text-4)' }}>scraped {new Date(data.scraped_at).toLocaleString('en-IN')}</span>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
        {dates.map((d) => {
          const items = byDate[d] || [];
          const dt = new Date(d);
          const weekday = dt.toLocaleDateString('en-IN', { weekday: 'short' });
          const dayLabel = dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
          const isToday = d === new Date().toISOString().slice(0, 10);
          return (
            <div key={d} onClick={() => items.length > 0 && onPickDate(d)}
              style={{
                padding: '10px 12px',
                backgroundColor: 'var(--mc-bg-0)',
                border: `1px solid ${isToday ? 'color-mix(in srgb, var(--mc-cyan) 25%, transparent)' : 'var(--mc-bg-4)'}`,
                borderRadius: 8,
                cursor: items.length > 0 ? 'pointer' : 'default',
                opacity: items.length === 0 ? 0.5 : 1,
              }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: isToday ? 'var(--mc-cyan)' : 'var(--mc-text-3)' }}>
                  {weekday} {dayLabel}
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {items.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const day = items.map(it => String(it.symbol || '').toUpperCase().replace(/\.(NS|BO)$/i, '')).filter(Boolean).join(',');
                        copyToClipboard(day, `${weekday} ${dayLabel}`);
                      }}
                      title={`Copy ${items.length} tickers filing ${weekday} ${dayLabel}`}
                      style={{ fontSize: 9, padding: '1px 5px', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', color: 'var(--mc-cyan)', borderRadius: 3, cursor: 'pointer', fontWeight: 700 }}
                    >📋</button>
                  )}
                  {items.length > 0 && (
                    <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--mc-warn)' }}>{items.length}</span>
                  )}
                </span>
              </div>
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {items.length === 0 ? (
                  ingestedSet.has(d) ? (
                    <span title="Ingested for this date - no results filed (confirmed zero)" style={{ fontSize: 10.5, color: 'var(--mc-text-4)' }}>No filings</span>
                  ) : (
                    <span title="Data unavailable - this date was never ingested (outside NSE source window). Not zero." style={{ fontSize: 10.5, fontWeight: 700, color: '#B45309' }}>Data unavailable</span>
                  )
                ) : (expandedDates[d] ? items : items.slice(0, 12)).map((it, i) => (
                  // Stable UNIQUE key per company-in-day. Keying on it.symbol
                  // alone made React collapse siblings whenever two rows shared
                  // a symbol (or a blank symbol), silently dropping companies.
                  // date+symbol+company+index is guaranteed unique and durable.
                  <a key={`${d}::${it.symbol || 'nosym'}::${it.company || ''}::${i}`} href={it.source_url} target="_blank" rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={`${decodeEntities(String(it.company || ''))} · ${it.quarter || ''}`}
                    style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, backgroundColor: 'color-mix(in srgb, var(--mc-accent) 8%, transparent)', color: '#38A9E8', border: '1px solid color-mix(in srgb, var(--mc-accent) 25%, transparent)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textDecoration: 'none', fontWeight: 700 }}>
                    {it.symbol}
                  </a>
                ))}
                {items.length > 12 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedDates((s) => ({ ...s, [d]: !s[d] }));
                    }}
                    style={{ fontSize: 10, color: 'var(--mc-cyan)', background: 'transparent', border: '1px solid color-mix(in srgb, var(--mc-cyan) 25%, transparent)', padding: '1px 6px', borderRadius: 3, cursor: 'pointer', fontWeight: 700 }}>
                    {expandedDates[d] ? '− show less' : `+${items.length - 12} more`}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// PATCH 1003 — OPM (Operating Profit Margin) tile.
// Displays current OPM % and YoY change in percentage points, color-coded
// so user can see margin direction at a glance — feeds the margin-gate
// rule introduced in Patch 1000.
// zzz820 — now driven by marginView(): a stored 0.0% is shown as unknown, and
// banks / NBFCs / insurers get NET MARGIN (net profit ÷ total income) instead
// of an operating margin that means nothing for a lender.
export function MarginTile({ m }: { m: MarginView }) {
  const hasV = m.value != null;
  const delta = m.value != null && m.prev != null ? m.value - m.prev : null;
  const deltaColor = delta == null ? '#6B7A8D'
                    : delta >= 1 ? '#10B981'
                    : delta >= -0.5 ? '#94A3B8'
                    : '#EF4444';
  const deltaLabel = delta == null ? '—'
                    : `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pp`;
  return (
    <div title={m.title} style={{ padding: '6px 10px', backgroundColor: 'var(--mc-bg-1)', borderRadius: 6, border: '1px solid var(--mc-bg-4)', display: 'flex', flexDirection: 'column', gap: 1 }}>
      <div style={{ fontSize: 9, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>{m.label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: hasV ? 'var(--mc-text-1)' : 'var(--mc-text-4)', lineHeight: 1 }}>
          {hasV ? `${(m.value as number).toFixed(1)}%` : '—'}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: deltaColor }}>
          {deltaLabel}
        </div>
      </div>
      <div style={{ fontSize: 9, color: 'var(--mc-text-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {m.note}
      </div>
    </div>
  );
}

export function MetricTile({ label, pct, curr, prev, word, note, noteTitle }: { label: string; pct: number | null; curr: string | null; prev: string | null; word?: { text: string; good: boolean; title?: string }; note?: string; noteTitle?: string }) {
  const color = word ? (word.good ? '#10B981' : '#EF4444') : pct == null ? '#6B7A8D' : pct >= 0 ? '#10B981' : '#EF4444';
  // zzz385 — clamp base-effect blow-ups on the card tile (mirror the narrative fmtP
  // clamp): a near-zero prior base makes YoY % explode (e.g. ₹0.5 Cr → ₹50 Cr PAT =
  // +5000%). Exact precision is meaningless there and reads as fabricated, so show
  // '>500%' above the threshold. The curr-vs-prev ₹Cr line below still shows the real
  // magnitude so the low base is obvious.
  const pctLabel = pct == null || !Number.isFinite(pct)
    ? '—'
    : pct >= 500 ? '>500%'
    : `${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%`;
  return (
    <div style={{ padding: '8px 10px', backgroundColor: 'var(--mc-bg-1)', borderRadius: 6, border: '1px solid var(--mc-bg-4)' }}>
      <div style={{ fontSize: 9.5, color: 'var(--mc-text-4)', fontWeight: 700, letterSpacing: '0.6px' }}>{label}</div>
      {word
        ? <div title={word.title} style={{ fontSize: 12, fontWeight: 900, color, marginTop: 4, lineHeight: 1.1 }}>{word.text}</div>
        : <div style={{ fontSize: 18, fontWeight: 900, color, marginTop: 2, lineHeight: 1 }}>{pctLabel}</div>}
      {(curr || prev) && (
        <div style={{ fontSize: 10, color: 'var(--mc-text-4)', marginTop: 2, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          {curr || '—'}{prev && ` vs ${prev}`}
        </div>
      )}
      {/* zzz820 — why a figure is '—' (never a guess in its place). */}
      {note && (
        <div title={noteTitle} style={{ fontSize: 9, color: 'var(--mc-text-3)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: noteTitle ? 'help' : undefined }}>
          ⓘ {note}
        </div>
      )}
    </div>
  );
}

/**
 * zzz975 — ONE THIN LINE UNDER THE CHIPS: did management raise, keep or lower its guidance?
 * The server puts `guide_line` on every served row (lib/in-guide-check); a card the browser graded itself gets the same
 * pure verdict from its own text. Raised green, lowered red, mixed / cautious amber, everything else grey. The tooltip
 * carries the company's sentence and where it came from; a top-tier quarter moved for it says so.
 */
export function InGuideOneLiner({ stock }: { stock: ParsedEarning }) {
  const raw = (stock as any).guide_line;
  const gl: InGuideLine = raw && typeof raw.text === 'string' && typeof raw.direction === 'string' ? raw : inGuideLine(stock, null);
  const color = gl.direction === 'raised' ? 'var(--mc-bullish)'
    : gl.direction === 'lowered' || gl.direction === 'withdrawn' ? 'var(--mc-bearish)'
    : gl.direction === 'mixed' || gl.direction === 'cautious' ? 'var(--mc-caution, #F59E0B)'
    : 'var(--mc-text-3)';
  const moved = (stock as any).tier_before_guide_check;
  const [head, ...rest] = gl.text.split(' — ');
  const title = [gl.title, gl.source ? `Source: ${gl.source}` : '', moved ? `Moved from ${moved} to MIXED because of this.` : ''].filter(Boolean).join('\n');
  return (
    <div title={title} data-guide={gl.direction}
      style={{ fontSize: 11, lineHeight: 1.35, color: 'var(--mc-text-2)', margin: '-3px 0 8px', display: 'flex', gap: 5, alignItems: 'baseline', minWidth: 0 }}>
      <span aria-hidden style={{ flexShrink: 0 }}>{IN_GUIDE_GLYPH[gl.direction] || '…'}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        <b style={{ color }}>{head}</b>
        {rest.length > 0 && <span> — {rest.join(' — ')}</span>}
        {moved && <span style={{ color: 'var(--mc-text-4)' }}> · moved from {moved} to MIXED</span>}
        {gl.source && <span style={{ color: 'var(--mc-text-4)' }}> · {gl.source}</span>}
      </span>
      {gl.url && /^https?:\/\//.test(gl.url) && (
        <a href={gl.url} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, color: 'var(--mc-text-4)', textDecoration: 'none' }} aria-label="Open the source">↗</a>
      )}
    </div>
  );
}
