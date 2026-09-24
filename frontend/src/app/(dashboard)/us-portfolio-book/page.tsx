// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — holdings, cash and bench for the US book.        (zzz790)
//
// Separate from the India book (/portfolio): its own KV document
// (`us-book:v1:<owner>`) behind /api/v1/us-book. Holdings carry ticker,
// venue, currency, quantity and average cost; cash is kept PER CURRENCY
// (USD, EUR, BASE) and shown apart from positions, never folded into them.
// Frankfurt (FWB2) lines are kept and valued, marked NON-US: they have no
// SEC filer, so US Portfolio Catalysts excludes them and says why.
//
// Market value and P&L against average cost live on THIS page only; the
// catalyst engine never reads a price.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { valueBook, quoteSymbolFor, type UsQuote } from '@/lib/us-book/valuation';
import type { UsBook, UsHolding } from '@/lib/us-book/model';
import type { UsImportResult } from '@/lib/us-book/import';

const C = {
  bg: 'var(--mc-bg-1)', bg0: 'var(--mc-bg-0, var(--mc-bg-1))', border: 'var(--mc-bg-4)', text: 'var(--tc-text, #F1F5F9)',
  dim: 'var(--tc-dim, #D5DEE9)', faint: 'var(--tc-faint, #AEBBCB)', amber: 'var(--mc-verdict-warn, #FBBF24)',
  green: 'var(--mc-verdict-up, #34D399)', red: 'var(--mc-verdict-down, #F87171)', cyan: 'var(--tc-accent, #22D3EE)',
};
const btn = (color = C.cyan, solid = false): React.CSSProperties => ({
  fontSize: 13, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${color}`, background: solid ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent', color,
});
const input: React.CSSProperties = { fontSize: 13, padding: '4px 8px', borderRadius: 6, border: `1px solid var(--mc-bg-4)`, background: 'var(--mc-bg-0, transparent)', color: 'var(--tc-text, #F1F5F9)' };
const SYM: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };
const money = (v: number | null | undefined, ccy: string, dp = 2) => (v == null || !Number.isFinite(v) ? '—'
  : `${v < 0 ? '−' : ''}${SYM[ccy] || ''}${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}${SYM[ccy] ? '' : ` ${ccy}`}`);
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const EMPTY_FORM = { ticker: '', exchange: 'NASDAQ', currency: 'USD', quantity: '', avgPrice: '' };

export default function UsPortfolioBookPage() {
  const [book, setBook] = useState<UsBook | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, UsQuote>>({});
  const [fx, setFx] = useState<Record<string, number> | null>(null);
  const [quotesAt, setQuotesAt] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'replace' | 'merge'>('replace');
  const [preview, setPreview] = useState<UsImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [benchT, setBenchT] = useState('');
  const [benchX, setBenchX] = useState('');
  const [cashCcy, setCashCcy] = useState('USD');
  const [cashAmt, setCashAmt] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/v1/us-book', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setBook(j.book); setErr(null);
    } catch (e: any) { setErr(String(e?.message || e)); }
  }, []);
  const loadQuotes = useCallback(async () => {
    setQuoting(true);
    try {
      const r = await fetch('/api/v1/us-book/quotes', { cache: 'no-store' });
      const j = await r.json();
      if (j?.ok) { setQuotes(j.quotes || {}); setFx(j.fx || {}); setQuotesAt(j.at || null); }
    } catch { /* values stay blank, said so on each row */ }
    setQuoting(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (book && book.holdings.length) void loadQuotes(); }, [book?.updatedAt, loadQuotes]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (body: any, label: string): Promise<any> => {
    setBusy(label); setMsg(null);
    try {
      const r = await fetch('/api/v1/us-book', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j?.book) setBook(j.book);
      if (!r.ok || !j?.ok) setMsg(`✗ ${j?.error || `HTTP ${r.status}`}`);
      return j;
    } catch (e: any) { setMsg(`✗ ${String(e?.message || e)}`); return null; }
    finally { setBusy(null); }
  };

  const val = useMemo(() => (book ? valueBook(book, quotes, fx) : null), [book, quotes, fx]);
  const rows = useMemo(() => (val ? [...val.rows].sort((a, b) => (a.listing === b.listing ? a.ticker.localeCompare(b.ticker) : a.listing === 'US' ? -1 : 1)) : []), [val]);
  const holdingOf = (t: string, x: string) => book?.holdings.find((h) => h.ticker === t && h.exchange === x);
  const nonUs = book?.holdings.filter((h) => h.listing !== 'US') || [];

  // zzz792 — say what was loaded, right where the buttons are.
  const [fileNote, setFileNote] = useState<string | null>(null);
  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    try { const t = await f.text(); setText(t); setFileNote(`Loaded ${f.name} — ${t.split(/\r?\n/).filter((l) => l.trim()).length} lines. Click Import (or Preview first).`); setMsg(null); }
    catch (e: any) { setFileNote(`✗ could not read ${f.name}: ${String(e?.message || e)}`); }
  };

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>🇺🇸 US Portfolio Book</h1>
        <div style={{ fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 860 }}>
          Your US book — positions, cash per currency and a bench / watch list — stored apart from the India book. Values use live quotes and
          P&amp;L is against your average cost; <b style={{ color: C.text }}>none of that reaches the catalyst engine</b>, which reads SEC filings only.{' '}
          <a href="/us-portfolio-catalysts" style={{ color: C.cyan }}>US Portfolio Catalysts →</a> · <a href="/portfolio" style={{ color: C.faint }}>India book →</a>
        </div>
      </div>
      {err && <div style={{ color: C.red, fontSize: 14 }}>The US book could not be read: {err}. This is not an empty book — nothing was changed.</div>}
      {msg && <div style={{ fontSize: 13.5, color: msg.startsWith('✗') ? C.red : C.green }}>{msg}</div>}

      {/* ── SUMMARY: positions per currency, cash apart ─────────────────── */}
      {book && val && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {Object.entries(val.byCurrency).map(([ccy, b]) => (
            <div key={ccy} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', background: C.bg, minWidth: 220 }}>
              <div style={{ fontSize: 12, color: C.faint, fontWeight: 800 }}>POSITIONS · {ccy}</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{money(b.marketValue, ccy)}</div>
              <div style={{ fontSize: 12.5, color: b.pnl >= 0 ? C.green : C.red }}>P&amp;L {money(b.pnl, ccy)} on cost {money(b.cost, ccy)}{b.cost ? ` (${pct((b.pnl / b.cost) * 100)})` : ''}</div>
              <div style={{ fontSize: 11.5, color: C.faint }}>{b.priced} priced{b.unpriced ? ` · ${b.unpriced} without a quote (not in the total)` : ''}</div>
            </div>
          ))}
          <div data-testid="us-cash" style={{ border: `1px solid ${C.cyan}`, borderRadius: 8, padding: '8px 12px', background: C.bg, minWidth: 220 }}>
            <div style={{ fontSize: 12, color: C.faint, fontWeight: 800 }}>CASH (separate from positions)</div>
            {['USD', 'EUR', 'BASE', ...Object.keys(book.cash).filter((k) => !['USD', 'EUR', 'BASE'].includes(k))].map((c) => (
              <div key={c} style={{ fontSize: 13.5, color: book.cash[c] != null ? C.text : C.faint }}>{c}: {book.cash[c] != null ? money(book.cash[c], c === 'BASE' ? 'BASE' : c) : 'not stated'}</div>
            ))}
            <div style={{ fontSize: 11.5, color: C.faint }}>BASE is the broker&apos;s base-currency total and restates the others — never added to them.</div>
          </div>
          {val.usdEquivalent && (
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '8px 12px', background: C.bg, minWidth: 220 }}>
              <div style={{ fontSize: 12, color: C.faint, fontWeight: 800 }}>USD EQUIVALENT (live FX)</div>
              <div style={{ fontSize: 18, fontWeight: 900, color: C.text }}>{money(val.usdEquivalent.total, 'USD')}</div>
              <div style={{ fontSize: 12, color: C.faint }}>positions {money(val.usdEquivalent.positions, 'USD')} + cash {money(val.usdEquivalent.cash, 'USD')}
                {Object.entries(val.usdEquivalent.fx).filter(([k]) => k !== 'USD').map(([k, v]) => ` · ${k}/USD ${v.toFixed(4)}`).join('')}
                {val.usdEquivalent.missingFx.length ? ` · no FX for ${val.usdEquivalent.missingFx.join(', ')} (left out)` : ''}</div>
            </div>
          )}
        </div>
      )}

      {/* ── HOLDINGS ─────────────────────────────────────────────────────── */}
      {book && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.bg }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontSize: 15, fontWeight: 900, color: C.text }}>Holdings — {book.holdings.length}</span>
            <span style={{ fontSize: 12.5, color: C.faint }}>{book.holdings.length - nonUs.length} US-listed · {nonUs.length} non-US listed (kept, valued, excluded from SEC evidence)</span>
            <button onClick={() => loadQuotes()} disabled={quoting} style={btn(C.cyan)}>{quoting ? 'Refreshing quotes…' : '↻ Refresh quotes'}</button>
            {quotesAt && <span style={{ fontSize: 12, color: C.faint }}>quotes {quotesAt.slice(11, 16)} UTC · Yahoo Finance</span>}
          </div>
          {!book.holdings.length ? <div style={{ fontSize: 13.5, color: C.dim }}>No holdings yet — import below or add one by hand.</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table data-testid="us-holdings" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr style={{ color: C.faint, textAlign: 'left', fontSize: 11.5, textTransform: 'uppercase' }}>
                  {['Ticker', 'Venue', 'Listing', 'Ccy', 'Qty', 'Avg cost', 'Price', 'Market value', 'P&L', 'P&L %', ''].map((h) => <th key={h} style={{ padding: '4px 6px', textAlign: ['Qty', 'Avg cost', 'Price', 'Market value', 'P&L', 'P&L %'].includes(h) ? 'right' : 'left' }}>{h}</th>)}
                </tr></thead>
                <tbody>{rows.map((r) => {
                  const h = holdingOf(r.ticker, r.exchange) as UsHolding | undefined;
                  return (
                    <tr key={`${r.ticker}|${r.exchange}`} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: '4px 6px', fontWeight: 900, color: C.text }} title={h && h.rawTicker !== r.ticker ? `imported as ${h.rawTicker}` : undefined}>{r.ticker}</td>
                      <td style={{ padding: '4px 6px', color: C.dim }}>{r.exchange || '—'}</td>
                      <td style={{ padding: '4px 6px' }} title={h?.listingNote}>{r.listing === 'US'
                        ? <span style={{ color: C.green, fontWeight: 800, fontSize: 12 }}>US · SEC</span>
                        : <span style={{ color: C.amber, fontWeight: 800, fontSize: 12 }}>NON-US · no SEC coverage</span>}</td>
                      <td style={{ padding: '4px 6px', color: C.dim }}>{r.currency}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>{r.quantity.toLocaleString('en-US')}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }}>{money(r.avgPrice, r.currency)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right' }} title={r.note || `${quoteSymbolFor({ ticker: r.ticker, exchange: r.exchange, listing: r.listing as any })}`}>{money(r.price, r.currency)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', fontWeight: 800 }}>{money(r.marketValue, r.currency)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: r.pnl == null ? C.faint : r.pnl >= 0 ? C.green : C.red }}>{money(r.pnl, r.currency)}</td>
                      <td style={{ padding: '4px 6px', textAlign: 'right', color: r.pnlPct == null ? C.faint : r.pnlPct >= 0 ? C.green : C.red }} title={r.note || undefined}>{pct(r.pnlPct)}</td>
                      <td style={{ padding: '4px 6px', whiteSpace: 'nowrap' }}>
                        <button onClick={() => setForm({ ticker: r.ticker, exchange: r.exchange, currency: r.currency, quantity: String(r.quantity), avgPrice: r.avgPrice == null ? '' : String(r.avgPrice) })} style={{ all: 'unset', cursor: 'pointer', color: C.cyan, fontSize: 12, fontWeight: 800, marginRight: 8 }}>edit</button>
                        <button onClick={() => { if (confirm(`Remove ${r.ticker} (${r.exchange || 'no venue'}) from the US book?`)) void post({ action: 'remove', ticker: r.ticker, exchange: r.exchange }, 'remove'); }} style={{ all: 'unset', cursor: 'pointer', color: C.red, fontSize: 12, fontWeight: 800 }}>remove</button>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          )}
          {nonUs.length > 0 && <div style={{ fontSize: 12.5, color: C.amber, marginTop: 6 }}>Non-US listings: {nonUs.map((h) => `${h.ticker} (${h.exchange || h.currency})`).join(' · ')} — valued here from their home-market quote; US Portfolio Catalysts lists them as excluded (no SEC filer).</div>}
        </div>
      )}

      {/* ── MANUAL ADD / EDIT ─────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.bg, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ color: C.text, fontSize: 14 }}>Add / edit a holding</b>
        <input placeholder="Ticker (MOG A → MOG-A)" value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} style={{ ...input, width: 170 }} />
        <input placeholder="Venue" value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })} style={{ ...input, width: 90 }} list="us-venues" />
        <datalist id="us-venues">{['NASDAQ', 'NYSE', 'AMEX', 'ARCA', 'FWB2', 'IBIS', 'LSE', 'TSX'].map((v) => <option key={v} value={v} />)}</datalist>
        <input placeholder="Ccy" value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} style={{ ...input, width: 60 }} />
        <input placeholder="Quantity" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} style={{ ...input, width: 90 }} />
        <input placeholder="Avg cost" value={form.avgPrice} onChange={(e) => setForm({ ...form, avgPrice: e.target.value })} style={{ ...input, width: 90 }} />
        <button disabled={!!busy} style={btn(C.green, true)} onClick={async () => {
          const q = Number(form.quantity); const a = form.avgPrice.trim() === '' ? null : Number(form.avgPrice);
          if (!form.ticker.trim() || !Number.isFinite(q) || q === 0 || (a != null && !Number.isFinite(a))) { setMsg('✗ ticker, a non-zero quantity and a numeric cost are required'); return; }
          const j = await post({ action: 'upsert', holding: { ticker: form.ticker, exchange: form.exchange, currency: form.currency, quantity: q, avgPrice: a } }, 'upsert');
          if (j?.ok) { setMsg(`✓ saved ${form.ticker.toUpperCase()}`); setForm(EMPTY_FORM); }
        }}>Save holding</button>
      </div>

      {/* ── CASH ─────────────────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.bg, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <b style={{ color: C.text, fontSize: 14 }}>Set cash</b>
        <select value={cashCcy} onChange={(e) => setCashCcy(e.target.value)} style={input}>{['USD', 'EUR', 'BASE', 'GBP', 'CHF', 'CAD'].map((c) => <option key={c}>{c}</option>)}</select>
        <input placeholder="Amount (blank clears)" value={cashAmt} onChange={(e) => setCashAmt(e.target.value)} style={{ ...input, width: 160 }} />
        <button disabled={!!busy} style={btn(C.cyan, true)} onClick={async () => {
          const amt = cashAmt.trim() === '' ? null : Number(cashAmt.replace(/,/g, ''));
          if (amt != null && !Number.isFinite(amt)) { setMsg('✗ amount must be a number'); return; }
          const j = await post({ action: 'cash', currency: cashCcy, amount: amt }, 'cash');
          if (j?.ok) { setMsg(`✓ ${cashCcy} cash ${amt == null ? 'cleared' : 'saved'}`); setCashAmt(''); }
        }}>Save cash</button>
      </div>

      {/* ── BENCH / WATCH ───────────────────────────────────────────────── */}
      {book && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px', background: C.bg }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <b style={{ color: C.text, fontSize: 14 }}>🏆 US bench / watch list — {book.bench.length}</b>
            <span style={{ fontSize: 12.5, color: C.faint }}>Candidates, not holdings: they join US Portfolio Catalysts as bench cards and are never counted as held.</span>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
            <input placeholder="Ticker" value={benchT} onChange={(e) => setBenchT(e.target.value)} style={{ ...input, width: 120 }} />
            <input placeholder="Venue (optional)" value={benchX} onChange={(e) => setBenchX(e.target.value)} style={{ ...input, width: 120 }} list="us-venues" />
            <button disabled={!!busy || !benchT.trim()} style={btn(C.amber, true)} onClick={async () => { const j = await post({ action: 'bench_add', ticker: benchT, exchange: benchX }, 'bench'); if (j?.ok) { setBenchT(''); setBenchX(''); } }}>Add to bench</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
            {book.bench.map((b) => (
              <span key={b.ticker} title={b.listingNote} style={{ fontSize: 12.5, padding: '2px 8px', borderRadius: 999, border: `1px solid ${b.listing === 'US' ? C.border : C.amber}`, color: C.dim }}>
                {b.ticker}{b.exchange ? ` · ${b.exchange}` : ''}{b.listing !== 'US' ? ' · non-US' : ''}{' '}
                <button onClick={() => void post({ action: 'bench_remove', ticker: b.ticker }, 'bench')} style={{ all: 'unset', cursor: 'pointer', color: C.red, fontWeight: 900 }}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── IMPORT ───────────────────────────────────────────────────────── */}
      <div style={{ border: `1px solid ${C.cyan}`, borderRadius: 8, padding: '10px 12px', background: C.bg }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: C.text }}>Import</div>
        <div style={{ fontSize: 12.5, color: C.faint, lineHeight: 1.5, margin: '4px 0 6px' }}>
          Paste or upload a CSV <code>ticker,exchange,currency,quantity,avg_price</code> with a <code>CASH</code> row per currency (amount in the quantity column),
          an IBKR positions table (Symbol / Financial Instrument · Position · Avg Price · Currency · Exchange), or an IBKR activity statement CSV
          (Open Positions + Cash Report). Class shares are normalised to the SEC spelling (MOG A / MOG.A → MOG-A). Preview first — nothing is saved until Import.
        </div>
        <textarea value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} rows={7} placeholder={'ticker,exchange,currency,quantity,avg_price\nAAPL,NASDAQ,USD,10,150.00\nMOG A,NYSE,USD,4,300.00\nXYZ,FWB2,EUR,20,25.00\nCASH,,USD,1000,'}
          style={{ ...input, width: '100%', fontFamily: 'monospace', fontSize: 12.5 }} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <input type="file" accept=".csv,.txt,.tsv" onChange={(e) => { void onFile(e.target.files?.[0]); setPreview(null); }} style={{ fontSize: 12.5, color: C.dim }} />
          <label style={{ fontSize: 13, color: C.dim }}><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace positions &amp; cash</label>
          <label style={{ fontSize: 13, color: C.dim }}><input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} /> Merge (upsert by ticker + venue)</label>
          <button disabled={!text.trim() || !!busy} style={btn(C.cyan)} onClick={async () => { const j = await post({ action: 'preview', text }, 'preview'); if (j?.parsed) setPreview(j.parsed); }}>Preview</button>
          {/* zzz792 — Import no longer silently disabled until Preview: the server parses the text itself. */}
          <button disabled={!text.trim() || !!busy} title={!text.trim() ? 'Paste or upload your holdings first' : ''} style={btn(C.green, true)} onClick={async () => {
            if (mode === 'replace' && book?.holdings.length && !confirm(`Replace the ${book.holdings.length} holdings and the cash on file with this import?`)) return;
            const j = await post({ action: 'import', text, mode }, 'import');
            if (j?.ok) { setFileNote(null); setMsg(`✓ imported ${j.parsed?.holdings?.length || 0} holdings${Object.keys(j.parsed?.cash || {}).length ? ` + cash ${Object.keys(j.parsed.cash).join(', ')}` : ''} (${mode})`); setText(''); setPreview(null); }
          }}>Import</button>
          {busy && <span style={{ fontSize: 12.5, color: C.faint }}>{busy}…</span>}
        </div>
        {fileNote && <div style={{ fontSize: 13, color: fileNote.startsWith('✗') ? C.red : C.dim, marginTop: 6 }}>{fileNote}</div>}
        {msg && <div style={{ fontSize: 13.5, fontWeight: 700, color: msg.startsWith('✗') ? C.red : C.green, marginTop: 6 }}>{msg}</div>}
        {!text.trim() && !msg && <div style={{ fontSize: 12.5, color: C.faint, marginTop: 6 }}>Paste your holdings in the box above or choose the CSV file — the Import button turns on once there is text.</div>}
        {preview && (
          <div data-testid="us-import-preview" style={{ marginTop: 8, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
            <b style={{ color: C.text }}>Preview ({preview.format}):</b> {preview.holdings.length} holdings ({preview.holdings.filter((h) => h.listing === 'US').length} US-listed, {preview.holdings.filter((h) => h.listing !== 'US').length} non-US) · cash {Object.entries(preview.cash).map(([k, v]) => `${k} ${v.toLocaleString('en-US')}`).join(', ') || 'none'} · {preview.rejected.length} rejected
            <div style={{ color: C.faint }}>{preview.holdings.map((h) => `${h.ticker}${h.rawTicker.toUpperCase() !== h.ticker ? ` (from ${h.rawTicker})` : ''} ${h.quantity}@${h.avgPrice ?? '—'} ${h.currency}${h.listing !== 'US' ? ' [non-US]' : ''}`).join(' · ')}</div>
            {preview.warnings.length > 0 && <div style={{ color: C.amber }}>{preview.warnings.slice(0, 12).join(' · ')}</div>}
            {preview.rejected.map((r) => <div key={r.line} style={{ color: C.red }}>line {r.line}: {r.reason}</div>)}
          </div>
        )}
        {book?.lastImport && <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Last import {String(book.lastImport.at).slice(0, 16).replace('T', ' ')} UTC · {book.lastImport.format} · {book.lastImport.mode} · {book.lastImport.holdings} holdings · cash {book.lastImport.cash.join(', ') || 'none'}{book.lastImport.rejected ? ` · ${book.lastImport.rejected} lines rejected` : ''}</div>}
      </div>
    </div>
  );
}
