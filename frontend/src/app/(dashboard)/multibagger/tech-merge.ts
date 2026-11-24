// zzz1308 — how the Technicals tab merges new rows into the rows kept in this browser.
// Bug fixed: the old merge kept the FIRST row it ever saw for a symbol and skipped every newer one
// ("append" mode, on by default), so prices / moving averages stayed frozen at the day the name was
// first pulled (FSLY showed $26.34 while the server had $15.86 and Stage 4).
//
// Rules now:
//  • A server pull replaces every earlier server row. Rows from an earlier pull that the server no longer
//    lists are dropped (they are old). Rows with no source mark are from before this fix: also dropped.
//  • Uploaded rows (own TradingView files) stay unless the server or a newer upload has the same symbol —
//    then the newer row wins.
//  • An upload replaces the same symbols; other rows stay (append) or everything is replaced (append off).
export type TechSrc = 'server' | 'upload';

export function tagRows<T extends Record<string, any>>(rows: T[], src: TechSrc, at: string): T[] {
  return rows.map((r) => ({ ...r, _src: src, _at: at }));
}

export function mergeServerPull(existing: any[], fresh: any[]): { rows: any[]; added: number; updated: number; dropped: number } {
  const freshSyms = new Set(fresh.map((r) => r.symbol));
  const before = new Map(existing.map((r) => [r.symbol, r]));
  const keptUploads = existing.filter((r) => r?._src === 'upload' && !freshSyms.has(r.symbol));
  const out: any[] = [];
  const seen = new Set<string>();
  for (const r of fresh) { if (seen.has(r.symbol)) continue; seen.add(r.symbol); out.push(r); }
  for (const r of keptUploads) { if (!seen.has(r.symbol)) { seen.add(r.symbol); out.push(r); } }
  let added = 0, updated = 0;
  for (const s of seen) { if (!before.has(s)) added++; else if (freshSyms.has(s)) updated++; }
  const dropped = existing.filter((r) => !seen.has(r.symbol)).length;
  return { rows: out, added, updated, dropped };
}

export function mergeUpload(existing: any[], fresh: any[], append: boolean): { rows: any[]; added: number; dup: number } {
  const freshSyms = new Set(fresh.map((r) => r.symbol));
  const base = append ? existing.filter((r) => !freshSyms.has(r.symbol)) : [];
  const had = new Set(existing.map((r) => r.symbol));
  const seen = new Set(base.map((r) => r.symbol));
  let added = 0, dup = 0;
  for (const r of fresh) {
    if (seen.has(r.symbol)) continue;
    seen.add(r.symbol); base.push(r);
    if (had.has(r.symbol)) dup++; else added++;
  }
  return { rows: base, added, dup };
}

/** Age of a kept row in days (null when unknown — rows from before zzz1308). */
export function rowAgeDays(r: any, now = Date.now()): number | null {
  const t = r?._at ? Date.parse(r._at) : NaN;
  return Number.isFinite(t) ? (now - t) / 86_400_000 : null;
}
