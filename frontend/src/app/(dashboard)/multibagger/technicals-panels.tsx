'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import type { Bucket } from '@/lib/multibagger-india-scoring';
import { F, GREEN, MUTED, RED } from './constants';

// ─── zzz207/zzz209: VOLUME POCKETS PANEL (Screener.in weekly + monthly) ──
// zzz209: full decision table. Company NAMES (not just tickers), Pocket Score
// 0-100 built from: volume surge vs 1Y avg · trend vs DMA50/200 · distance
// from 52w high · Q sales/profit growth · quality (ROCE, D/E, promoter,
// pledge). Verdict tags (🟢 STRONG / 🟡 WATCH / ⚪ WEAK + ⚠ red flags),
// TV-universe tech score cross-ref, ranked descending. India Technicals only.
export function VolumePocketsPanel({ techRows, onBest, onOpen }: { techRows: any[]; onBest?: (tvSymbols: string[]) => void; onOpen?: (symbol: string) => void }) {
  const PANEL = '#0F141B';
  const PANEL2 = '#121821';
  const LINE = '#1E2632';
  const LINE2 = '#2A3444';
  const TXT = '#E5ECF4';
  const MUTED = '#7B8898';
  const CYAN = '#22D3EE';
  const GREEN = '#10B981';
  const RED = '#EF4444';
  const AMBER = '#F59E0B';
  const VIOLET = '#A78BFA';

  type PocketStock = {
    symbol: string; name: string; isBseCode: boolean;
    inWeekly: boolean; inMonthly: boolean;
    cmp?: number; mcap?: number;
    surge?: number; surgeSrc?: 'W' | 'M';
    above50?: boolean; above200?: boolean;
    dist52w?: number;            // % from 52w high (negative = below)
    salesQ?: number; profitQ?: number;
    roce?: number; de?: number; promoter?: number; pledge?: number;
    opmQ?: number; ret1y?: number; pe?: number;
    score: number; verdict: 'STRONG' | 'WATCH' | 'WEAK'; flags: string[]; isNew?: boolean;
    tv?: any;
  };
  const [stocks, setStocks] = React.useState<PocketStock[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [toast, setToast] = React.useState('');
  const [tick, setTick] = React.useState(0);

  const techMap = React.useMemo(() => {
    const m = new Map<string, any>();
    for (const r of techRows || []) {
      const s = (r.symbol || r.ticker || '').toUpperCase();
      if (s) m.set(s, r);
    }
    return m;
  }, [techRows]);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const nn = (v: any): number | undefined => {
          if (v === undefined || v === null || v === '') return undefined;
          const n = typeof v === 'number' ? v : Number(String(v).replace(/,/g, ''));
          return Number.isFinite(n) ? n : undefined;
        };
        const mResp = await fetch('/data/screener/manifest.json', { cache: 'no-store' });
        if (!mResp.ok) { if (!cancelled) setStocks([]); return; }
        const manifest = await mResp.json();
        const files: { name: string }[] = manifest?.files || [];
        const XLSX = await import('xlsx');
        const byKey = new Map<string, PocketStock>();

        for (const pk of ['weekly', 'monthly'] as const) {
          const f = files.find(x => x.name && x.name.startsWith(`${pk}-volume-pockets`));
          if (!f) continue;
          let raw: Record<string, any>[] = [];
          try {
            const r = await fetch(`/data/screener/${f.name}`, { cache: 'no-store' });
            if (!r.ok) continue;
            const ab = await r.arrayBuffer();
            const wb = XLSX.read(new Uint8Array(ab), { type: 'array' });
            raw = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]], { defval: '' });
          } catch { continue; }

          for (const row of raw) {
            const nse = String(row['NSE Code'] || row['NSE code'] || '').trim();
            const bse = String(row['BSE Code'] || row['BSE code'] || '').trim();
            const symbol = nse || bse;
            const name = String(row['Name'] || '').trim();
            if (!symbol && !name) continue;
            const key = symbol || name;
            let s = byKey.get(key);
            if (!s) {
              const cmp = nn(row['Current Price']);
              const dma50 = nn(row['DMA 50']);
              const dma200 = nn(row['DMA 200']);
              const f52 = nn(row['From 52w high']); // price ÷ 52w-high ratio (0-1)
              s = {
                symbol: symbol || '—', name: name || symbol, isBseCode: !nse && !!bse,
                inWeekly: false, inMonthly: false,
                cmp, mcap: nn(row['Market Capitalization']),
                above50: (cmp != null && dma50 != null) ? cmp > dma50 : undefined,
                above200: (cmp != null && dma200 != null) ? cmp > dma200 : undefined,
                dist52w: f52 != null ? (f52 - 1) * 100 : undefined,
                salesQ: nn(row['YOY Quarterly sales growth']),
                profitQ: nn(row['YOY Quarterly profit growth']),
                roce: nn(row['Return on capital employed']),
                de: nn(row['Debt to equity']),
                promoter: nn(row['Promoter holding']),
                pledge: nn(row['Pledged percentage']),
                opmQ: nn(row['OPM latest quarter']),
                ret1y: nn(row['Return over 1year']),
                pe: nn(row['Price to Earning']),
                score: 0, verdict: 'WEAK', flags: [],
              };
              byKey.set(key, s);
            }
            if (pk === 'weekly') s.inWeekly = true; else s.inMonthly = true;
            // Volume surge: short-window avg vs 1-year avg — keep the STRONGEST
            const volY = nn(row['Volume 1year average']);
            const volShort = pk === 'weekly' ? nn(row['Volume 1week average']) : nn(row['Volume 1month average']);
            if (volY && volShort && volY > 0) {
              const ratio = volShort / volY;
              if (s.surge == null || ratio > s.surge) { s.surge = ratio; s.surgeSrc = pk === 'weekly' ? 'W' : 'M'; }
            }
          }
        }

        // Score + verdict
        for (const s of byKey.values()) {
          let sc = 0;
          const flags: string[] = [];
          if (s.surge != null) sc += Math.max(0, Math.min(30, Math.round(10 * Math.log2(s.surge))));
          if (s.above50 === true) sc += 10;
          if (s.above200 === true) sc += 10;
          if (s.dist52w != null) sc += s.dist52w >= -10 ? 10 : s.dist52w >= -25 ? 5 : 0;
          if (s.salesQ != null) sc += s.salesQ >= 25 ? 10 : s.salesQ >= 10 ? 5 : 0;
          if (s.profitQ != null) sc += s.profitQ >= 25 ? 10 : s.profitQ >= 10 ? 5 : 0;
          if (s.ret1y != null && s.ret1y > 20) sc += 5;
          if (s.roce != null && s.roce >= 15) sc += 5;
          if (s.de != null && s.de <= 0.5) sc += 5;
          if (s.promoter != null && s.promoter >= 50) sc += 3;
          if (s.pledge != null && s.pledge === 0) sc += 2;
          if (s.profitQ != null && s.profitQ < -20) flags.push('profit falling');
          if (s.opmQ != null && s.opmQ <= 0) flags.push('negative OPM');
          if (s.pledge != null && s.pledge > 5) flags.push(`pledge ${s.pledge.toFixed(0)}%`);
          if (s.de != null && s.de > 1.5) flags.push(`D/E ${s.de.toFixed(1)}`);
          if (s.above200 === false) flags.push('below 200-DMA');
          s.score = Math.min(100, sc);
          s.flags = flags;
          s.verdict = (s.score >= 65 && flags.length === 0) ? 'STRONG' : s.score >= 45 ? 'WATCH' : 'WEAK';
          s.tv = techMap.get((s.symbol || '').toUpperCase());
        }

        const arr = [...byKey.values()].sort((a, b) => b.score - a.score || (b.surge ?? 0) - (a.surge ?? 0));

        // zzz214 — 🆕 NEW-today detection vs the previous day's membership
        // snapshot. Snapshot rolls forward once per calendar day so the NEW
        // badges stay stable all day.
        try {
          const SNAP_KEY = 'mc_volpockets_snap_v1';
          const today = new Date().toISOString().slice(0, 10);
          const curSyms = arr.map(x => x.symbol).filter(Boolean).sort();
          let snap: { date: string; prev: string[]; cur: string[] } | null = null;
          try { snap = JSON.parse(localStorage.getItem(SNAP_KEY) || 'null'); } catch {}
          let baselineSyms: string[] = [];
          if (!snap || !snap.date) {
            snap = { date: today, prev: [], cur: curSyms };
          } else if (snap.date === today) {
            baselineSyms = snap.prev || [];
            snap.cur = curSyms;
          } else {
            baselineSyms = snap.cur || [];
            snap = { date: today, prev: snap.cur || [], cur: curSyms };
          }
          localStorage.setItem(SNAP_KEY, JSON.stringify(snap));
          if (baselineSyms.length > 0) {
            const base = new Set(baselineSyms);
            for (const x of arr) if (x.symbol && !base.has(x.symbol)) x.isNew = true;
          }
        } catch {}
        if (!cancelled) setStocks(arr);
      } catch {
        if (!cancelled) setStocks([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [techMap, tick]);

  // zzz211 — report Strong+Watch pocket names up for the master button.
  React.useEffect(() => {
    if (!onBest || !stocks) return;
    onBest(stocks.filter(x => x.verdict !== 'WEAK' && !x.isBseCode).map(x => `NSE:${x.symbol}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks]);

  const copy = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setToast(`✓ Copied ${label}`);
      setTimeout(() => setToast(''), 2500);
    } catch {
      setToast('⚠️ Copy failed');
      setTimeout(() => setToast(''), 3000);
    }
  };
  const tvList = (arr: PocketStock[]) => arr.filter(x => !x.isBseCode).map(x => `NSE:${x.symbol}`).join(',');

  if (stocks === null) {
    return (
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 16, marginBottom: 20, fontSize: 13, color: MUTED }}>
        📦 Loading Volume Pockets (Screener.in)…
      </div>
    );
  }

  const weekly = stocks.filter(s => s.inWeekly);
  const monthly = stocks.filter(s => s.inMonthly);
  const strongN = stocks.filter(s => s.verdict === 'STRONG').length;
  const watchN = stocks.filter(s => s.verdict === 'WATCH').length;

  const fmtCr = (v?: number) => v == null ? '—' : v >= 1000 ? `₹${(v / 1000).toFixed(1)}k Cr` : `₹${Math.round(v)} Cr`;
  const fmtPc = (v?: number, dp = 0) => v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(dp)}%`;
  const pcColor = (v?: number) => v == null ? MUTED : v >= 0 ? GREEN : RED;

  const th = (label: string, align: 'left' | 'right' | 'center' = 'right') => (
    <th style={{ textAlign: align, padding: '11px 9px', color: MUTED, fontSize: 11.5, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{label}</th>
  );

  return (
    <div style={{ background: `linear-gradient(180deg, ${VIOLET}0D 0%, ${PANEL} 55%)`, border: `1px solid ${VIOLET}55`, borderRadius: 14, padding: 20, marginBottom: 20 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: TXT }}>📦 Volume Pockets · Screener.in</div>
        <span style={{ background: `${GREEN}22`, color: GREEN, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>🟢 Strong {strongN}</span>
        <span style={{ background: `${AMBER}22`, color: AMBER, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 700 }}>🟡 Watch {watchN}</span>
        {stocks.some(x => x.isNew) && (
          <span style={{ background: `${CYAN}22`, color: CYAN, padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 800 }}>🆕 New today {stocks.filter(x => x.isNew).length}</span>
        )}
        <span style={{ background: `${CYAN}18`, color: CYAN, padding: '3px 10px', borderRadius: 999, fontSize: 12 }}>📅 Weekly {weekly.length}</span>
        <span style={{ background: `${VIOLET}18`, color: VIOLET, padding: '3px 10px', borderRadius: 999, fontSize: 12 }}>🗓 Monthly {monthly.length}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button onClick={() => copy(tvList(weekly), `Weekly pockets (${weekly.length})`)}
            style={{ background: 'transparent', border: `1px solid ${LINE2}`, color: TXT, padding: '5px 11px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>📋 Copy 📅 Weekly</button>
          <button onClick={() => copy(tvList(monthly), `Monthly pockets (${monthly.length})`)}
            style={{ background: 'transparent', border: `1px solid ${LINE2}`, color: TXT, padding: '5px 11px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>📋 Copy 🗓 Monthly</button>
          <button onClick={() => copy(tvList(stocks.filter(x => x.verdict !== 'WEAK')), 'Strong + Watch pockets')}
            style={{ background: `${GREEN}22`, border: `1px solid ${GREEN}55`, color: GREEN, padding: '5px 11px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>📋 Copy 🟢+🟡</button>
          <button onClick={() => setTick(t => t + 1)} disabled={loading}
            style={{ background: PANEL2, color: VIOLET, border: `1px solid ${VIOLET}55`, padding: '5px 11px', borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: loading ? 'wait' : 'pointer' }}>{loading ? '⏳' : '🔄 Refresh'}</button>
          {toast && <span style={{ background: toast.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: toast.startsWith('✓') ? GREEN : RED, padding: '5px 10px', borderRadius: 6, fontSize: 11.5, fontWeight: 700 }}>{toast}</span>}
        </div>
      </div>
      <div style={{ fontSize: 12, color: MUTED, marginBottom: 12, lineHeight: 1.55 }}>
        Screener.in screens <b style={{ color: TXT }}>Weekly (3771598)</b> + <b style={{ color: TXT }}>Monthly (3771541)</b>, auto-synced 4×/day.
        <b style={{ color: TXT }}> Pocket Score (0-100)</b>: volume surge vs 1Y avg (30) · trend vs 50/200-DMA (20) · near 52w high (10) · Q sales + profit growth (20) · 1Y return (5) · quality — ROCE, D/E, promoter, zero pledge (15).
        <b style={{ color: GREEN }}> 🟢 STRONG</b> = 65+ with no red flags · <b style={{ color: AMBER }}>🟡 WATCH</b> = 45+ · ⚠ flags listed per stock. TV column = tech score if the stock is in your TradingView universe.
      </div>

      {stocks.length === 0 ? (
        <div style={{ fontSize: 12.5, color: MUTED, padding: 12, background: PANEL2, borderRadius: 8 }}>
          No Volume Pockets data on the server yet. The screener-sync GitHub Action runs 4×/day — or trigger it manually (Actions → &quot;Sync Screener.in CSVs&quot;).
        </div>
      ) : (
        <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr style={{ borderBottom: `2px solid ${LINE2}`, background: PANEL2 }}>
                {th('#', 'left')}
                {th('Company', 'left')}
                {th('Pocket', 'center')}
                {th('CMP')}
                {th('MCap')}
                {th('Vol surge')}
                {th('Trend', 'center')}
                {th('52wH')}
                {th('Sales Q')}
                {th('Profit Q')}
                {th('ROCE')}
                {th('D/E')}
                {th('TV', 'center')}
                {th('Verdict', 'left')}
                {th('Score')}
              </tr>
            </thead>
            <tbody>
              {stocks.map((s, i) => {
                const vColor = s.verdict === 'STRONG' ? GREEN : s.verdict === 'WATCH' ? AMBER : MUTED;
                const zebra = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent';
                return (
                  <tr key={s.symbol + s.name}
                    onClick={() => { if (s.tv && onOpen) onOpen(s.symbol); }}
                    title={s.tv ? 'Click for full detail modal' : 'Not in your TradingView universe — no detail data yet'}
                    style={{ borderBottom: `1px solid ${LINE}`, background: s.verdict === 'STRONG' ? `${GREEN}0C` : zebra, cursor: s.tv && onOpen ? 'pointer' : 'default' }}>
                    <td style={{ padding: '9px', color: i < 3 ? AMBER : MUTED, fontWeight: i < 3 ? 800 : 400 }}>{i + 1}</td>
                    <td style={{ padding: '9px', minWidth: 170 }}>
                      <div style={{ color: TXT, fontWeight: 800, fontSize: 13.5 }}>
                        {s.name}
                        {s.isNew && <span title="Newly entered the pocket vs yesterday's snapshot" style={{ marginLeft: 6, fontSize: 10, background: 'rgba(34,211,238,0.18)', color: CYAN, padding: '1px 6px', borderRadius: 4, fontWeight: 800, verticalAlign: 'middle' }}>NEW</span>}
                      </div>
                      <div style={{ color: MUTED, fontSize: 10.5, marginTop: 2 }}>{s.isBseCode ? `BSE ${s.symbol}` : `NSE:${s.symbol}`}</div>
                    </td>
                    <td style={{ padding: '9px', textAlign: 'center', fontSize: 13, whiteSpace: 'nowrap' }}>
                      {s.inWeekly && <span title="Weekly Volume Pockets" style={{ marginRight: s.inMonthly ? 3 : 0 }}>📅</span>}
                      {s.inMonthly && <span title="Monthly Volume Pockets">🗓</span>}
                    </td>
                    <td style={{ padding: '9px', textAlign: 'right', color: TXT, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{s.cmp != null ? `₹${s.cmp.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : '—'}</td>
                    <td style={{ padding: '9px', textAlign: 'right', color: MUTED, fontVariantNumeric: 'tabular-nums' }}>{fmtCr(s.mcap)}</td>
                    <td style={{ padding: '9px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <span style={{ color: (s.surge ?? 0) >= 8 ? GREEN : (s.surge ?? 0) >= 3 ? AMBER : MUTED, fontWeight: 800, fontSize: 13.5 }}>
                        {s.surge != null ? `${s.surge.toFixed(1)}×` : '—'}
                      </span>
                      {s.surgeSrc && <span style={{ color: MUTED, fontSize: 10, marginLeft: 3 }}>{s.surgeSrc}</span>}
                    </td>
                    <td style={{ padding: '9px', textAlign: 'center', whiteSpace: 'nowrap', fontSize: 11 }}>
                      <span title="price vs 50-DMA" style={{ color: s.above50 === true ? GREEN : s.above50 === false ? RED : MUTED }}>{s.above50 === true ? '✓' : s.above50 === false ? '✗' : '·'}50</span>
                      <span title="price vs 200-DMA" style={{ color: s.above200 === true ? GREEN : s.above200 === false ? RED : MUTED, marginLeft: 5 }}>{s.above200 === true ? '✓' : s.above200 === false ? '✗' : '·'}200</span>
                    </td>
                    <td style={{ padding: '9px', textAlign: 'right', color: (s.dist52w ?? -99) >= -10 ? GREEN : (s.dist52w ?? -99) >= -25 ? AMBER : RED, fontVariantNumeric: 'tabular-nums' }}>{s.dist52w != null ? `${s.dist52w.toFixed(0)}%` : '—'}</td>
                    <td style={{ padding: '9px', textAlign: 'right', color: pcColor(s.salesQ), fontVariantNumeric: 'tabular-nums' }}>{fmtPc(s.salesQ)}</td>
                    <td style={{ padding: '9px', textAlign: 'right', color: pcColor(s.profitQ), fontVariantNumeric: 'tabular-nums' }}>{fmtPc(s.profitQ)}</td>
                    <td style={{ padding: '9px', textAlign: 'right', color: (s.roce ?? 0) >= 15 ? GREEN : MUTED, fontVariantNumeric: 'tabular-nums' }}>{s.roce != null ? s.roce.toFixed(0) + '%' : '—'}</td>
                    <td style={{ padding: '9px', textAlign: 'right', color: (s.de ?? 0) > 1 ? RED : (s.de ?? 0) > 0.5 ? AMBER : GREEN, fontVariantNumeric: 'tabular-nums' }}>{s.de != null ? s.de.toFixed(2) : '—'}</td>
                    <td style={{ padding: '9px', textAlign: 'center' }}>
                      {s.tv
                        ? <span title={`In your TV universe · tech ${s.tv.totalScore ?? '—'} · ${s.tv.rightEntry ?? ''}`} style={{ background: `${GREEN}1F`, color: (s.tv.totalScore ?? 0) >= 60 ? GREEN : AMBER, fontWeight: 800, fontSize: 12, padding: '2px 8px', borderRadius: 6 }}>{s.tv.totalScore ?? '—'}</span>
                        : <span title="Not in your TradingView universe — candidate to add" style={{ color: MUTED, fontSize: 11 }}>—</span>}
                    </td>
                    <td style={{ padding: '9px', minWidth: 130 }}>
                      <span style={{ color: vColor, fontWeight: 800, fontSize: 12 }}>
                        {s.verdict === 'STRONG' ? '🟢 STRONG' : s.verdict === 'WATCH' ? '🟡 WATCH' : '⚪ WEAK'}
                      </span>
                      {s.flags.length > 0 && <div style={{ color: RED, fontSize: 10.5, marginTop: 2, lineHeight: 1.4 }}>⚠ {s.flags.join(' · ')}</div>}
                    </td>
                    <td style={{ padding: '9px', textAlign: 'right' }}>
                      <span style={{ display: 'inline-block', background: `${vColor}1F`, border: `1px solid ${vColor}55`, color: vColor, fontWeight: 900, fontSize: 14, padding: '3px 9px', borderRadius: 8, fontVariantNumeric: 'tabular-nums' }}>{s.score}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: MUTED, marginTop: 10, lineHeight: 1.6 }}>
        💡 <b style={{ color: TXT }}>How to act on this:</b> a 🟢 STRONG with big vol surge + ✓50 ✓200 + near 52wH is institutional accumulation in an uptrend — check the SEPA table / detail modal before entry.
        A high surge <b>below</b> the 200-DMA is early accumulation in a base — watchlist, don&apos;t chase. Names without a TV score aren&apos;t in your TradingView export yet — use the copy buttons to add them.
      </div>
    </div>
  );
}

// ─── zzz203/204/205/206: SEPA CHECKLIST PANEL (Winning Playbook overlay) ──
// zzz206: (1) UI upsize — bigger fonts everywhere, roomier cells, score pills,
// zebra rows, stacked sub-checks, exchange tag under ticker; (2) EXPORT BEST
// SEPA PICKS block — TradingView copy (with sections), comma list, .txt / .csv
// download, per-bucket copy (Elite / Good / Fresh / Tight). Panel is shared by
// BOTH the India and USA Technicals tabs, so both get the export for free.
export function SepaChecklistPanel({ techRows, onBest, onOpen }: { techRows: any[]; onBest?: (tvSymbols: string[]) => void; onOpen?: (symbol: string) => void }) {
  const PANEL = '#0F141B';
  const PANEL2 = '#121821';
  const LINE = '#1E2632';
  const LINE2 = '#2A3444';
  const TXT = '#E5ECF4';
  const MUTED = '#7B8898';
  const CYAN = '#22D3EE';
  const GREEN = '#10B981';
  const RED = '#EF4444';
  const AMBER = '#F59E0B';
  const VIOLET = '#A78BFA';
  const BLUE = '#60A5FA';

  const [filter, setFilter] = React.useState<'all' | 'elite' | 'fresh' | 'tight'>('all');
  const [sortBy, setSortBy] = React.useState<'score' | 'perf1y' | 'perf3m' | 'perf1w' | 'rsRank' | 'distHigh'>('score');

  const universe = React.useMemo(() => techRows || [], [techRows]);

  const pct = React.useCallback((sortedArr: number[], v: number | undefined | null) => {
    if (v == null || !Number.isFinite(v) || sortedArr.length === 0) return null;
    let lo = 0, hi = sortedArr.length;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (sortedArr[m] < v) lo = m + 1; else hi = m;
    }
    return lo / sortedArr.length;
  }, []);

  const buildSorted = (getKey: (r: any) => number | undefined) =>
    React.useMemo(() => universe
      .map((r: any) => getKey(r))
      .filter((x): x is number => x != null && Number.isFinite(x))
      .sort((a, b) => a - b),
      [universe]);

  const perf1ySorted = buildSorted((r) => r.perf1y);
  const perf3mSorted = buildSorted((r) => r.perf3m);
  const perf1wSorted = buildSorted((r) => r.perf1w);
  const adrSorted = buildSorted((r) => r.adrPct);

  const scored = React.useMemo(() => {
    return universe.map((r: any) => {
      const price = r.price;
      // TREND checks with LABELS so we can build a "why" string
      const trendLabels = ['Stage 2', 'Full stack', '> 21-EMA'];
      const stage2 = (price != null && r.sma200 != null && r.sma50 != null)
        ? (price > r.sma200 && r.sma50 > r.sma200) : null;
      const stackTight = (r.sma50 != null && r.sma150 != null && r.sma200 != null)
        ? (r.sma50 > r.sma150 * 1.03 && r.sma150 > r.sma200 * 1.03)
        : (r.sma50 != null && r.sma200 != null) ? (r.sma50 > r.sma200 * 1.06) : null;
      const above21 = (price != null && r.ema21 != null) ? price > r.ema21 : null;
      const trendChecks = [stage2, stackTight, above21];

      const rsLabels = ['1Y top 20%', '3M top 25%', '1W up'];
      const p1y = pct(perf1ySorted, r.perf1y);
      const p3m = pct(perf3mSorted, r.perf3m);
      const p1w = pct(perf1wSorted, r.perf1w);
      const rs1y = p1y == null ? null : p1y >= 0.80;
      const rs3m = p3m == null ? null : p3m >= 0.75;
      const rs1w = p1w == null ? null : (p1w >= 0.50 && (r.perf1w ?? 0) > 0);
      const rsChecks = [rs1y, rs3m, rs1w];

      const setupLabels = ['Near 52wH', 'Tight base', 'Not extended'];
      const nearHigh = (r.distFromHigh != null) ? r.distFromHigh >= -15 : null;
      const adrPctile = pct(adrSorted, r.adrPct);
      const tight = adrPctile == null ? null : adrPctile <= 0.40;
      const rsiOk = (r.rsi == null) ? true : r.rsi < 80;
      const notFarAbove21 = (r.pctVsEma21 == null) ? true : r.pctVsEma21 < 15;
      const notExtended = (r.rsi != null || r.pctVsEma21 != null) ? (rsiOk && notFarAbove21) : null;
      const setupChecks = [nearHigh, tight, notExtended];

      const volLabels = ['RelVol > 1.1', 'Vol dry-up', 'Momentum ↗'];
      const relVolOk = (r.relVol1w != null) ? r.relVol1w > 1.1 : null;
      const volDry = (typeof r.volContraction === 'boolean') ? r.volContraction : null;
      const accelerating = (r.perf1w != null && r.perf1m != null) ? (r.perf1w > 0 && r.perf1w > r.perf1m / 4) : null;
      const volChecks = [relVolOk, volDry, accelerating];

      const isFresh = (r.distFromHigh != null && r.distFromHigh >= -3 && (r.perf1w ?? 0) > 0);
      const isTightBase = (adrPctile != null && adrPctile <= 0.25);

      const cat = (arr: (boolean | null)[]) => ({
        pts: arr.filter(x => x === true).length,
        known: arr.filter(x => x !== null).length,
      });
      const T = cat(trendChecks);
      const RS = cat(rsChecks);
      const S = cat(setupChecks);
      const V = cat(volChecks);
      const totalPts = T.pts + RS.pts + S.pts + V.pts;
      const totalKnown = T.known + RS.known + S.known + V.known;

      // Build a plain-English "why" string — 2-3 highest signals
      const strengths: string[] = [];
      if (T.pts === 3) strengths.push('perfect trend');
      else if (stage2 === true) strengths.push('Stage 2');
      if (RS.pts === 3) strengths.push('elite RS');
      else if (rs1y === true) strengths.push('top-RS 1Y');
      if (S.pts === 3) strengths.push('tight setup');
      else if (nearHigh === true && tight === true) strengths.push('near-high tight base');
      else if (nearHigh === true) strengths.push('near 52w high');
      else if (tight === true) strengths.push('tight base');
      if (V.pts === 3) strengths.push('strong volume signal');
      else if (relVolOk === true) strengths.push('volume expanding');
      else if (volDry === true) strengths.push('vol dry-up');
      if (isFresh) strengths.push('fresh breakout');

      const weaknesses: string[] = [];
      if (T.pts === 0 && T.known > 0) weaknesses.push('no trend');
      if (RS.pts === 0 && RS.known > 0) weaknesses.push('lagging RS');
      if (V.pts === 0 && V.known > 0) weaknesses.push('no volume');
      if (S.pts === 0 && S.known > 0) weaknesses.push('poor setup');

      const rsRank = p1y == null ? null : Math.round(p1y * 100);

      return {
        r, T, RS, S, V, totalPts, totalKnown,
        p1y, p3m, p1w, adrPctile, rsRank,
        isFresh, isTightBase,
        strengths, weaknesses,
        trendChecks, trendLabels, rsChecks, rsLabels, setupChecks, setupLabels, volChecks, volLabels,
      };
    }).filter(x => x.totalKnown >= 6);
  }, [universe, perf1ySorted, perf3mSorted, perf1wSorted, adrSorted, pct]);

  const filtered = React.useMemo(() => {
    let arr = [...scored];
    if (filter === 'elite') arr = arr.filter(x => x.totalPts >= 10);
    if (filter === 'fresh') arr = arr.filter(x => x.isFresh);
    if (filter === 'tight') arr = arr.filter(x => x.isTightBase);
    switch (sortBy) {
      case 'perf1y':  arr.sort((a, b) => (b.r.perf1y ?? -99) - (a.r.perf1y ?? -99)); break;
      case 'perf3m':  arr.sort((a, b) => (b.r.perf3m ?? -99) - (a.r.perf3m ?? -99)); break;
      case 'perf1w':  arr.sort((a, b) => (b.r.perf1w ?? -99) - (a.r.perf1w ?? -99)); break;
      case 'rsRank':  arr.sort((a, b) => (b.rsRank ?? -1) - (a.rsRank ?? -1)); break;
      case 'distHigh': arr.sort((a, b) => (b.r.distFromHigh ?? -99) - (a.r.distFromHigh ?? -99)); break;
      default: arr.sort((a, b) => b.totalPts - a.totalPts || (b.p1y ?? 0) - (a.p1y ?? 0));
    }
    return arr;
  }, [scored, filter, sortBy]);

  const eliteCount = scored.filter(x => x.totalPts >= 10).length;
  const goodCount = scored.filter(x => x.totalPts >= 7 && x.totalPts < 10).length;
  const okCount = scored.filter(x => x.totalPts >= 4 && x.totalPts < 7).length;
  const freshCount = scored.filter(x => x.isFresh).length;
  const tightCount = scored.filter(x => x.isTightBase).length;
  const showTop = Math.min(filtered.length, 40);

  // ── zzz206: SEPA EXPORT — curated buckets, deduped in priority order ──────
  type SepaBucket = 'ELITE' | 'GOOD' | 'FRESH' | 'TIGHT';
  const sepaPicks = React.useMemo(() => {
    const seen = new Set<string>();
    const out: { row: (typeof scored)[number]; bucket: SepaBucket }[] = [];
    const add = (rows: typeof scored, bucket: SepaBucket) => {
      for (const x of rows) {
        const sym = x.r.symbol || x.r.ticker;
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        out.push({ row: x, bucket });
      }
    };
    const bySc = [...scored].sort((a, b) => b.totalPts - a.totalPts || (b.p1y ?? 0) - (a.p1y ?? 0));
    add(bySc.filter(x => x.totalPts >= 10), 'ELITE');
    add(bySc.filter(x => x.totalPts >= 7 && x.totalPts < 10), 'GOOD');
    add(bySc.filter(x => x.isFresh && x.totalPts >= 6), 'FRESH');
    add(bySc.filter(x => x.isTightBase && x.totalPts >= 6), 'TIGHT');
    return out;
  }, [scored]);

  const tvSym = (r: any): string => {
    const ex = (r.exchange || '').toUpperCase().trim();
    const sym = r.symbol || r.ticker || '';
    if (!ex || !sym) return sym;
    const map: Record<string, string> = { NMS: 'NASDAQ', NASDAQGS: 'NASDAQ', ARCA: 'AMEX', BATS: 'AMEX' };
    return `${map[ex] || ex}:${sym}`;
  };
  // zzz211 — report Elite+Good picks up to TechnicalsTab for the master
  // "Copy ALL BEST" button.
  React.useEffect(() => {
    if (!onBest) return;
    onBest(sepaPicks.filter(p => p.bucket === 'ELITE' || p.bucket === 'GOOD').map(p => tvSym(p.row.r)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sepaPicks]);

  const sepaFormatTV = (picks: typeof sepaPicks): string => {
    const sections: Record<SepaBucket, string[]> = { ELITE: [], GOOD: [], FRESH: [], TIGHT: [] };
    picks.forEach(p => { sections[p.bucket].push(tvSym(p.row.r)); });
    const out: string[] = [];
    if (sections.ELITE.length) { out.push('###SEPA Elite 10+'); out.push(...sections.ELITE); }
    if (sections.GOOD.length) { out.push('###SEPA Good 7-9'); out.push(...sections.GOOD); }
    if (sections.FRESH.length) { out.push('###Fresh Breakouts'); out.push(...sections.FRESH); }
    if (sections.TIGHT.length) { out.push('###Tight Bases'); out.push(...sections.TIGHT); }
    return out.join(',');
  };
  const sepaFormatPlain = (picks: typeof sepaPicks): string => picks.map(p => tvSym(p.row.r)).join(',');
  const sepaFormatNewline = (picks: typeof sepaPicks): string => picks.map(p => tvSym(p.row.r)).join('\n');
  const sepaFormatCsv = (picks: typeof sepaPicks): string => {
    const headers = 'Symbol,Exchange,Bucket,Score,Trend,RelStr,Setup,Volume,RSRank,Price,1W%,1M%,3M%,1Y%,From52wH%,Fresh,TightBase,Why';
    const rows = picks.map(p => {
      const x = p.row; const r = x.r;
      const why = x.strengths.slice(0, 3).join(' + ') || x.weaknesses.slice(0, 2).join(' + ');
      return [
        r.symbol || r.ticker || '', r.exchange || '', p.bucket,
        `${x.totalPts}/${x.totalKnown}`, `${x.T.pts}/${x.T.known}`, `${x.RS.pts}/${x.RS.known}`, `${x.S.pts}/${x.S.known}`, `${x.V.pts}/${x.V.known}`,
        x.rsRank ?? '', r.price ?? '',
        r.perf1w ?? '', r.perf1m ?? '', r.perf3m ?? '', r.perf1y ?? '', r.distFromHigh ?? '',
        x.isFresh ? 'Y' : '', x.isTightBase ? 'Y' : '', why,
      ].map(v => typeof v === 'string' && v.includes(',') ? `"${v}"` : String(v)).join(',');
    });
    return [headers, ...rows].join('\n');
  };

  const [sepaToast, setSepaToast] = React.useState<string>('');
  const sepaCopy = async (txt: string, label: string) => {
    try {
      await navigator.clipboard.writeText(txt);
      setSepaToast(`✓ Copied ${label}`);
      setTimeout(() => setSepaToast(''), 2500);
    } catch {
      setSepaToast('⚠️ Copy failed — select & copy manually');
      setTimeout(() => setSepaToast(''), 3500);
    }
  };
  const sepaDownload = (txt: string, filename: string, mime: string = 'text/plain') => {
    try {
      const blob = new Blob([txt], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {}
  };

  if (scored.length === 0) {
    return (
      <div style={{ background: PANEL, border: `1px solid ${LINE}`, borderRadius: 12, padding: 18, marginBottom: 20 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: TXT }}>🏆 Winning Playbook — SEPA checklist score</div>
        <div style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>Upload a TradingView CSV with SMA/EMA columns to see stocks scored against Minervini&apos;s Trend Template.</div>
      </div>
    );
  }

  const chipBtn = (key: string, label: string, count: number, color: string, active: boolean) => (
    <button key={key} onClick={() => setFilter(active ? 'all' as any : key as any)}
      style={{
        background: active ? `${color}25` : PANEL2, border: `1px solid ${active ? color : LINE2}`,
        color: active ? color : MUTED, padding: '6px 14px', borderRadius: 999,
        fontSize: 12.5, fontWeight: 700, cursor: 'pointer',
      }}>
      {label}: <b style={{ color: active ? color : TXT }}>{count}</b>
    </button>
  );

  const sortableTh = (key: string, label: string, align: 'left' | 'right' | 'center' = 'left', color = MUTED) => (
    <th style={{ textAlign: align, padding: '12px 10px', color: sortBy === key ? CYAN : color, cursor: 'pointer', userSelect: 'none', fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', whiteSpace: 'nowrap' }}
        onClick={() => setSortBy(key as any)}>
      {label}{sortBy === key ? ' ↓' : ''}
    </th>
  );

  // zzz206: sub-checks now STACKED one per line (bigger, instantly scannable)
  const CatCell = ({ pts, known, checks, labels, color }: { pts: number; known: number; checks: (boolean | null)[]; labels: string[]; color: string }) => {
    const perfect = pts === known && known > 0;
    return (
      <td style={{ padding: '10px 8px', textAlign: 'center', minWidth: 116, verticalAlign: 'top' }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: perfect ? color : pts >= 2 ? AMBER : pts >= 1 ? MUTED : RED, marginBottom: 4 }}>
          {pts}/{known}
        </div>
        <div style={{ fontSize: 10.5, lineHeight: 1.55, textAlign: 'left', display: 'inline-block' }}>
          {labels.map((lbl, i) => (
            <span key={i} style={{ display: 'block', whiteSpace: 'nowrap', opacity: checks[i] === true ? 1 : checks[i] === false ? 0.45 : 0.18 }}>
              <span style={{ color: checks[i] === true ? color : checks[i] === false ? RED : MUTED, fontWeight: 800 }}>{checks[i] === true ? '✓' : checks[i] === false ? '✗' : '·'}</span>
              <span style={{ color: checks[i] === true ? TXT : MUTED, marginLeft: 4 }}>{lbl}</span>
            </span>
          ))}
        </div>
      </td>
    );
  };

  return (
    <div style={{ background: `linear-gradient(180deg, ${CYAN}0F 0%, ${PANEL} 60%)`, border: `1px solid ${CYAN}66`, borderRadius: 14, padding: 22, marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 900, color: TXT, letterSpacing: 0.2 }}>
            🏆 Winning Playbook · SEPA score
            <a href="/winning-playbook" style={{ marginLeft: 12, fontSize: 12.5, color: CYAN, textDecoration: 'none', fontWeight: 700 }}>[full rules →]</a>
          </div>
          <div style={{ fontSize: 13, color: MUTED, marginTop: 5, lineHeight: 1.55, maxWidth: 980 }}>
            Every stock scored 0-12 across 4 categories (below). Higher = closer to a textbook Minervini setup. Sort by clicking any column header. Filter with the chips.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          {chipBtn('elite', '🥇 Elite (10+)', eliteCount, GREEN, filter === 'elite')}
          <span style={{ background: PANEL2, border: `1px solid ${LINE2}`, color: MUTED, padding: '6px 14px', borderRadius: 999, fontSize: 12.5 }}>
            🥈 Good (7-9): <b style={{ color: TXT }}>{goodCount}</b>
          </span>
          <span style={{ background: PANEL2, border: `1px solid ${LINE2}`, color: MUTED, padding: '6px 14px', borderRadius: 999, fontSize: 12.5 }}>
            OK (4-6): <b style={{ color: TXT }}>{okCount}</b>
          </span>
          {chipBtn('fresh', '🚀 Fresh breakout', freshCount, CYAN, filter === 'fresh')}
          {chipBtn('tight', '🎯 Tight base', tightCount, VIOLET, filter === 'tight')}
        </div>
      </div>

      {/* zzz205: ALWAYS-VISIBLE CATEGORY LEGEND (zzz206: upsized) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10, marginBottom: 16 }}>
        <div style={{ background: PANEL2, border: `1px solid ${CYAN}44`, borderLeft: `4px solid ${CYAN}`, padding: '12px 14px', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: CYAN }}>🔷 TREND (3 pts)</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.55 }}>
            Stage 2 uptrend confirmed · full 50 &gt; 150 &gt; 200 stack · price above 21-EMA.
          </div>
        </div>
        <div style={{ background: PANEL2, border: `1px solid ${VIOLET}44`, borderLeft: `4px solid ${VIOLET}`, padding: '12px 14px', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: VIOLET }}>🟣 REL STR (3 pts)</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.55 }}>
            1-year return in top 20% of your CSV · 3-month in top 25% · 1-week positive AND top half.
          </div>
        </div>
        <div style={{ background: PANEL2, border: `1px solid ${AMBER}44`, borderLeft: `4px solid ${AMBER}`, padding: '12px 14px', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: AMBER }}>🟡 SETUP (3 pts)</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.55 }}>
            Within 15% of 52-week high · tight base (ADR% in bottom 40%) · not extended (RSI &lt; 80).
          </div>
        </div>
        <div style={{ background: PANEL2, border: `1px solid ${BLUE}44`, borderLeft: `4px solid ${BLUE}`, padding: '12px 14px', borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: BLUE }}>🔵 VOLUME (3 pts)</div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 4, lineHeight: 1.55 }}>
            Recent volume &gt; 1.1× avg · volume dry-up in the base · momentum accelerating (1W &gt; 1M / 4).
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto', border: `1px solid ${LINE}`, borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: `2px solid ${LINE2}`, background: PANEL2 }}>
              <th style={{ textAlign: 'left', padding: '12px 10px', color: MUTED, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>#</th>
              <th style={{ textAlign: 'left', padding: '12px 10px', color: MUTED, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>Ticker</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', color: MUTED, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>Price</th>
              <th style={{ textAlign: 'right', padding: '12px 10px', color: MUTED, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>Perf (1Y · 3M · 1W)</th>
              {sortableTh('distHigh', 'From 52wH', 'right')}
              {sortableTh('rsRank', 'RS Rank', 'right')}
              <th style={{ textAlign: 'center', padding: '12px 8px', color: CYAN, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderLeft: `2px solid ${LINE2}` }}>TREND</th>
              <th style={{ textAlign: 'center', padding: '12px 8px', color: VIOLET, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>REL STR</th>
              <th style={{ textAlign: 'center', padding: '12px 8px', color: AMBER, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>SETUP</th>
              <th style={{ textAlign: 'center', padding: '12px 8px', color: BLUE, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>VOLUME</th>
              <th style={{ textAlign: 'left', padding: '12px 10px', color: MUTED, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase', borderLeft: `2px solid ${LINE2}` }}>Why?</th>
              <th style={{ textAlign: 'center', padding: '12px 10px', color: MUTED, fontSize: 12, fontWeight: 800, letterSpacing: 0.5, textTransform: 'uppercase' }}>Tags</th>
              {sortableTh('score', 'Score', 'right')}
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, showTop).map((row, i) => {
              const r = row.r;
              const total = row.totalPts;
              const scoreColor = total >= 10 ? GREEN : total >= 7 ? AMBER : total >= 4 ? CYAN : MUTED;
              const whyText = row.strengths.length > 0
                ? row.strengths.slice(0, 2).join(' · ')
                : row.weaknesses.length > 0
                  ? row.weaknesses.slice(0, 2).join(' · ')
                  : '—';
              const zebra = i % 2 === 1 ? 'rgba(255,255,255,0.02)' : 'transparent';
              return (
                <tr key={r.symbol || i}
                  onClick={() => onOpen && (r.symbol || r.ticker) && onOpen(r.symbol || r.ticker)}
                  title="Click for full detail — technicals + fundamentals + position sizing"
                  style={{ borderBottom: `1px solid ${LINE}`, background: total >= 10 ? `${GREEN}0F` : zebra, cursor: onOpen ? 'pointer' : 'default' }}>
                  <td style={{ padding: '10px', color: i < 3 ? AMBER : MUTED, fontWeight: i < 3 ? 800 : 400, fontSize: 13 }}>{i + 1}</td>
                  <td style={{ padding: '10px', verticalAlign: 'top' }}>
                    <div style={{ color: TXT, fontWeight: 800, fontSize: 14.5 }}>{r.symbol || r.ticker || '—'}</div>
                    {r.exchange ? <div style={{ color: MUTED, fontSize: 10, marginTop: 2, letterSpacing: 0.5 }}>{String(r.exchange).toUpperCase()}</div> : null}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', color: TXT, fontVariantNumeric: 'tabular-nums', fontSize: 13.5, fontWeight: 600 }}>{r.price != null ? r.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</td>
                  <td style={{ padding: '10px', textAlign: 'right', color: TXT, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontSize: 13 }}>
                    <span style={{ color: (r.perf1y ?? 0) >= 0 ? GREEN : RED, fontWeight: 700 }}>{r.perf1y != null ? (r.perf1y > 0 ? '+' : '') + r.perf1y.toFixed(0) + '%' : '—'}</span>
                    <span style={{ color: MUTED, margin: '0 5px' }}>·</span>
                    <span style={{ color: (r.perf3m ?? 0) >= 0 ? GREEN : RED }}>{r.perf3m != null ? (r.perf3m > 0 ? '+' : '') + r.perf3m.toFixed(0) + '%' : '—'}</span>
                    <span style={{ color: MUTED, margin: '0 5px' }}>·</span>
                    <span style={{ color: (r.perf1w ?? 0) >= 0 ? GREEN : RED }}>{r.perf1w != null ? (r.perf1w > 0 ? '+' : '') + r.perf1w.toFixed(1) + '%' : '—'}</span>
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right', fontSize: 13, fontWeight: 600, color: (r.distFromHigh ?? 0) >= -5 ? GREEN : (r.distFromHigh ?? 0) >= -15 ? AMBER : RED }}>{r.distFromHigh != null ? r.distFromHigh.toFixed(0) + '%' : '—'}</td>
                  <td style={{ padding: '10px', textAlign: 'right', fontSize: 14, color: (row.rsRank ?? 0) >= 80 ? GREEN : (row.rsRank ?? 0) >= 50 ? AMBER : MUTED, fontWeight: 800 }}>
                    {row.rsRank != null ? row.rsRank : '—'}
                  </td>
                  <CatCell pts={row.T.pts} known={row.T.known} checks={row.trendChecks} labels={row.trendLabels} color={CYAN} />
                  <CatCell pts={row.RS.pts} known={row.RS.known} checks={row.rsChecks} labels={row.rsLabels} color={VIOLET} />
                  <CatCell pts={row.S.pts} known={row.S.known} checks={row.setupChecks} labels={row.setupLabels} color={AMBER} />
                  <CatCell pts={row.V.pts} known={row.V.known} checks={row.volChecks} labels={row.volLabels} color={BLUE} />
                  <td style={{ padding: '10px', color: row.strengths.length ? TXT : RED, fontSize: 12.5, lineHeight: 1.45, borderLeft: `2px solid ${LINE2}`, maxWidth: 190 }}>{whyText}</td>
                  <td style={{ padding: '10px', textAlign: 'center', fontSize: 16, whiteSpace: 'nowrap' }}>
                    {row.isFresh && <span title="Fresh breakout: within 3% of 52-week high AND up this week" style={{ color: CYAN, marginRight: 4 }}>🚀</span>}
                    {row.isTightBase && <span title="Tight base: ADR% in bottom 25% of the universe" style={{ color: VIOLET }}>🎯</span>}
                  </td>
                  <td style={{ padding: '10px', textAlign: 'right' }}>
                    <span style={{ display: 'inline-block', background: `${scoreColor}1F`, border: `1px solid ${scoreColor}55`, color: scoreColor, fontWeight: 900, fontSize: 15.5, padding: '4px 10px', borderRadius: 8, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                      {total}/{row.totalKnown}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filtered.length > showTop && (
        <div style={{ fontSize: 12.5, color: MUTED, marginTop: 10, fontStyle: 'italic' }}>
          Showing top {showTop} of {filtered.length} filtered stocks · click column headers to sort · click chips at the top to filter.
        </div>
      )}

      {/* zzz206: EXPORT BEST SEPA PICKS — TradingView / clipboard / files */}
      <div style={{ marginTop: 16, padding: '14px 16px', background: PANEL2, border: `1px solid ${CYAN}33`, borderRadius: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: CYAN }}>📤 EXPORT SEPA PICKS</div>
          <span style={{ background: 'rgba(34,211,238,0.15)', padding: '4px 10px', borderRadius: 6, fontSize: 12.5, color: CYAN, fontWeight: 700 }}>
            {sepaPicks.length} picks
          </span>
          {(['ELITE', 'GOOD', 'FRESH', 'TIGHT'] as SepaBucket[]).map(b => {
            const n = sepaPicks.filter(p => p.bucket === b).length;
            if (!n) return null;
            const meta: Record<SepaBucket, [string, string]> = {
              ELITE: ['🥇 Elite 10+', GREEN], GOOD: ['🥈 Good 7-9', AMBER], FRESH: ['🚀 Fresh', CYAN], TIGHT: ['🎯 Tight', VIOLET],
            };
            return (
              <span key={b} style={{ background: `${meta[b][1]}22`, padding: '4px 9px', borderRadius: 5, fontSize: 12, color: meta[b][1], fontWeight: 700 }}>
                {meta[b][0]} {n}
              </span>
            );
          })}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: MUTED, fontStyle: 'italic' }}>
            Elite (10+) + Good (7-9) + Fresh breakouts + Tight bases (score ≥ 6), deduped in that order.
          </span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
          <button onClick={() => sepaCopy(sepaFormatTV(sepaPicks), 'TradingView format (with sections)')}
            disabled={sepaPicks.length === 0}
            style={{ background: sepaPicks.length ? CYAN : '#1A2540', color: sepaPicks.length ? '#0B1220' : MUTED, border: 'none', padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 800, cursor: sepaPicks.length ? 'pointer' : 'not-allowed' }}>
            📋 Copy for TradingView (with sections)
          </button>
          <button onClick={() => sepaCopy(sepaFormatPlain(sepaPicks), 'plain ticker list')}
            disabled={sepaPicks.length === 0}
            style={{ background: PANEL, color: TXT, border: `1px solid ${LINE2}`, padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: sepaPicks.length ? 'pointer' : 'not-allowed' }}>
            Copy comma list
          </button>
          <button onClick={() => sepaDownload(sepaFormatNewline(sepaPicks), `mc-sepa-picks-${new Date().toISOString().slice(0, 10)}.txt`)}
            disabled={sepaPicks.length === 0}
            style={{ background: PANEL, color: TXT, border: `1px solid ${LINE2}`, padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: sepaPicks.length ? 'pointer' : 'not-allowed' }}>
            ⬇ Download .txt
          </button>
          <button onClick={() => sepaDownload(sepaFormatCsv(sepaPicks), `mc-sepa-picks-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv')}
            disabled={sepaPicks.length === 0}
            style={{ background: PANEL, color: TXT, border: `1px solid ${LINE2}`, padding: '8px 14px', borderRadius: 6, fontSize: 12.5, fontWeight: 700, cursor: sepaPicks.length ? 'pointer' : 'not-allowed' }}>
            ⬇ Download CSV (full data)
          </button>
          {(['ELITE', 'GOOD', 'FRESH', 'TIGHT'] as SepaBucket[]).map(b => {
            const subset = sepaPicks.filter(p => p.bucket === b);
            if (!subset.length) return null;
            const labels: Record<SepaBucket, string> = { ELITE: '🥇 Elite', GOOD: '🥈 Good', FRESH: '🚀 Fresh', TIGHT: '🎯 Tight' };
            return (
              <button key={b} onClick={() => sepaCopy(sepaFormatPlain(subset), `${labels[b]} (${subset.length})`)}
                style={{ background: 'transparent', border: `1px solid ${LINE2}`, color: TXT, padding: '8px 12px', borderRadius: 6, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                Copy {labels[b]} <span style={{ color: MUTED, fontWeight: 500 }}>({subset.length})</span>
              </button>
            );
          })}
          {sepaToast && (
            <span style={{ background: sepaToast.startsWith('✓') ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)', color: sepaToast.startsWith('✓') ? GREEN : RED, padding: '8px 12px', borderRadius: 6, fontSize: 12.5, fontWeight: 700 }}>
              {sepaToast}
            </span>
          )}
        </div>
        {sepaPicks.length > 0 && (
          <div style={{ marginTop: 10, padding: 10, background: PANEL, borderRadius: 6, fontSize: 11.5, color: TXT, fontFamily: 'ui-monospace, monospace', lineHeight: 1.9, maxHeight: 110, overflowY: 'auto' }}>
            {sepaPicks.map(p => {
              const bColor = p.bucket === 'ELITE' ? GREEN : p.bucket === 'GOOD' ? AMBER : p.bucket === 'FRESH' ? CYAN : VIOLET;
              const sym = p.row.r.symbol || p.row.r.ticker;
              return (
                <span key={sym} style={{ display: 'inline-block', marginRight: 8, padding: '2px 7px', background: 'rgba(255,255,255,0.04)', borderRadius: 4, borderLeft: `2px solid ${bColor}` }}>
                  <b style={{ color: CYAN }}>{sym}</b> <span style={{ color: bColor, fontSize: 10.5 }}>{p.bucket[0]}</span> <span style={{ color: MUTED, fontSize: 10.5 }}>{p.row.totalPts}/{p.row.totalKnown}</span>
                </span>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ fontSize: 12.5, color: MUTED, marginTop: 14, padding: '12px 14px', background: PANEL2, borderRadius: 8, lineHeight: 1.7 }}>
        <b style={{ color: TXT }}>How to read this.</b>{' '}
        Each of the 4 category cells shows the score (e.g. <b>3/3</b>) plus the specific checks that passed / failed below (✓ / ✗).
        The <b>Why?</b> column summarizes the 2 strongest signals in plain English.
        A <b>10+/12</b> stock passes almost every measurable Minervini/CANSLIM rule — but you still need to verify the manual items: new product / new management / new industry cycle, small float, industry leader, institutional buying (see the &quot;5-layer engine&quot; block below and Portfolio Fundamentals).
        Click a ticker in the Champions / Buy Zone cards further down to see full technicals + fundamentals + position sizing.
      </div>
    </div>
  );
}
