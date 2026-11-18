'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { type NewTabKey } from './types';
import { baselineDay, recordTickerDay, type TickerHistory } from './ticker-history';

const NEW_WINDOW_DAYS = 7;
function _newLoad(k, fallback) {
  if (typeof window === 'undefined') return fallback;
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function _newSave(k, v) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}
function _newRecordFirstSeen(tab: NewTabKey, tickers: string[]) {
  const key = `mb_new_v1_${tab}_firstseen`;
  const initKey = `mb_new_v1_${tab}_initialized`;
  const cur = _newLoad(key, {}) as Record<string,string>;
  const now = new Date().toISOString();
  let changed = false;
  const isFirstEver = typeof window !== 'undefined' && !localStorage.getItem(initKey);
  for (const t of tickers) { if (t && !cur[t]) { cur[t] = now; changed = true; } }
  if (changed) _newSave(key, cur);
  if (isFirstEver && tickers.length > 0) {
    try {
      const seenKey = `mb_new_v1_${tab}_seen`;
      const existingSeen = _newLoad(seenKey, []) as string[];
      const seenSet = new Set(existingSeen);
      for (const t of tickers) if (t) seenSet.add(t);
      _newSave(seenKey, Array.from(seenSet));
      localStorage.setItem(initKey, new Date().toISOString());
    } catch {}
  }
  return cur;
}
function _newIsNew(ticker: string, firstSeenMap: Record<string,string>, ackSet: Set<string>) {
  if (!ticker || ackSet.has(ticker)) return false;
  const fs = firstSeenMap[ticker]; if (!fs) return false;
  return (Date.now() - new Date(fs).getTime()) / 86400000 <= NEW_WINDOW_DAYS;
}
export function useNewTracker(tab: NewTabKey, allTickers: string[]) {
  const [tick, setTick] = React.useState(0);
  const firstSeenMap = React.useMemo(() => _newRecordFirstSeen(tab, allTickers), [tab, allTickers.length, tick]);
  const ackSet = React.useMemo(() => new Set(_newLoad(`mb_new_v1_${tab}_seen`, []) as string[]), [tab, tick]);
  const newTickerSet = React.useMemo(() => {
    const s = new Set<string>();
    for (const t of allTickers) if (_newIsNew(t, firstSeenMap, ackSet)) s.add(t);
    return s;
  }, [allTickers.length, firstSeenMap, ackSet]);
  const toggleAck = React.useCallback((ticker: string) => {
    const key = `mb_new_v1_${tab}_seen`;
    const cur = _newLoad(key, []) as string[];
    const idx = cur.indexOf(ticker); if (idx >= 0) cur.splice(idx, 1); else cur.push(ticker);
    _newSave(key, cur); setTick(x => x + 1);
  }, [tab]);
  return { newTickerSet, ackSet, toggleAck };
}
export function NewSeenCheckbox({ isNew, isAcked, onToggle }: { isNew: boolean; isAcked: boolean; onToggle: () => void }) {
  // zzz180: disabled - badges cluttered the UI. Replaced with a compact "Recently Added" panel.
  return null;
  // Legacy body (unused):
  if (!isNew) return null;
  return (
    <button onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggle(); }}
      title="Mark as seen (removes badge)"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', fontSize: 10, fontWeight: 700,
        border: '1px solid #22D3EE',
        background: 'color-mix(in srgb, #22D3EE 15%, transparent)',
        color: '#22D3EE', borderRadius: 4, cursor: 'pointer', lineHeight: 1 }}
    >🆕 NEW</button>
  );
}

// zzz182 - Recently Added: fetches ticker set from GitHub commit ~2 days ago, diffs to current.
function _raLoad<T>(k: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : fallback; } catch { return fallback; }
}
function _raSave(k: string, v: unknown) {
  if (typeof window === 'undefined') return;
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}
/** zzz1277 — "Recently added" compares today's list with this browser's own copy of the list from 2+ days ago (kept one
 *  per day, 10 days). It used to read the old TradingView CSVs committed to GitHub — those are no longer updated now the
 *  lists come from our own screener, so every name looked "new" or nothing did. Pure helpers exported for tests. */
function localHistory(tab: string, current: string[]): { set: Set<string> | null; day: string | null } {
  const key = 'mb_ticker_hist_v1_' + tab.replace(/\W/g, '_');
  const today = new Date().toISOString().slice(0, 10);
  const hist = _raLoad<TickerHistory>(key, {});
  const base = baselineDay(hist, today);
  _raSave(key, recordTickerDay(hist, today, current));
  return base ? { set: new Set(hist[base]), day: base } : { set: null, day: null };
}
export function RecentlyAddedPanel({ tab, tickers, marketLabel, dataFolder }: { tab: NewTabKey; tickers: string[]; marketLabel: string; dataFolder?: string }) {
  const currentUpper = React.useMemo(() => new Set(tickers.map(t => (t || '').split(':').pop()!.toUpperCase()).filter(Boolean)), [tickers]);
  const [historical, setHistorical] = React.useState<Set<string> | null>(null);
  const [baseDay, setBaseDay] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    if (!currentUpper.size) return;   // list not loaded yet — never record an empty day
    const h = localHistory(String(tab) + '_' + marketLabel, Array.from(currentUpper));   // one list per tab AND market
    setHistorical(h.set); setBaseDay(h.day); setLoading(false);
  }, [tab, marketLabel, currentUpper]);
  const added = React.useMemo(() => {
    if (!historical || historical.size === 0) return [] as string[];
    return Array.from(currentUpper).filter(t => t && !historical.has(t));
  }, [currentUpper, historical]);
  return (
    <div style={{ margin: '12px 0', padding: '10px 14px', backgroundColor: '#0f172a', border: '1px solid #1e293b', borderRadius: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: added.length > 0 ? 8 : 0 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: '#22D3EE' }}>&#128225; Recently Added ({loading ? '…' : added.length})</span>
        <span style={{ fontSize: 11, color: '#64748b' }}>{marketLabel} &middot; {baseDay ? `new since ${baseDay} (this browser's copy of the list)` : 'list kept from today — new names show from the day after tomorrow'}</span>
      </div>
      {loading && (
        <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>Waiting for the list…</span>
      )}
      {!loading && added.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {added.map(t => (
            <span key={t} style={{ fontSize: 12, fontWeight: 800, padding: '3px 9px', borderRadius: 4, background: 'color-mix(in srgb, #22D3EE 15%, transparent)', color: '#22D3EE', border: '1px solid #22D3EE60', fontFamily: 'ui-monospace, monospace' }}>{t}</span>
          ))}
        </div>
      )}
      {!loading && historical && added.length === 0 && (
        <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>No new names since that day.</span>
      )}
      {!loading && !historical && (
        <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>First visit on this browser — today's list is kept and compared from the next visit on another day.</span>
      )}
    </div>
  );
}
