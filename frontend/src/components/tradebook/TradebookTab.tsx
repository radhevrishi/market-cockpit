'use client';
// zzz1231 — Portfolio (India) → 📒 Tradebook: upload Zerodha tradebook files (any number, any order; a file or trade seen
// before is ignored), then returns (XIRR overall / this year / by fiscal year, against Nifty Smallcap 100), holdings
// rebuilt from the trades (applied to the portfolio automatically, with Undo), estimated dividends, and trades / P&L.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { applyHoldingsDiff, holdingsDiff, parseTradebookRows, type HoldingChange, type Trade } from '@/lib/tradebook/core';
import type { TradebookAnalytics } from '@/lib/tradebook/server';

type H = { symbol: string; entryPrice: number; quantity: number; weight: number; addedAt: string; notes?: string };
const C = {
  panel: 'var(--mc-bg-1)', line: 'var(--mc-border-2)', txt: 'var(--mc-text-1)', mute: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', red: 'var(--mc-bearish)', amber: '#D97706', blue: '#3B82F6', violet: '#8B5CF6',
};
const inr = (v: number | null | undefined, d = 0) => (v == null || !Number.isFinite(v) ? '—' : `₹${Math.round(v * 10 ** d) / 10 ** d >= 0 ? '' : '−'}${Math.abs(v) >= 1e7 ? `${(Math.abs(v) / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${(Math.abs(v) / 1e5).toFixed(2)} L` : Math.abs(v).toLocaleString('en-IN', { maximumFractionDigits: d })}`);
const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v == null ? C.mute : v >= 0 ? C.green : C.red);

async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14, marginBottom: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: C.txt, letterSpacing: 0.3 }}>{title}</div>{right}
      </div>
      {children}
    </div>
  );
}
function Kpi({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ minWidth: 150, padding: '10px 12px', border: `1px solid ${C.line}`, borderRadius: 8 }}>
      <div style={{ fontSize: 10.5, color: C.dim, fontWeight: 800, letterSpacing: 0.4 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color: color || C.txt, marginTop: 2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
const th: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 11, color: C.dim, fontWeight: 800, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
const thL: React.CSSProperties = { ...th, textAlign: 'left' };
const td: React.CSSProperties = { textAlign: 'right', padding: '6px 8px', fontSize: 12.5, whiteSpace: 'nowrap', borderBottom: `1px solid ${C.line}` };
const tdL: React.CSSProperties = { ...td, textAlign: 'left' };

function GrowthChart({ pts }: { pts: TradebookAnalytics['growth'] }) {
  if (pts.length < 2) return null;
  const W = 900, H = 240, P = 44;
  const all = pts.flatMap((p) => [p.value, p.net, ...(p.bench != null ? [p.bench] : [])]);
  const max = Math.max(...all, 1), min = Math.min(0, ...all);
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => H - P / 2 - ((v - min) / (max - min || 1)) * (H - P);
  const path = (get: (p: typeof pts[number]) => number | null) => pts.map((p, i) => { const v = get(p); return v == null ? '' : `${i && get(pts[i - 1]) != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; }).join(' ');
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => min + k * (max - min));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }} role="img" aria-label="Book value vs the same money in Nifty Smallcap 100">
      {ticks.map((v, i) => (<g key={i}><line x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="var(--mc-border-2)" strokeWidth={0.5} /><text x={P - 6} y={y(v) + 3} fontSize={10} textAnchor="end" fill="var(--mc-text-4)">{inr(v)}</text></g>))}
      <path d={path((p) => p.net)} fill="none" stroke="#94A3B8" strokeWidth={1.2} strokeDasharray="4 3" />
      <path d={path((p) => p.bench)} fill="none" stroke={C.violet} strokeWidth={1.6} />
      <path d={path((p) => p.value)} fill="none" stroke={C.blue} strokeWidth={2.2} />
      {[0, Math.floor((pts.length - 1) / 2), pts.length - 1].map((i) => <text key={i} x={x(i)} y={H - 4} fontSize={10} textAnchor="middle" fill="var(--mc-text-4)">{pts[i].d.slice(0, 7)}</text>)}
    </svg>
  );
}

function ReturnsTable({ rows, title }: { rows: TradebookAnalytics['byFy']; title: string }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr><th style={thL}>{title}</th><th style={th}>Value at start</th><th style={th}>Bought</th><th style={th}>Sold</th><th style={th}>Value at end</th><th style={th}>Gain</th><th style={th} title="Money-weighted return of the period (Modified Dietz) — not annualised">Return</th><th style={th}>XIRR</th><th style={th} title="The same money in Nifty Smallcap 100 on the same days">Nifty Smallcap 100 XIRR</th><th style={th}>Beat index by</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const diff = r.xirr != null && r.bench?.xirr != null ? r.xirr - r.bench.xirr : null;
            return (
              <tr key={r.label}>
                <td style={tdL}><b>{r.label}</b><div style={{ fontSize: 10.5, color: C.dim }}>{r.from} → {r.to}{r.estimated ? ` · ${r.estimated} valued at last trade price` : ''}</div></td>
                <td style={td}>{inr(r.startValue)}</td><td style={td}>{inr(r.invested)}</td><td style={td}>{inr(r.withdrawn)}</td><td style={td}>{inr(r.endValue)}</td>
                <td style={{ ...td, color: tone(r.gain), fontWeight: 700 }}>{inr(r.gain)}</td>
                <td style={{ ...td, color: tone(r.simple) }}>{pct(r.simple)}</td>
                <td style={{ ...td, color: tone(r.xirr), fontWeight: 800 }}>{pct(r.xirr)}</td>
                <td style={{ ...td, color: C.violet }}>{pct(r.bench?.xirr)}</td>
                <td style={{ ...td, color: tone(diff), fontWeight: 700 }}>{diff == null ? '—' : `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)} pts`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function TradebookTab({ holdings, onApply }: { holdings: H[]; onApply: (next: H[]) => Promise<boolean> | boolean }) {
  const [data, setData] = useState<TradebookAnalytics | null>(null);
  const [files, setFiles] = useState<TradebookAnalytics['files']>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [sub, setSub] = useState<'performance' | 'holdings' | 'pnl' | 'dividends' | 'files'>('performance');
  const [applied, setApplied] = useState<{ changes: HoldingChange[]; before: H[] } | null>(null);

  const load = useCallback(async (force = false) => {
    setBusy(force ? 'Recomputing with fresh prices…' : 'Working out returns (prices for every instrument — up to a minute the first time)…'); setErr(null);
    try {
      const r = await fetch(`/api/v1/tradebook?analytics=1${force ? '&force=1' : ''}`, { signal: AbortSignal.timeout(280_000) });
      const j = await r.json();
      if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setData(j); setFiles(j.files || []);
      return j as TradebookAnalytics;
    } catch (e: any) { setErr(String(e?.message || e)); return null; } finally { setBusy(null); }
  }, []);

  useEffect(() => {
    (async () => {
      const r = await fetch('/api/v1/tradebook').then((x) => x.json()).catch(() => null);
      if (r?.files) setFiles(r.files);
      if (r?.files?.length) void load();
    })();
  }, [load]);

  const autoApply = useCallback(async (a: TradebookAnalytics) => {
    const diff = holdingsDiff({ positions: a.ledgerPositions, unmatchedIsins: a.unmatchedIsins, tradedSymbols: a.tradedSymbols }, holdings);
    const changes = diff.filter((d) => d.action !== 'keep');
    if (!changes.length) { setLog((l) => [...l, 'Portfolio already matches the tradebook — nothing to change.']); return; }
    const today = new Date().toISOString();
    const next = applyHoldingsDiff(holdings, diff, (c) => ({ symbol: c.symbol, entryPrice: c.entryPrice, quantity: c.quantity, weight: 0, addedAt: today, notes: 'from tradebook' }));
    const before = holdings;
    const ok = await onApply(next);
    setApplied({ changes, before });
    setLog((l) => [...l, `Portfolio updated from the tradebook: ${changes.filter((c) => c.action === 'add').length} added, ${changes.filter((c) => c.action === 'update').length} quantity / price changed, ${changes.filter((c) => c.action === 'remove').length} sold out and removed${ok ? '' : ' (saved on this device only)'}.`]);
  }, [holdings, onApply]);

  const onFiles = useCallback(async (list: File[]) => {   // zzz1238 — an array copied at once (a FileList empties when the input is cleared)
    if (!list.length) { setErr('No file picked.'); return; }
    setErr(null); setLog([]);
    const XLSX = await import('xlsx');
    const known = new Set(files.map((f) => f.hash));
    let total = 0;
    for (const file of list) {
      setBusy(`Reading ${file.name}…`);
      try {
        const buf = await file.arrayBuffer();
        const hash = await sha256(buf);
        if (known.has(hash)) { setLog((l) => [...l, `${file.name}: uploaded before — skipped.`]); continue; }
        const wb = XLSX.read(buf, { type: 'array' });
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true }) as unknown[][];
        const p = parseTradebookRows(rows);
        if (!p.trades.length) { setLog((l) => [...l, `${file.name}: no trades found (is it a Zerodha equity tradebook?).`]); continue; }
        let added = 0, dup = false;
        for (let i = 0; i < p.trades.length; i += 2000) {
          const chunk: Trade[] = p.trades.slice(i, i + 2000);
          setBusy(`Saving ${file.name} — ${Math.min(i + 2000, p.trades.length)} of ${p.trades.length} trades…`);
          const r = await fetch('/api/v1/tradebook', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file: { hash, name: file.name, from: p.from, to: p.to, rows: p.trades.length }, trades: chunk, last: i + 2000 >= p.trades.length }) });
          const j = await r.json().catch(() => null);
          if (!j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
          if (j.duplicateFile) { dup = true; break; }
          added += j.added;
        }
        known.add(hash);
        total += added;
        setLog((l) => [...l, dup ? `${file.name}: uploaded before — skipped.` : `${file.name}: ${p.from} → ${p.to}, ${p.trades.length} trades, ${added} new${added < p.trades.length ? ` (${p.trades.length - added} already stored)` : ''}.`]);
      } catch (e: any) { setLog((l) => [...l, `${file.name}: failed — ${String(e?.message || e).slice(0, 120)}`]); }
    }
    setBusy(null);
    const a = await load(total > 0);
    if (a && total > 0) await autoApply(a);
  }, [files, load, autoApply]);

  const undo = useCallback(async () => {
    if (!applied) return;
    await onApply(applied.before);
    setLog((l) => [...l, 'Undone — the portfolio is back to what it was before the tradebook.']);
    setApplied(null);
  }, [applied, onApply]);

  const s = data?.summary;
  const pending = useMemo(() => (data ? holdingsDiff({ positions: data.ledgerPositions, unmatchedIsins: data.unmatchedIsins, tradedSymbols: data.tradedSymbols }, holdings).filter((d) => d.action !== 'keep') : []), [data, holdings]);

  return (
    <div data-testid="tradebook-tab">
      <Card title="📒 Tradebook — upload your Zerodha equity tradebooks" right={data && <button onClick={() => load(true)} disabled={!!busy} style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.mute, cursor: 'pointer' }}>↻ Recompute with latest prices</button>}>
        <label style={{ display: 'block', border: `1.5px dashed ${C.line}`, borderRadius: 10, padding: 18, textAlign: 'center', cursor: busy ? 'wait' : 'pointer', color: C.mute, fontSize: 13 }}>
          <input type="file" accept=".xlsx,.xls,.csv" multiple disabled={!!busy} style={{ display: 'none' }} onChange={(e) => { const picked = Array.from(e.target.files || []); e.currentTarget.value = ''; void onFiles(picked); }} />
          <b style={{ color: C.txt }}>Choose tradebook files</b> (Console → Reports → Tradebook → Equity, one file per year is fine).<br />
          Upload all years once, then just the new month later — a file or trade already uploaded is ignored, and your portfolio quantities are updated automatically.
        </label>
        {busy && <div style={{ marginTop: 10, color: C.blue, fontSize: 12.5 }}>⏳ {busy}</div>}
        {err && <div style={{ marginTop: 10, color: C.red, fontSize: 12.5 }}>⚠ {err}</div>}
        {log.length > 0 && <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12.5, color: C.mute }}>{log.map((x, i) => <li key={i}>{x}</li>)}</ul>}
        {applied && (
          <div style={{ marginTop: 10, padding: 10, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><b>Changes made to your portfolio</b><button onClick={undo} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.amber}`, color: C.amber, background: 'transparent', cursor: 'pointer' }}>↶ Undo</button></div>
            <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, color: C.mute }}>
              {applied.changes.map((c) => <div key={c.symbol}>{c.action === 'add' ? '＋' : c.action === 'remove' ? '－' : '✎'} {c.symbol}: {c.before ? `${c.before.quantity} @ ₹${c.before.entryPrice}` : 'new'} → {c.action === 'remove' ? 'sold out' : `${c.quantity} @ ₹${c.entryPrice}`}</div>)}
            </div>
          </div>
        )}
        {!applied && data && pending.length > 0 && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: C.amber }}>
            {pending.length} holding{pending.length === 1 ? '' : 's'} differ from the tradebook. <button onClick={() => data && autoApply(data)} style={{ fontSize: 11.5, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.amber}`, color: C.amber, background: 'transparent', cursor: 'pointer' }}>Update portfolio from tradebook</button>
            {/* zzz1239 — what the button will change, before it is pressed (Undo stays available after) */}
            <div data-testid="tradebook-pending" style={{ maxHeight: 180, overflowY: 'auto', marginTop: 6, color: C.mute }}>
              {pending.map((c) => <div key={c.symbol}>{c.action === 'add' ? '＋ add' : c.action === 'remove' ? '－ remove (sold out)' : '✎ change'} <b>{c.symbol}</b>: {c.before ? `${c.before.quantity} @ ₹${c.before.entryPrice}` : 'not in portfolio'} → {c.action === 'remove' ? '0' : `${c.quantity} @ ₹${c.entryPrice}`}</div>)}
            </div>
          </div>
        )}
      </Card>

      {data && s && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
            <Kpi label="CURRENT VALUE" value={inr(s.value)} sub={`cost ${inr(s.invested)} · prices ${data.priceDate}`} />
            <Kpi label="UNREALISED" value={inr(s.unrealized)} color={tone(s.unrealized)} sub={pct(s.invested ? s.unrealized / s.invested : null)} />
            <Kpi label="REALISED (all years)" value={inr(s.realized)} color={tone(s.realized)} sub="before charges and tax" />
            <Kpi label="XIRR — OVERALL" value={pct(s.xirrAll)} color={tone(s.xirrAll)} sub={`Nifty Smallcap 100: ${pct(s.benchXirrAll)}`} />
            <Kpi label={`XIRR — ${new Date().getFullYear()} SO FAR`} value={pct(s.xirrYtd)} color={tone(s.xirrYtd)} sub={`this fiscal year: ${pct(s.xirrFytd)}`} />
            <Kpi label="DIVIDENDS (estimated)" value={inr(s.dividends)} sub={`${data.tradeCount.toLocaleString('en-IN')} trades · ${data.firstDate} → ${data.lastDate}`} />
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 12, flexWrap: 'wrap' }}>
            {([['performance', 'Performance'], ['holdings', 'Holdings'], ['pnl', 'Trades & P&L'], ['dividends', 'Dividends'], ['files', 'Files & notes']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setSub(k)} style={{ padding: '6px 14px', borderRadius: 7, border: `1px solid ${sub === k ? C.blue : C.line}`, background: sub === k ? `${C.blue}22` : 'transparent', color: sub === k ? C.blue : C.mute, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}>{l}</button>
            ))}
          </div>

          {sub === 'performance' && (
            <>
              <Card title="Your book vs the same money in Nifty Smallcap 100" right={<span style={{ fontSize: 11, color: C.dim }}><span style={{ color: C.blue }}>━ book value</span> · <span style={{ color: C.violet }}>━ Nifty Smallcap 100 (same buys and sells)</span> · <span>┅ net money put in</span></span>}>
                <GrowthChart pts={data.growth} />
              </Card>
              <Card title="Trailing returns"><ReturnsTable rows={data.trailing} title="Period" /></Card>
              <Card title="Returns by fiscal year (April – March)"><ReturnsTable rows={data.byFy} title="Fiscal year" /></Card>
              <Card title="Returns by calendar year"><ReturnsTable rows={data.byYear} title="Year" /></Card>
            </>
          )}

          {sub === 'holdings' && (
            <>
              <Card title={`Holdings rebuilt from the trades — ${data.holdings.length}`}>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead><tr><th style={thL}>Stock</th><th style={th}>Qty</th><th style={th}>Avg cost</th><th style={th}>Price</th><th style={th}>Value</th><th style={th}>P&amp;L</th><th style={th}>P&amp;L %</th><th style={th}>Weight</th><th style={th}>Held since</th><th style={th} title="Share of the position held more than 12 months (long-term)">Long-term</th></tr></thead>
                    <tbody>{data.holdings.map((h) => (
                      <tr key={h.isin}><td style={tdL}><b>{h.symbol}</b></td><td style={td}>{h.qty.toLocaleString('en-IN')}</td><td style={td}>{h.avgCost.toFixed(2)}</td><td style={td}>{h.price?.toFixed(2) ?? '—'}</td>
                        <td style={td}>{inr(h.value)}</td><td style={{ ...td, color: tone(h.pnl) }}>{inr(h.pnl)}</td><td style={{ ...td, color: tone(h.pnlPct), fontWeight: 700 }}>{pct(h.pnlPct)}</td>
                        <td style={td}>{h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : '—'}</td><td style={td}>{h.firstBuy ?? '—'}{h.daysHeld != null ? <span style={{ color: C.dim }}> · {h.daysHeld}d</span> : null}</td><td style={td}>{Math.round(h.ltcgPct * 100)}%</td></tr>
                    ))}</tbody>
                  </table>
                </div>
              </Card>
              {data.turningLongTerm.length > 0 && (
                <Card title="Lots turning long-term in the next 60 days — selling after the date is taxed as LTCG">
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Stock</th><th style={th}>Qty</th><th style={th}>Bought</th><th style={th}>Long-term from</th><th style={th}>Days left</th><th style={th}>Cost</th></tr></thead>
                    <tbody>{data.turningLongTerm.map((x, i) => <tr key={i}><td style={tdL}>{x.symbol}</td><td style={td}>{x.qty}</td><td style={td}>{x.boughtOn}</td><td style={td}>{x.longTermOn}</td><td style={{ ...td, color: C.amber, fontWeight: 700 }}>{x.daysLeft}</td><td style={td}>{inr(x.cost)}</td></tr>)}</tbody></table>
                </Card>
              )}
            </>
          )}

          {sub === 'pnl' && (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                <Kpi label="STCG" value={inr(data.pnl.stcg)} color={tone(data.pnl.stcg)} />
                <Kpi label="LTCG" value={inr(data.pnl.ltcg)} color={tone(data.pnl.ltcg)} />
                <Kpi label="INTRADAY" value={inr(data.pnl.intraday)} color={tone(data.pnl.intraday)} />
                <Kpi label="WIN RATE" value={data.pnl.winRate != null ? `${(data.pnl.winRate * 100).toFixed(0)}%` : '—'} sub={`${data.pnl.wins} won · ${data.pnl.losses} lost of ${data.pnl.trades}`} />
                <Kpi label="PROFIT FACTOR" value={data.pnl.profitFactor != null ? data.pnl.profitFactor.toFixed(2) : '—'} sub="gross wins ÷ gross losses" />
                <Kpi label="MEDIAN HOLD" value={data.pnl.medianHoldDays != null ? `${Math.round(data.pnl.medianHoldDays)} days` : '—'} sub={`avg win ${inr(data.pnl.avgWin)} · avg loss ${inr(data.pnl.avgLoss)}`} />
              </div>
              <Card title="Realised P&L by fiscal year">
                <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={thL}>Fiscal year</th><th style={th}>STCG</th><th style={th}>LTCG</th><th style={th}>Intraday</th><th style={th}>Total</th><th style={th}>Trades</th><th style={th}>Win rate</th><th style={th}>Profit factor</th><th style={th}>Median hold</th></tr></thead>
                  <tbody>{data.pnlByFy.map((f) => <tr key={f.fy}><td style={tdL}><b>{f.fy}</b></td><td style={{ ...td, color: tone(f.stcg) }}>{inr(f.stcg)}</td><td style={{ ...td, color: tone(f.ltcg) }}>{inr(f.ltcg)}</td><td style={{ ...td, color: tone(f.intraday) }}>{inr(f.intraday)}</td><td style={{ ...td, color: tone(f.total), fontWeight: 800 }}>{inr(f.total)}</td><td style={td}>{f.trades}</td><td style={td}>{f.winRate != null ? `${(f.winRate * 100).toFixed(0)}%` : '—'}</td><td style={td}>{f.profitFactor?.toFixed(2) ?? '—'}</td><td style={td}>{f.medianHoldDays != null ? `${Math.round(f.medianHoldDays)}d` : '—'}</td></tr>)}</tbody>
                </table></div>
              </Card>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
                {([['Best trades', data.pnl.best], ['Worst trades', data.pnl.worst]] as const).map(([t, list]) => (
                  <Card key={t} title={t}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Stock</th><th style={th}>Sold</th><th style={th}>Type</th><th style={th}>P&amp;L</th><th style={th}>%</th></tr></thead>
                    <tbody>{list.map((x, i) => <tr key={i}><td style={tdL}>{x.symbol}</td><td style={td}>{x.date}</td><td style={td}>{x.kind}</td><td style={{ ...td, color: tone(x.pnl), fontWeight: 700 }}>{inr(x.pnl)}</td><td style={{ ...td, color: tone(x.pct) }}>{pct(x.pct)}</td></tr>)}</tbody></table></Card>
                ))}
              </div>
              <Card title="Realised P&L by stock (all years)">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 14 }}>
                  {[data.bySymbol.slice(0, 15), data.bySymbol.slice(-15).reverse()].map((list, k) => (
                    <table key={k} style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>{k ? 'Biggest losses' : 'Biggest gains'}</th><th style={th}>Realised</th><th style={th}>Sells</th></tr></thead>
                      <tbody>{list.filter((x) => (k ? x.realized < 0 : x.realized > 0)).map((x) => <tr key={x.symbol}><td style={tdL}>{x.symbol}</td><td style={{ ...td, color: tone(x.realized), fontWeight: 700 }}>{inr(x.realized)}</td><td style={td}>{x.trades}</td></tr>)}</tbody></table>
                  ))}
                </div>
              </Card>
            </>
          )}

          {sub === 'dividends' && (
            <>
              <Card title="Dividends by fiscal year (estimated)" right={<span style={{ fontSize: 11, color: C.dim }}>shares held before each ex-date × dividend per share</span>}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Fiscal year</th><th style={th}>Dividends</th><th style={th}>Payments</th></tr></thead>
                  <tbody>{data.dividends.byFy.map((d) => <tr key={d.fy}><td style={tdL}><b>{d.fy}</b></td><td style={{ ...td, color: C.green, fontWeight: 700 }}>{inr(d.amount)}</td><td style={td}>{d.payments}</td></tr>)}</tbody></table>
              </Card>
              <Card title="Every dividend">
                <div style={{ maxHeight: 420, overflowY: 'auto' }}><table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>Stock</th><th style={th}>Ex-date</th><th style={th}>Shares</th><th style={th}>Per share</th><th style={th}>Amount</th></tr></thead>
                  <tbody>{data.dividends.items.map((d, i) => <tr key={i}><td style={tdL}>{d.symbol}</td><td style={td}>{d.exDate}</td><td style={td}>{d.qty}</td><td style={td}>₹{d.perShare.toFixed(2)}</td><td style={td}>{inr(d.amount)}</td></tr>)}</tbody></table></div>
              </Card>
            </>
          )}

          {sub === 'files' && (
            <>
              <Card title="Notes on these numbers"><ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: C.mute }}>{data.notes.map((n, i) => <li key={i} style={{ marginBottom: 4 }}>{n}</li>)}</ul>
                {data.unmatched.symbols.length > 0 && <div style={{ fontSize: 12, color: C.dim, marginTop: 6 }}>Sold without an earlier buy in the files: {data.unmatched.symbols.join(', ')}</div>}
              </Card>
              <Card title={`Uploaded files — ${files.length}`} right={<button onClick={async () => { if (!window.confirm('Forget every uploaded trade? Your portfolio is not changed.')) return; await fetch('/api/v1/tradebook?confirm=1', { method: 'DELETE' }); setData(null); setFiles([]); }} style={{ fontSize: 11, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.red}`, color: C.red, background: 'transparent', cursor: 'pointer' }}>Forget all trades</button>}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}><thead><tr><th style={thL}>File</th><th style={th}>From</th><th style={th}>To</th><th style={th}>Trades</th><th style={th}>New</th><th style={th}>Uploaded</th></tr></thead>
                  <tbody>{files.map((f) => <tr key={f.hash}><td style={tdL}>{f.name}</td><td style={td}>{f.from}</td><td style={td}>{f.to}</td><td style={td}>{f.rows}</td><td style={td}>{f.added}</td><td style={td}>{f.at.slice(0, 10)}</td></tr>)}</tbody></table>
              </Card>
            </>
          )}
        </>
      )}
    </div>
  );
}
