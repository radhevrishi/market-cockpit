'use client';
// zzz1090 — the India / USA Technicals lists (Multibagger → India Technicals / USA Technicals tabs) as a company list for the Stock
// Screener and the Pine Screener. Source, in order:
//   1. what the Technicals tab shows in this browser (localStorage mb_tech_rows_ind_v1 / mb_tech_rows_usa_v1 — includes CSVs the
//      owner uploaded by hand);
//   2. when that is empty (the tab never opened here): the server's Technicals files (/api/v1/tv-data — the same files the tab
//      pulls), split by their Exchange column (NSE / BSE → India, everything else → USA).
import { normTicker } from './pine-handoff';
import type { ScreenMarket } from './types';

export const techRowsKey = (m: ScreenMarket) => `mb_tech_rows_${m === 'IN' ? 'ind' : 'usa'}_v1`;
export const TECH_LIST_LABEL: Record<ScreenMarket, string> = { IN: 'India Technicals list', US: 'USA Technicals list' };

export interface TechList { tickers: string[]; source: 'tab' | 'server' | 'none'; error?: string | null }

/** This browser's Technicals tab rows (symbols only). */
export function readTechListLocal(m: ScreenMarket): string[] {
  try {
    const raw = localStorage.getItem(techRowsKey(m));
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return Array.from(new Set(rows.map((r: any) => normTicker(r?.symbol ?? r?.Symbol ?? r?.ticker)).filter(Boolean)));
  } catch { return []; }
}

/** Minimal CSV line split (quoted fields with commas). */
export function csvCells(line: string): string[] {
  const out: string[] = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Symbols of one market from a Technicals CSV (Symbol + Exchange columns). */
export function techSymbolsFromCsv(text: string, m: ScreenMarket): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = csvCells(lines[0]).map((h) => h.trim().toLowerCase());
  const si = head.findIndex((h) => h === 'symbol' || h === 'ticker');
  const ei = head.indexOf('exchange');
  if (si < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(1)) {
    const c = csvCells(l);
    const ex = ei >= 0 ? String(c[ei] || '').trim().toUpperCase() : '';
    const isIn = ex === 'NSE' || ex === 'BSE';
    if ((m === 'IN') !== isIn) continue;
    const t = normTicker(c[si]);
    if (t) out.push(t);
  }
  return out;
}

/** The server's Technicals files for one market (used when the tab has nothing in this browser). */
export async function loadTechListServer(m: ScreenMarket, signal?: AbortSignal): Promise<TechList> {
  try {
    const r = await fetch('/api/v1/tv-data', { cache: 'no-store', signal });
    if (!r.ok) return { tickers: [], source: 'none', error: `the Technicals files could not be read (HTTP ${r.status})` };
    const man = await r.json();
    const files: any[] = Array.isArray(man?.files) ? man.files.filter((f: any) => f?.ok && f.kind !== 'watchlist') : [];
    const texts = await Promise.all(files.map((f) => fetch(`/api/v1/tv-data?file=${encodeURIComponent(f.name)}`, { cache: 'no-store', signal }).then((x) => (x.ok ? x.text() : '')).catch(() => '')));
    const set = new Set<string>();
    for (const t of texts) for (const s of techSymbolsFromCsv(t, m)) set.add(s);
    return { tickers: Array.from(set), source: set.size ? 'server' : 'none' };
  } catch (e: any) {
    return { tickers: [], source: 'none', error: String(e?.message || e) };
  }
}
