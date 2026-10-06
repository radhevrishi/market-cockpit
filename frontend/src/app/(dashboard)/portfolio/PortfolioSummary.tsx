'use client';
// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useState } from 'react';
import { Plus, Trash2, Edit3, Check, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { isPricedRow, unpricedNote } from '@/lib/book-totals';
import { INCEPTION_CAPITAL_KEY, DEFAULT_INCEPTION_CAPITAL, INCEPTION_DATE_KEY, DEFAULT_INCEPTION_DATE } from './constants';
import { loadCashPositions, saveCashPositions, computePortfolioCagr, topSector, fmt, fmtPct } from './helpers';
import { type PortfolioRow, type PortfolioHolding, type CashPosition } from './types';

export function PortfolioSummary({ rows, holdings }: { rows: PortfolioRow[]; holdings: PortfolioHolding[] }) {
  // Hooks must run unconditionally — keep them above the empty-rows guard.
  const [inceptionCapital, setInceptionCapital] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(INCEPTION_CAPITAL_KEY);
      const n = saved ? parseFloat(saved) : NaN;
      return isFinite(n) && n > 0 ? n : DEFAULT_INCEPTION_CAPITAL;
    } catch { return DEFAULT_INCEPTION_CAPITAL; }
  });
  const [inceptionDate, setInceptionDate] = useState<string>(() => {
    try { return localStorage.getItem(INCEPTION_DATE_KEY) || DEFAULT_INCEPTION_DATE; }
    catch { return DEFAULT_INCEPTION_DATE; }
  });
  const [editingInception, setEditingInception] = useState(false);
  const [tmpCapital, setTmpCapital] = useState<string>(String(inceptionCapital));
  const [tmpDate, setTmpDate] = useState<string>(inceptionDate);

  const saveInception = () => {
    const n = parseFloat(tmpCapital);
    if (!isFinite(n) || n <= 0) { toast.error('Initial capital must be > 0'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tmpDate)) { toast.error('Date must be YYYY-MM-DD'); return; }
    setInceptionCapital(n);
    setInceptionDate(tmpDate);
    try {
      localStorage.setItem(INCEPTION_CAPITAL_KEY, String(n));
      localStorage.setItem(INCEPTION_DATE_KEY, tmpDate);
    } catch {}
    setEditingInception(false);
    toast.success('Inception updated');
  };
  const cancelInception = () => {
    setTmpCapital(String(inceptionCapital));
    setTmpDate(inceptionDate);
    setEditingInception(false);
  };

  // PATCH 1101zzz10 — Cash positions state.
  const [cashPositions, setCashPositions] = useState<CashPosition[]>(() => loadCashPositions());
  const [addingCash, setAddingCash] = useState(false);
  const [newCashLabel, setNewCashLabel] = useState('');
  const [newCashAmount, setNewCashAmount] = useState('');

  const persistCash = (next: CashPosition[]) => {
    setCashPositions(next);
    saveCashPositions(next);
  };
  const addCashPosition = () => {
    const label = newCashLabel.trim();
    const amount = parseFloat(newCashAmount);
    if (!label) { toast.error('Cash label required (e.g. Savings, Liquid Fund)'); return; }
    if (!isFinite(amount) || amount <= 0) { toast.error('Amount must be > 0'); return; }
    const pos: CashPosition = {
      id: `cash_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      label, amount, addedAt: new Date().toISOString(),
    };
    persistCash([...cashPositions, pos]);
    setNewCashLabel(''); setNewCashAmount(''); setAddingCash(false);
    toast.success(`Added cash position: ${label}`);
  };
  const removeCashPosition = (id: string) => {
    const pos = cashPositions.find(p => p.id === id);
    persistCash(cashPositions.filter(p => p.id !== id));
    if (pos) toast.success(`Removed ${pos.label}`);
  };
  const updateCashAmount = (id: string, amount: number) => {
    if (!isFinite(amount) || amount < 0) return;
    persistCash(cashPositions.map(p => p.id === id ? { ...p, amount } : p));
  };

  const totalCash = cashPositions.reduce((s, c) => s + c.amount, 0);

  if (rows.length === 0 && cashPositions.length === 0) return null;

  const totalInvested = rows.reduce((s, r) => s + r.investedValue, 0);
  // Holdings without a live price must not pretend zero P&L — aggregate only priced rows.
  const priced = rows.filter(r => isFinite(r.cmp) && r.cmp > 0);
  const pricedInvested = priced.reduce((s, r) => s + r.investedValue, 0);
  const totalCurrent = priced.reduce((s, r) => s + r.currentValue, 0);
  const totalPnl = totalCurrent - pricedInvested;
  const totalPnlPct = pricedInvested > 0 ? (totalPnl / pricedInvested) * 100 : 0;
  const dayPnl = rows.reduce((s, r) => s + r.dayPnl, 0);
  const gainers = rows.filter(r => r.cmp > 0 && r.pnl > 0).length;
  const losers = rows.filter(r => r.cmp > 0 && r.pnl < 0).length;
  const noData = rows.filter(r => !isPricedRow(r)).length; // zzz898: NaN / missing price counts too

  const best = priced.length >= 2 ? priced.reduce((a, b) => a.pnlPercent > b.pnlPercent ? a : b) : null;
  const worst = priced.length >= 2 ? priced.reduce((a, b) => a.pnlPercent < b.pnlPercent ? a : b) : null;
  const cagr = computePortfolioCagr(rows, holdings);
  const top = topSector(rows);

  // PATCH 1101zzz27 — Stale-feed guard. When the quote feed is temporarily
  // down (e.g. NSE refresh in progress, network blip), > 50% of holdings come
  // back with cmp=0. The naive calculation then reports TOTAL WEALTH = cash
  // only and Since-Inception drops to -97%, which looks catastrophic but is
  // just a refresh artifact. Detect that and fall back to last-good cached
  // numbers (only updated when priceCoverage >= 70%) so user sees their REAL
  // wealth with a "Refreshing prices..." indicator instead of red panic.
  const LAST_GOOD_KEY = 'mc_portfolio_last_good_summary_v1';
  const priceCoverage = rows.length > 0 ? priced.length / rows.length : 1;
  const feedIsStale = rows.length > 0 && priceCoverage < 0.5;
  type LastGoodSummary = {
    capturedAt: string;
    totalCurrent: number;
    totalPnl: number;
    totalPnlPct: number;
    dayPnl: number;
    gainersCount: number;
    losersCount: number;
  };
  let lastGood: LastGoodSummary | null = null;
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(LAST_GOOD_KEY) : null;
    if (raw) lastGood = JSON.parse(raw);
  } catch {}
  // Write fresh data to cache when feed is healthy.
  if (typeof window !== 'undefined' && rows.length > 0 && priceCoverage >= 0.7) {
    try {
      const next: LastGoodSummary = {
        capturedAt: new Date().toISOString(),
        totalCurrent, totalPnl, totalPnlPct, dayPnl,
        gainersCount: gainers, losersCount: losers,
      };
      localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(next));
    } catch {}
  }
  // Use last-good values when feed is stale; live values otherwise.
  const effectiveTotalCurrent = feedIsStale && lastGood?.totalCurrent ? lastGood.totalCurrent : totalCurrent;
  const effectiveTotalPnl = feedIsStale && lastGood?.totalPnl !== undefined ? lastGood.totalPnl : totalPnl;
  const effectiveTotalPnlPct = feedIsStale && lastGood?.totalPnlPct !== undefined ? lastGood.totalPnlPct : totalPnlPct;
  const effectiveDayPnl = feedIsStale && lastGood?.dayPnl !== undefined ? lastGood.dayPnl : dayPnl;
  const effectiveGainers = feedIsStale && lastGood?.gainersCount !== undefined ? lastGood.gainersCount : gainers;
  const effectiveLosers = feedIsStale && lastGood?.losersCount !== undefined ? lastGood.losersCount : losers;
  const showingStale = feedIsStale && !!lastGood;
  // PATCH 1101zzz35 — When feed is stale AND we have NO last-good cache
  // yet (first visit since deploy, or cache cleared), the Since-Inception
  // math falls through to totalWealth = cash only and reports a ~-97%
  // catastrophe even though the real portfolio is fine — we just haven't
  // loaded prices yet. Suppress ALL wealth-dependent cards entirely in
  // that window. They reappear automatically once either prices arrive
  // or a healthy refresh populates the cache.
  const noUsableWealthData = feedIsStale && !lastGood;

  // PATCH 1101zzz9 + zzz10 — TOTAL WEALTH = equity current + cash.
  const totalWealth = effectiveTotalCurrent + totalCash;
  const hasWealthData =
    !noUsableWealthData && (effectiveTotalCurrent > 0 || totalCash > 0);
  const inceptionMs = new Date(inceptionDate + 'T00:00:00Z').getTime();
  const yearsSince = isFinite(inceptionMs)
    ? (Date.now() - inceptionMs) / (365.25 * 24 * 3600 * 1000)
    : NaN;
  const sinceInceptionGain = hasWealthData ? totalWealth - inceptionCapital : NaN;
  const sinceInceptionPct = hasWealthData && inceptionCapital > 0
    ? ((totalWealth / inceptionCapital) - 1) * 100
    : NaN;
  const sinceInceptionCagr = hasWealthData && inceptionCapital > 0 && yearsSince >= 1 && totalWealth > 0
    ? (Math.pow(totalWealth / inceptionCapital, 1 / yearsSince) - 1) * 100
    : NaN;
  const yearsLabel = isFinite(yearsSince) && yearsSince > 0
    ? `${yearsSince.toFixed(1)}y · since ${new Date(inceptionDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`
    : 'set inception →';
  const equityPct = totalWealth > 0 ? (totalCurrent / totalWealth) * 100 : 0;
  const cashPct = totalWealth > 0 ? (totalCash / totalWealth) * 100 : 0;

  const cards = [
    // Since-inception cards lead — they're the user's primary "how am I doing overall" view.
    { label: 'INITIAL CAPITAL', value: fmt(inceptionCapital), sub: `deposited ${new Date(inceptionDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}`, color: '#F5F7FA' },
    ...(isFinite(sinceInceptionGain) ? [{
      label: 'TOTAL RETURN (since inception)',
      value: `${sinceInceptionGain < 0 ? '-' : ''}${fmt(Math.abs(sinceInceptionGain))} (${fmtPct(sinceInceptionPct)})`,
      sub: noData > 0 ? `${noData} unpriced · ${totalCash > 0 ? 'incl. cash · ' : ''}indicative` : (totalCash > 0 ? `incl. ${fmt(totalCash)} cash · ${yearsLabel}` : yearsLabel),
      color: sinceInceptionGain >= 0 ? '#10B981' : '#EF4444',
    }] : []),
    ...(isFinite(sinceInceptionCagr) ? [{
      label: 'CAGR (since inception)',
      value: fmtPct(sinceInceptionCagr),
      sub: totalCash > 0 ? `${yearsLabel} · incl. cash` : yearsLabel,
      color: sinceInceptionCagr >= 0 ? '#10B981' : '#EF4444',
    }] : []),
    // PATCH 1101zzz10 + zzz35 — TOTAL WEALTH = equities + cash. Suppress
    // when feed stale + no cache, so we don't show the misleading
    // "₹97K wealth on a ₹62L portfolio" snapshot.
    ...(totalCash > 0 && !noUsableWealthData ? [{
      label: 'TOTAL WEALTH',
      value: fmt(totalWealth),
      sub: `${equityPct.toFixed(0)}% equity · ${cashPct.toFixed(0)}% cash`,
      color: '#60A5FA',
    }] : []),
    ...(totalCash > 0 ? [{
      label: 'CASH BALANCE',
      value: fmt(totalCash),
      sub: cashPositions.length === 1 ? cashPositions[0].label : `${cashPositions.length} buckets`,
      color: '#FBBF24',
    }] : []),
    // PATCH 1101zzz35 — Refreshing placeholder card. When feed is stale
    // AND no last-good cache exists, surface a single explicit "loading"
    // card so the user sees WHY all wealth metrics are hidden, instead
    // of mistaking the suppression for missing portfolio data.
    ...(noUsableWealthData ? [{
      label: 'WEALTH (loading)',
      value: '🔄 …',
      sub: 'Prices loading — refresh manually or wait ~30s',
      color: '#FBBF24',
    }] : []),
    { label: 'INVESTED VALUE', value: fmt(totalInvested), color: '#F5F7FA' },
    { label: 'CURRENT VALUE (equity)',
      // PATCH 1101zzz27 — show last-good when feed stale, with refresh indicator.
      value: priced.length > 0 ? fmt(totalCurrent) : (showingStale && lastGood ? fmt(lastGood.totalCurrent) : '—'),
      sub: showingStale ? '🔄 refreshing prices…' : (noData > 0 ? unpricedNote(noData) : undefined), // zzz898
      color: '#F5F7FA',
    },
    priced.length > 0
      ? {
          label: 'TOTAL P&L',
          // PATCH 1101zzz11 — flag equity-only when cash exists so user
          // doesn't compare it to wealth-level numbers above.
          // PATCH 1101zzz27 — use effective values + stale indicator.
          // zzz378 — removed duplicate `value:` key (the totalPnl one was dead — JS
          // kept the effective* one below; TS1117). Effective values are intended.
          sub: showingStale ? '🔄 refreshing prices…' : ([totalCash > 0 ? 'equity only' : '', unpricedNote(noData)].filter(Boolean).join(' · ') || undefined), // zzz898
          value: `${effectiveTotalPnl < 0 ? '-' : ''}${fmt(Math.abs(effectiveTotalPnl))} (${fmtPct(effectiveTotalPnlPct)})`,
          color: effectiveTotalPnl >= 0 ? '#10B981' : '#EF4444',
        }
      : showingStale && lastGood
        ? {
            label: 'TOTAL P&L',
            value: `${lastGood.totalPnl < 0 ? '-' : ''}${fmt(Math.abs(lastGood.totalPnl))} (${fmtPct(lastGood.totalPnlPct)})`,
            sub: '🔄 refreshing prices…',
            color: lastGood.totalPnl >= 0 ? '#10B981' : '#EF4444',
          }
        : { label: 'TOTAL P&L', value: '—', sub: 'prices unavailable', color: '#F5F7FA' },
    // PATCH 1101zzz7 — Honest label: TOTAL RETURN when held <1y, CAGR when >=1y.
    // The number is the same compounded gain; the LABEL prevents the misread
    // that a 1.5-month +30% means a sustainable +1269% annual run-rate.
    // PATCH 1101zzz11 — sub-label honesty: cagr.years is computed from
    // holding.addedAt, which is "when added to the tracker", NOT the real
    // purchase date. A user importing a 4-year portfolio yesterday gets
    // years=0.0027 here. Rename to "since added to tracker" so the period
    // isn't misread as actual holding time.
    ...(cagr !== null
      ? (() => {
          const monthsTracked = cagr.years * 12;
          const periodLabel =
            monthsTracked < 1
              ? `~${(cagr.years * 365).toFixed(0)} days in tracker`
              : monthsTracked < 12
                ? `~${monthsTracked.toFixed(1)} months in tracker`
                : `${cagr.years.toFixed(1)}y in tracker`;
          return [{
            label: cagr.mode === 'TOTAL' ? 'WEIGHTED RETURN' : 'WEIGHTED CAGR',
            value: fmtPct(cagr.value),
            sub: cagr.mode === 'TOTAL' ? periodLabel : `${periodLabel} · per-holding`,
            color: cagr.value >= 0 ? '#10B981' : '#EF4444',
          }];
        })()
      : []),
    {
      label: 'DAY P&L',
      // PATCH 1101zzz27 — effective + stale indicator.
      value: `${effectiveDayPnl < 0 ? '-' : ''}${fmt(Math.abs(effectiveDayPnl))}`,
      sub: showingStale ? '🔄 refreshing prices…' : (totalCash > 0 ? 'equity only' : undefined),
      color: effectiveDayPnl >= 0 ? '#10B981' : '#EF4444',
    },
    { label: 'HOLDINGS',
      value: `${rows.length}`,
      // PATCH 1101zzz27 — show effective gainers/losers + refresh hint.
      sub: showingStale
        ? `🔄 refreshing prices… (${rows.length} held)`
        : `${effectiveGainers} ↑  ${effectiveLosers} ↓${noData > 0 ? `  ${noData} N/A` : ''}`,
      color: '#F5F7FA',
    },
    // PATCH 1101zzz11 — TOP SECTOR honest sub-label: "% of mapped" so user
    // sees that a chunk of the portfolio has no sector mapping. If <60%
    // of value has a real sector, also flag "low coverage" so the user
    // knows the leader is from a small base.
    ...(top ? [{
      label: 'TOP SECTOR',
      value: top.sector,
      sub: `${top.pct.toFixed(0)}% of total${top.mappedPct < 60 ? ` · ${top.mappedPct.toFixed(0)}% of holdings mapped` : ''}`,
      color: '#60A5FA',
    }] : []),
    { label: 'BEST PERFORMER', value: best ? best.symbol : '—', sub: best ? fmtPct(best.pnlPercent) : 'needs 2+ priced holdings', color: '#10B981' },
    { label: 'WORST PERFORMER', value: worst ? worst.symbol : '—', sub: worst ? fmtPct(worst.pnlPercent) : 'needs 2+ priced holdings', color: '#EF4444' },
  ];

  return (
    <>
      {/* Inception editor — collapsed by default, opens on click. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10,
        padding: '8px 12px', backgroundColor: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-2)', borderRadius: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--mc-text-3)', letterSpacing: '0.5px' }}>📍 INCEPTION:</span>
        {!editingInception ? (
          <>
            <span style={{ fontSize: 13, color: 'var(--mc-text-1)', fontWeight: 700 }}>
              {fmt(inceptionCapital)} · {new Date(inceptionDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
            </span>
            <button onClick={() => { setTmpCapital(String(inceptionCapital)); setTmpDate(inceptionDate); setEditingInception(true); }}
              style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: 'transparent', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-2)', cursor: 'pointer' }}>
              <Edit3 size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Edit
            </button>
          </>
        ) : (
          <>
            <label style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>Capital ₹</label>
            <input value={tmpCapital} onChange={e => setTmpCapital(e.target.value.replace(/[^\d.]/g, ''))}
              style={{ fontSize: 13, padding: '4px 8px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
                borderRadius: 5, color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, monospace', width: 130 }}
              placeholder="3540000" />
            <label style={{ fontSize: 11, color: 'var(--mc-text-3)' }}>Date</label>
            <input type="date" value={tmpDate} onChange={e => setTmpDate(e.target.value)}
              style={{ fontSize: 13, padding: '4px 8px', background: 'var(--mc-bg-1)', border: '1px solid var(--mc-border-2)',
                borderRadius: 5, color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, monospace' }} />
            <button onClick={saveInception}
              style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: '#10B981', border: 'none', color: 'white', cursor: 'pointer' }}>
              <Check size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Save
            </button>
            <button onClick={cancelInception}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: 'transparent', border: '1px solid var(--mc-border-2)', color: 'var(--mc-text-2)', cursor: 'pointer' }}>
              <X size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Cancel
            </button>
          </>
        )}
      </div>

      {/* PATCH 1101zzz10 — Cash positions bar. Mirrors the inception bar's
          visual language so the two read as a pair. List inline; add via
          the "+ Add Cash" button which expands two compact inputs. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16,
        padding: '8px 12px', backgroundColor: 'var(--mc-bg-2)',
        border: '1px solid var(--mc-border-2)', borderRadius: 8,
        flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24', letterSpacing: '0.5px' }}>💵 CASH:</span>
        {cashPositions.length === 0 && !addingCash && (
          <span style={{ fontSize: 12, color: 'var(--mc-text-3)' }}>none — track savings, liquid funds, FDs so wealth + CAGR include them</span>
        )}
        {cashPositions.map(c => (
          <span key={c.id} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700, color: 'var(--mc-text-1)',
            background: 'var(--mc-bg-1)', padding: '4px 8px', borderRadius: 5,
            border: '1px solid var(--mc-border-2)',
          }}>
            <span style={{ color: '#FBBF24' }}>{c.label}</span>
            <input
              type="number"
              value={c.amount}
              onChange={e => updateCashAmount(c.id, parseFloat(e.target.value) || 0)}
              style={{ width: 100, fontSize: 12, fontWeight: 700, padding: '2px 6px',
                background: 'var(--mc-bg-0)', border: '1px solid var(--mc-border-2)',
                borderRadius: 3, color: 'var(--mc-text-1)',
                fontFamily: 'ui-monospace, monospace' }}
              title={`Editable. Added ${new Date(c.addedAt).toLocaleDateString('en-IN')}`}
            />
            <button onClick={() => removeCashPosition(c.id)} title="Remove"
              style={{ background: 'transparent', border: 'none', color: '#EF4444',
                cursor: 'pointer', padding: 2, display: 'inline-flex', alignItems: 'center' }}>
              <Trash2 size={12} />
            </button>
          </span>
        ))}
        {addingCash ? (
          <>
            <input value={newCashLabel} onChange={e => setNewCashLabel(e.target.value)}
              placeholder="Label (Savings, Liquid Fund...)"
              style={{ fontSize: 12, padding: '4px 8px', background: 'var(--mc-bg-1)',
                border: '1px solid var(--mc-border-2)', borderRadius: 5,
                color: 'var(--mc-text-1)', width: 180 }} />
            <input value={newCashAmount} onChange={e => setNewCashAmount(e.target.value.replace(/[^\d.]/g, ''))}
              placeholder="Amount ₹"
              style={{ fontSize: 12, padding: '4px 8px', background: 'var(--mc-bg-1)',
                border: '1px solid var(--mc-border-2)', borderRadius: 5,
                color: 'var(--mc-text-1)', fontFamily: 'ui-monospace, monospace', width: 110 }} />
            <button onClick={addCashPosition}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: '#10B981', border: 'none', color: 'white', cursor: 'pointer' }}>
              <Check size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Save
            </button>
            <button onClick={() => { setAddingCash(false); setNewCashLabel(''); setNewCashAmount(''); }}
              style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
                background: 'transparent', border: '1px solid var(--mc-border-2)',
                color: 'var(--mc-text-2)', cursor: 'pointer' }}>
              <X size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Cancel
            </button>
          </>
        ) : (
          <button onClick={() => setAddingCash(true)}
            style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5,
              background: 'transparent', border: '1px solid #FBBF24', color: '#FBBF24', cursor: 'pointer' }}>
            <Plus size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />Add Cash
          </button>
        )}
        {!addingCash && cashPositions.length > 0 && (
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--mc-text-3)' }}>
            = {fmt(totalCash)}
          </span>
        )}
      </div>

      <div className="mc-grid-2-mobile" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', marginBottom: '20px' }}>
        {cards.map(c => (
          <div key={c.label} style={{ backgroundColor: 'var(--mc-bg-2)', border: '1px solid var(--mc-border-2)', borderRadius: '12px', padding: '16px' }}>
            <div style={{ fontSize: '10px', color: 'var(--mc-text-3)', marginBottom: '6px', fontWeight: '600', letterSpacing: '0.5px' }}>{c.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: c.color }}>{c.value}</div>
            {c.sub && <div style={{ fontSize: '11px', color: 'var(--mc-text-4)', marginTop: '2px' }}>{c.sub}</div>}
          </div>
        ))}
      </div>
    </>
  );
}
