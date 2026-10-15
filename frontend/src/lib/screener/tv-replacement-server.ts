// zzz1048 — server side of the TradingView replacement (lib/screener/tv-replacement.ts): reads the Stock Screener snapshots
// from Postgres (kept 5 minutes in memory), runs each file's screens and writes the TradingView-shaped CSV.
//
// FALLBACK: when the snapshot a file needs is missing (database down, first build not finished), the old committed TradingView
// export in public/data/tradingview/ is served instead, and the manifest says so ("old TradingView export from <date>") — never
// silently. Server only (fs + database).

import { promises as fs } from 'fs';
import path from 'path';
import { getSnapshot, r40GuardedRows } from './snapshot-cache';
import { MemoLru, singleFlight } from '@/lib/server-memo';
import { ruleOf40Usable } from './pine';
import type { ScreenMarket, ScreenRow } from './types';
import {
  TV_REPLACEMENT_FILES, TV_BLANK_COLUMNS, TV_REPLACEMENT_APPROACH, tvFileOf, marketsOf, displayNameOf, screenRowsOf, bookRowsOf, fileCsv,
  type TvReplacementFile, type TvManifest, type TvManifestFile,
} from './tv-replacement';

export const OLD_TV_DIR = path.join(process.cwd(), 'public', 'data', 'tradingview');

interface Snap { rows: ScreenRow[]; builtAt: string }

/**
 * The market's snapshot, or null when there is none (no database, nothing built yet, unreadable).
 * zzz1053: read through the ONE shared snapshot cache (lib/screener/snapshot-cache.ts — single flight, re-read only when a newer
 * snapshot exists) instead of a private 5-minute copy that re-read the whole snapshot from Postgres with no sharing.
 */
export async function loadSnapshot(m: ScreenMarket): Promise<Snap | null> {
  const s = await getSnapshot(m);
  if (!s || !s.rows.length) return null;
  // the same guard the stock-screener API applies to snapshots built before it (zzz991) — a view, the shared rows are not changed
  return { rows: r40GuardedRows(s, ruleOf40Usable), builtAt: s.builtAt };
}

/** The old committed TradingView manifest (for the fallback's date). */
async function oldManifest(): Promise<{ lastSync: string | null; files: Array<{ name: string; ok?: boolean; error?: string | null }> } | null> {
  try { return JSON.parse(await fs.readFile(path.join(OLD_TV_DIR, 'manifest.json'), 'utf8')); } catch { return null; }
}
async function oldCsv(name: string): Promise<string | null> {
  if (!/^[a-z0-9-]+\.csv$/.test(name)) return null;
  try { return await fs.readFile(path.join(OLD_TV_DIR, name), 'utf8'); } catch { return null; }
}
const csvRowCount = (text: string) => Math.max(0, text.split('\n').filter((l) => l.trim()).length - 1);

/** The US Portfolio Book holdings (US listings only), or an error. Loaded lazily (personal data store). */
async function usBookTickers(): Promise<{ tickers: string[]; error: string | null }> {
  try {
    const [{ readUsBook, US_BOOK_OWNER }, { thesisUniverse }, { usBookHoldings }] = await Promise.all([
      import('@/lib/us-book-store'), import('@/lib/us-book/model'), import('@/lib/fundamentals/universe'),
    ]);
    const { book, error } = await readUsBook(US_BOOK_OWNER);
    if (error) return { tickers: [], error: `the US Portfolio Book could not be read (${error})` };
    return { tickers: usBookHoldings(thesisUniverse(book)).held.map((h) => h.symbol), error: null };
  } catch (e: any) { return { tickers: [], error: `the US Portfolio Book could not be read (${String(e?.message || e)})` }; }
}

export interface TvFileResult {
  file: TvReplacementFile; text: string | null; rowCount: number;
  source: TvManifestFile['source']; builtAt: string | null; error: string | null; note?: string; screens: string[];
}

// a page reads the manifest and then each file (all at once): every public file is built ONCE per snapshot pair + day and kept until
// a newer snapshot exists (zzz1053; was rebuilt every 60 s, with parallel requests each building their own copy). Never the US book.
const fileMemo = new MemoLru<TvFileResult>({ maxEntries: 64 });
const fileInflight = new Map<string, Promise<TvFileResult>>();
/** Pure: the memo key of a public file — the snapshots it reads (their builtAt) and the UTC day (date rules such as "this month"). */
export function tvFileMemoKey(name: string, builtAts: ReadonlyArray<string | null>, now: Date = new Date()): string {
  return `${name}|${builtAts.map((b) => b ?? 'none').join('|')}|${now.toISOString().slice(0, 10)}`;
}

/** Build one file. `withPersonal` = false leaves the US-book watchlist out (its rows are the owner's holdings). */
export async function buildTvFile(name: string, opts: { withPersonal?: boolean; now?: Date } = {}): Promise<TvFileResult | null> {
  const f = tvFileOf(name);
  if (!f) return null;
  if (f.list === 'us-book' || opts.now) return buildTvFileNow(f, opts);
  const snaps = await Promise.all(marketsOf(f).map((m) => loadSnapshot(m)));
  const key = tvFileMemoKey(f.name, snaps.map((s) => s?.builtAt ?? null));
  const hit = fileMemo.get(key);
  if (hit) return hit.value;
  return singleFlight(fileInflight, key, async () => {
    const res = await buildTvFileNow(f, opts);
    // an old-export fallback (snapshot missing) is never kept: the next request tries the snapshot again
    if (res.source === 'own-screener') fileMemo.set(key, res);
    return res;
  });
}

async function buildTvFileNow(f: TvReplacementFile, opts: { withPersonal?: boolean; now?: Date }): Promise<TvFileResult> {
  const markets = marketsOf(f);
  const snaps: Partial<Record<ScreenMarket, ScreenRow[]>> = {};
  const built: string[] = [];
  const missingMk: ScreenMarket[] = [];
  for (const m of markets) {
    const s = await loadSnapshot(m);
    if (s) { snaps[m] = s.rows; built.push(s.builtAt); } else missingMk.push(m);
  }
  const builtAt = built.length ? built.sort()[0] : null;   // the OLDER snapshot is what the file is as fresh as

  if (f.list === 'us-book') {
    if (!opts.withPersonal) return { file: f, text: null, rowCount: 0, source: 'none', builtAt, error: 'sign in to read the US Portfolio Book list', screens: [] };
    const book = await usBookTickers();
    if (!book.error && snaps.US) {
      const { rows, missing } = bookRowsOf(book.tickers, snaps.US);
      const text = fileCsv(f, rows.map((row) => ({ row, market: 'US' as const })));
      return { file: f, text, rowCount: rows.length, source: 'own-screener', builtAt, error: null, screens: [],
        note: `${book.tickers.length} US holding${book.tickers.length === 1 ? '' : 's'} in the US Portfolio Book${missing.length ? `; not in the US screener snapshot (left out): ${missing.join(', ')}` : ''}` };
    }
    return fallback(f, book.error || 'the US screener snapshot is not built yet', builtAt);
  }

  if (missingMk.length === markets.length) return fallback(f, `the ${missingMk.join(' + ')} screener snapshot is not available`, null);
  const { rows, perScreen } = screenRowsOf(f, snaps, opts.now || new Date());
  const text = fileCsv(f, rows);
  const parts = perScreen.map((p) => `${p.market === 'US' ? 'USA' : 'India'} ${p.count}`);
  return {
    file: f, text, rowCount: rows.length, source: 'own-screener', builtAt, error: null, screens: f.screens,
    note: `${displayNameOf(f)}: ${parts.join(' · ')}${missingMk.length ? ` — the ${missingMk.join(' + ')} snapshot is not available, so those rows are missing` : ''}`,
  };
}

async function fallback(f: TvReplacementFile, why: string, builtAt: string | null): Promise<TvFileResult> {
  const [text, man] = await Promise.all([oldCsv(f.name), oldManifest()]);
  if (!text) return { file: f, text: null, rowCount: 0, source: 'none', builtAt, error: `${why}, and there is no old TradingView export to fall back to`, screens: f.screens };
  const at = man?.lastSync ? man.lastSync.slice(0, 10) : 'an unknown date';
  return { file: f, text, rowCount: csvRowCount(text), source: 'old-tradingview-export', builtAt: man?.lastSync || null, error: null, screens: f.screens,
    note: `OLD DATA: ${why}, so this is the last TradingView export (from ${at}) — it is no longer refreshed` };
}

/** The manifest (same shape as the old manifest.json). Personal files are listed but only built when `withPersonal`. */
export async function buildTvManifest(opts: { withPersonal?: boolean; now?: Date } = {}): Promise<TvManifest> {
  const results = await Promise.all(TV_REPLACEMENT_FILES.map((f) => buildTvFile(f.name, opts)));
  const files: TvManifestFile[] = results.filter((r): r is TvFileResult => !!r).map((r) => ({
    name: r.file.name, displayName: displayNameOf(r.file), tvName: r.file.tvName, kind: r.file.kind,
    ok: !!r.text, size: r.text ? Buffer.byteLength(r.text, 'utf8') : 0, rowCount: r.rowCount, error: r.error,
    source: r.source, builtAt: r.builtAt, screens: r.screens, ...(r.note ? { note: r.note } : {}),
  }));
  const own = files.filter((f) => f.source === 'own-screener' && f.builtAt).map((f) => f.builtAt as string).sort();
  return {
    // the newest snapshot any file was built from: a page that remembers lastSync re-reads when either market is rebuilt
    lastSync: own.length ? own[own.length - 1] : (files.find((f) => f.builtAt)?.builtAt ?? null),
    ok: files.filter((f) => f.ok).length, fail: files.filter((f) => !f.ok && f.kind === 'screener').length,
    source: 'own-screener', approach: TV_REPLACEMENT_APPROACH, files, blankColumns: TV_BLANK_COLUMNS,
  };
}
