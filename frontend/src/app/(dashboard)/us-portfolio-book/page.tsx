// ═══════════════════════════════════════════════════════════════════════════
// US PORTFOLIO BOOK — holdings, cash and bench for the US book.  (zzz790, zzz793)
//
// Separate from the India book (/portfolio): its own KV document
// (`us-book:v1:<owner>`) behind /api/v1/us-book. Holdings carry ticker,
// venue, currency, quantity and average cost; cash is kept PER CURRENCY and
// shown apart from positions, never folded into them. Frankfurt (FWB2)
// lines are kept and valued, marked NON-US: they have no SEC filer, so US
// Portfolio Catalysts excludes them and says why.
//
// zzz793 — same tab layout as the India book, in US dollars:
//   Holdings · Analytics · Sectors · Cash & currency · Data check · Manage
// Every table sorts by clicking a column heading. All numbers come from the
// tested lib/us-book/analytics; prices from Yahoo (with their own time), FX
// from Yahoo EURUSD=X, sectors from the SEC industry code.
//
// Market value and P&L live on THIS page only; the catalyst engine never
// reads a price. No named exports here (Next.js page rule) — helpers live in
// the sibling modules ./tabs, ./ui and ./sortable-table.
// ═══════════════════════════════════════════════════════════════════════════

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { UsQuote } from '@/lib/us-book/valuation';
import type { UsBook } from '@/lib/us-book/model';
import type { UsImportResult } from '@/lib/us-book/import';
import type { UsProfile } from '@/lib/us-book/profile';
import { buildUsBookView, usBookAnalytics, ageInWords, fmtUsdShort, type FxDetail, type UsBookRow } from '@/lib/us-book/analytics';
import { HoldingsTab, AnalyticsTab, SectorsTab, CashTab, DataCheckTab } from './tabs';
import { C, money, signedMoney, pct, tone, fmtEt, Tile } from './ui';

const btn = (color = C.cyan, solid = false): React.CSSProperties => ({
  fontSize: 13, fontWeight: 700, padding: '4px 11px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${color}`, background: solid ? `color-mix(in srgb, ${color} 18%, transparent)` : 'transparent', color,
});
const input: React.CSSProperties = { fontSize: 13, padding: '4px 8px', borderRadius: 6, border: `1px solid var(--mc-bg-4)`, background: 'var(--mc-bg-0, transparent)', color: 'var(--tc-text, #F1F5F9)' };
const EMPTY_FORM = { ticker: '', exchange: 'NASDAQ', currency: 'USD', quantity: '', avgPrice: '' };
const TABS = [
  ['holdings', '🐋 Holdings'], ['analytics', '📊 Analytics'], ['sectors', '🏭 Sectors'], ['cash', '💵 Cash & currency'], ['data', '🔎 Data check'], ['manage', '✏️ Manage'],
] as const;
type Tab = typeof TABS[number][0];
const TAB_KEY = 'mc:us-book:tab:v1';

export default function UsPortfolioBookPage() {
  const [book, setBook] = useState<UsBook | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<Record<string, UsQuote>>({});
  const [fx, setFx] = useState<Record<string, FxDetail>>({});
  const [quotesAt, setQuotesAt] = useState<string | null>(null);
  const [quoteErr, setQuoteErr] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, UsProfile>>({});
  const [profileState, setProfileState] = useState<string | null>(null);
  const [tab, setTabState] = useState<Tab>('holdings');
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
  const [fileNote, setFileNote] = useState<string | null>(null);

  useEffect(() => { try { const t = localStorage.getItem(TAB_KEY); if (t && TABS.some(([k]) => k === t)) setTabState(t as Tab); } catch { /* per-viewer convenience only */ } }, []);
  const setTab = (t: Tab) => { setTabState(t); try { localStorage.setItem(TAB_KEY, t); } catch { /* ignore */ } };

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
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setQuotes(j.quotes || {}); setFx(j.fxDetail || {}); setQuotesAt(j.at || null); setQuoteErr(null);
    } catch (e: any) { setQuoteErr(String(e?.message || e)); }   // old prices are kept; each row still shows its own price time
    setQuoting(false);
  }, []);
  const loadProfiles = useCallback(async () => {
    setProfileState('Looking up company names and sectors at the SEC…');
    try {
      const r = await fetch('/api/v1/us-book/profile', { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setProfiles(j.profiles || {});
      const errs = Object.values<UsProfile>(j.profiles || {}).filter((p) => p.status !== 'sec');
      setProfileState(errs.length ? `${errs.length} ticker${errs.length === 1 ? '' : 's'} not found at the SEC (${errs.map((p) => p.ticker).join(', ')}) — shown as Unknown.` : null);
    } catch (e: any) { setProfileState(`Sectors could not be looked up right now (${String(e?.message || e)}) — shown as Unknown.`); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const holdingsSig = book ? book.holdings.map((h) => `${h.ticker}|${h.exchange}`).sort().join(',') : '';
  useEffect(() => { if (book && book.holdings.length) void loadQuotes(); }, [book?.updatedAt, loadQuotes]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (holdingsSig) void loadProfiles(); }, [holdingsSig, loadProfiles]);

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

  const view = useMemo(() => (book ? buildUsBookView({ book, quotes, fx, profiles }) : null), [book, quotes, fx, profiles]);
  const analytics = useMemo(() => (view ? usBookAnalytics(view) : null), [view]);
  const importAt = book?.lastImport?.at || null;
  const importAge = ageInWords(importAt);

  const onFile = async (f: File | null | undefined) => {
    if (!f) return;
    try { const t = await f.text(); setText(t); setFileNote(`Loaded ${f.name} — ${t.split(/\r?\n/).filter((l) => l.trim()).length} lines. Click Import (or Preview first).`); setMsg(null); }
    catch (e: any) { setFileNote(`✗ could not read ${f.name}: ${String(e?.message || e)}`); }
  };
  const onEdit = (r: UsBookRow) => { setForm({ ticker: r.ticker, exchange: r.exchange, currency: r.currency, quantity: String(r.quantity), avgPrice: r.avgPrice == null ? '' : String(r.avgPrice) }); setTab('manage'); };
  const onRemove = (r: UsBookRow) => { if (confirm(`Remove ${r.ticker} (${r.exchange || 'no venue'}) from the US book?`)) void post({ action: 'remove', ticker: r.ticker, exchange: r.exchange }, 'remove'); };

  const t = view?.totals;
  const newestPrice = view ? view.rows.map((r) => r.priceTime).filter(Boolean).sort().pop() || null : null;

  return (
    <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div>
        <h1 style={{ fontSize: 20, fontWeight: 800, color: C.text, margin: 0 }}>🇺🇸 US Portfolio Book</h1>
        <div style={{ fontSize: 14, color: C.dim, marginTop: 4, lineHeight: 1.55, maxWidth: 900 }}>
          Your US shares and cash, in US dollars, kept apart from the India book. Profit and loss is against your average cost;{' '}
          <b style={{ color: C.text }}>none of this reaches the catalyst engine</b>, which reads SEC filings only.{' '}
          <a href="/us-portfolio-catalysts" style={{ color: C.cyan }}>US Portfolio Catalysts →</a> · <a href="/portfolio" style={{ color: C.faint }}>India book →</a>
        </div>
      </div>
      {err && <div style={{ color: C.red, fontSize: 14 }}>The US book could not be read: {err}. This is not an empty book — nothing was changed.</div>}

      {book && (
        <div data-testid="us-import-age" style={{ fontSize: 13, color: importAt && Date.now() - Date.parse(importAt) > 7 * 86_400_000 ? C.amber : C.dim, border: `1px solid ${C.border}`, borderRadius: 8, padding: '6px 10px', background: C.bg }}>
          {importAt
            ? <>📥 <b>Imported {importAge}</b> ({new Date(importAt).toLocaleDateString('en-US', { dateStyle: 'medium' })}) — quantities and cash are from that import; re-import after trades.</>
            : <>📥 No import on file yet — holdings were added by hand. Quantities and cash are only as current as your last edit.</>}
          {' '}Prices: Yahoo Finance{newestPrice ? `, latest ${fmtEt(newestPrice)}` : ''}{quotesAt ? ` (checked ${ageInWords(quotesAt)})` : ''}.{' '}
          <button onClick={() => loadQuotes()} disabled={quoting} style={{ ...btn(C.cyan), fontSize: 12, padding: '2px 9px' }}>{quoting ? 'Refreshing…' : '↻ Refresh prices'}</button>
          {quoteErr && <span style={{ color: C.red }}> Price refresh failed: {quoteErr} — the figures below use the last prices that loaded.</span>}
        </div>
      )}

      {view && t && book && book.holdings.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Tile testId="us-tile-total" label="WHOLE BOOK (US$)" value={money(t.totalUsd, 'USD', 0)} sub={<>shares {fmtUsdShort(t.holdingsUsd)} + cash {fmtUsdShort(t.cashUsd)}{view.totalEur != null ? <> · ≈ {money(view.totalEur, 'EUR', 0)}</> : <> · EUR: FX unavailable</>}</>} />
          <Tile label="UNREALIZED P&L" value={signedMoney(t.pnlUsd, 'USD', 0)} color={tone(t.pnlUsd)} sub={`${pct(t.pnlPct)} on cost ${fmtUsdShort(t.costValuedUsd)}`} />
          <Tile label="DAY CHANGE" value={t.dayCovered ? signedMoney(t.dayChangeUsd, 'USD', 0) : '—'} color={tone(t.dayCovered ? t.dayChangeUsd : null)} sub={t.dayCovered ? `${pct(t.dayChangePct)} since previous close` : 'no previous close available'} />
          <Tile label="HOLDINGS" value={`${t.valued} / ${t.count} valued`} color={t.unvalued ? C.amber : undefined} sub={t.unvalued ? `${t.unvalued} without a usable price — see Data check` : 'every holding has a recent price'} />
        </div>
      )}

      {book && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10, padding: 4, alignSelf: 'flex-start' }}>
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} style={{ padding: '7px 14px', border: 'none', borderRadius: 7, cursor: 'pointer', fontSize: 12.5, fontWeight: 800, background: tab === k ? '#1D4ED8' : 'transparent', color: tab === k ? '#fff' : C.dim }}>{l}</button>
          ))}
        </div>
      )}
      {msg && <div style={{ fontSize: 13.5, color: msg.startsWith('✗') ? C.red : C.green }}>{msg}</div>}

      {view && analytics && book && (
        book.holdings.length === 0 && tab !== 'manage' && tab !== 'cash'
          ? <div style={{ fontSize: 13.5, color: C.dim }}>No holdings yet — open the <button onClick={() => setTab('manage')} style={{ all: 'unset', cursor: 'pointer', color: C.cyan, fontWeight: 800 }}>Manage</button> tab to import your CSV or add one by hand.</div>
          : tab === 'holdings' ? <HoldingsTab view={view} onEdit={onEdit} onRemove={onRemove} />
          : tab === 'analytics' ? <AnalyticsTab view={view} a={analytics} />
          : tab === 'sectors' ? <SectorsTab view={view} a={analytics} profileState={profileState} />
          : tab === 'cash' ? <CashTab view={view} a={analytics} />
          : tab === 'data' ? <DataCheckTab view={view} importAt={importAt} quotesAt={quotesAt} quoteErr={quoteErr} profileState={profileState} />
          : null
      )}

      {(tab === 'manage' || !book) && (
        <>
          {/* ── MANUAL ADD / EDIT ─────────────────────────────────────────── */}
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

          {/* ── CASH ─────────────────────────────────────────────────────── */}
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
            <span style={{ fontSize: 12, color: C.faint }}>BASE = the broker’s own total in its base currency (EUR). It repeats the other cash lines, so it is never added to them.</span>
          </div>

          {/* ── BENCH / WATCH ────────────────────────────────────────────── */}
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

          {/* ── IMPORT ───────────────────────────────────────────────────── */}
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
              <button disabled={!text.trim() || !!busy} title={!text.trim() ? 'Paste or upload your holdings first' : ''} style={btn(C.green, true)} onClick={async () => {
                if (mode === 'replace' && book?.holdings.length && !confirm(`Replace the ${book.holdings.length} holdings and the cash on file with this import?`)) return;
                const j = await post({ action: 'import', text, mode }, 'import');
                if (j?.ok) { setFileNote(null); setMsg(`✓ imported ${j.parsed?.holdings?.length || 0} holdings${Object.keys(j.parsed?.cash || {}).length ? ` + cash ${Object.keys(j.parsed.cash).join(', ')}` : ''} (${mode})`); setText(''); setPreview(null); }
              }}>Import</button>
              {busy && <span style={{ fontSize: 12.5, color: C.faint }}>{busy}…</span>}
            </div>
            {fileNote && <div style={{ fontSize: 13, color: fileNote.startsWith('✗') ? C.red : C.dim, marginTop: 6 }}>{fileNote}</div>}
            {!text.trim() && !msg && <div style={{ fontSize: 12.5, color: C.faint, marginTop: 6 }}>Paste your holdings in the box above or choose the CSV file — the Import button turns on once there is text.</div>}
            {preview && (
              <div data-testid="us-import-preview" style={{ marginTop: 8, fontSize: 13, color: C.dim, lineHeight: 1.5 }}>
                <b style={{ color: C.text }}>Preview ({preview.format}):</b> {preview.holdings.length} holdings ({preview.holdings.filter((h) => h.listing === 'US').length} US-listed, {preview.holdings.filter((h) => h.listing !== 'US').length} non-US) · cash {Object.entries(preview.cash).map(([k, v]) => `${k} ${v.toLocaleString('en-US')}`).join(', ') || 'none'} · {preview.rejected.length} rejected
                <div style={{ color: C.faint }}>{preview.holdings.map((h) => `${h.ticker}${h.rawTicker.toUpperCase() !== h.ticker ? ` (from ${h.rawTicker})` : ''} ${h.quantity}@${h.avgPrice ?? '—'} ${h.currency}${h.listing !== 'US' ? ' [non-US]' : ''}`).join(' · ')}</div>
                {preview.warnings.length > 0 && <div style={{ color: C.amber }}>{preview.warnings.slice(0, 12).join(' · ')}</div>}
                {preview.rejected.map((r) => <div key={r.line} style={{ color: C.red }}>line {r.line}: {r.reason}</div>)}
              </div>
            )}
            {book?.lastImport && <div style={{ fontSize: 12, color: C.faint, marginTop: 6 }}>Last import {importAge} ({String(book.lastImport.at).slice(0, 16).replace('T', ' ')} UTC) · {book.lastImport.format} · {book.lastImport.mode} · {book.lastImport.holdings} holdings · cash {book.lastImport.cash.join(', ') || 'none'}{book.lastImport.rejected ? ` · ${book.lastImport.rejected} lines rejected` : ''}</div>}
          </div>
        </>
      )}
    </div>
  );
}
