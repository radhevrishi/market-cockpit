// ═══════════════════════════════════════════════════════════════════════════
// CATALYST RESEARCH — WHAT THE PAGE IS SHOWN.                        (zzz769)
//
// Pure helpers shared by the research route and the page (no server imports,
// so the client bundle can use them): entity cleanup of stored text, the
// short error lines, and coverage measured against the CURRENT board rather
// than against every name the day's store has ever seen.
// ═══════════════════════════════════════════════════════════════════════════

/** HTML entities and SQL-style doubled apostrophes in stored text:
 *  "AIL Dixon&#x27;s" (zzz768), "Scrutinizer''s Report" (KTKBANK, zzz769). */
export function unEntity<T>(v: T): T {
  if (typeof v !== 'string') return v;
  return v
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .replace(/(\w)''(?=\w)/g, "$1'") as unknown as T;
}

/** Findings as the page is shown them: text decoded, and findings stored
 *  before a scoring rule tightened re-capped at read time. (zzz766–768) */
export function presentFindings<T extends Record<string, any>>(findings: T): T {
  const out: Record<string, any> = {};
  for (const [k, f0] of Object.entries(findings || {})) {
    const f = f0 ? { ...f0, headline: unEntity(f0.headline), evidenceQuote: unEntity(f0.evidenceQuote), company: unEntity(f0.company),
      notes: Array.isArray(f0.notes) ? f0.notes.map(unEntity) : f0.notes, routine: Array.isArray(f0.routine) ? f0.routine.map(unEntity) : f0.routine } : f0;
    if (f && f.status === 'catalyst' && f.category === 'fundraising'
      && /\bncds?\b|non[- ]convertible debenture|debentures?\b|commercial paper|term loan/i.test(String(f.headline || ''))
      && !/\bequity\b|preferential|\bqip\b|warrant|rights (issue|shares)/i.test(String(f.headline || ''))) {
      // Debt is financing, not a catalyst (zzz766).
      out[k] = { ...f, status: 'routine_only', headline: `Debt financing — ${String(f.headline)}`, net: null, verdict: null, components: null, notes: (f.notes || []).filter((n: string) => !/A raise is supply|Fundraising adds supply/.test(n)).concat('Borrowing is financing, not a catalyst.'), routine: [...(f.routine || []), String(f.headline)] };
      continue;
    }
    if (f && f.status !== 'catalyst' && Array.isArray(f.notes) && /\bncds?\b|debenture/i.test(String(f.headline || ''))) {
      out[k] = { ...f, notes: f.notes.filter((n: string) => !/A raise is supply|Fundraising adds supply/.test(n)) };
      continue;
    }
    out[k] = f && f.category === 'management_change' && typeof f.net === 'number' && f.net > 15
      ? { ...f, net: 15, verdict: 'WEAK' } : f;
  }
  return out as T;
}

/** One failure clause → a few words the owner can read. */
function summarizeClause(c: string): string {
  const s = c.trim();
  if (/^chart\b/i.test(s)) return 'price chart unavailable (screener.in)';
  if (/^company page\b/i.test(s)) return 'company page unavailable (screener.in)';
  if (/not in the SEC company list/i.test(s)) return 'not in the SEC company list';
  if (/edgar|\bsec\b/i.test(s)) return 'SEC EDGAR unavailable';
  if (/timed? ?out|timeout|aborted/i.test(s)) return 'timed out';
  if (/proxy|screener/i.test(s)) return 'screener.in could not be read';
  const first = s.split(/(?<=[.;])\s/)[0].replace(/[.;]$/, '');
  return first.length > 60 ? `${first.slice(0, 59)}…` : first;
}

export interface ErrorLine { ticker: string | null; short: string; full: string }

/** "Last errors", readable: one short line per ticker (≤ 90 chars, the last
 *  failure wins), at most `max`, only for names still on today's board, with
 *  the full text kept for a tooltip. The proxy's paragraph-long diagnostics
 *  used to be printed whole, several times over. (zzz769) */
export function presentErrorLines(errors: string[], universe: Array<{ ticker: string }>, max = 5): ErrorLine[] {
  const on = new Set(universe.map((u) => u.ticker.toUpperCase()));
  const byKey = new Map<string, ErrorLine>();
  for (const e0 of errors || []) {
    const e = String(e0);
    const m = /^([A-Z0-9.&-]+):\s*([\s\S]*)$/.exec(e.trim());
    const ticker = m ? m[1].toUpperCase() : null;
    if (ticker && !on.has(ticker)) continue;
    const body = m ? m[2] : e;
    const parts = Array.from(new Set(body.split(/;\s+(?=[a-z][\w .-]{0,30}:)/i).map(summarizeClause).filter(Boolean)));
    const short = `${ticker ? `${ticker}: ` : ''}${parts.join(', ') || 'failed'}`;
    const key = ticker || e;
    byKey.delete(key);                               // the latest failure for a name wins, in order
    byKey.set(key, { ticker, short: short.length > 90 ? `${short.slice(0, 89)}…` : short, full: e.slice(0, 2000) });
  }
  return Array.from(byKey.values()).slice(-max);
}

/** Coverage of the CURRENT board: researched ∩ board / board. The store's
 *  own universe is every name seen today across scans — 99/99 while 26 of
 *  125 names on the board had never been looked at. (zzz769) */
export function boardCoverage(board: string[], findings: Record<string, { status?: string } | undefined>, excluded: string[] = []): { researched: number; total: number; pct: number; missing: string[]; offBoard: number } {
  const ex = new Set(excluded.map((t) => String(t).toUpperCase()));
  const uniq = Array.from(new Set(board.map((t) => String(t).toUpperCase()))).filter((t) => !ex.has(t));
  const done = (t: string) => { const f = findings?.[t]; return !!f && f.status !== 'unresearched'; };
  const missing = uniq.filter((t) => !done(t));
  const on = new Set(uniq);
  const offBoard = Object.keys(findings || {}).filter((t) => !on.has(t.toUpperCase()) && !ex.has(t.toUpperCase())).length;
  const researched = uniq.length - missing.length;
  return { researched, total: uniq.length, pct: uniq.length ? Math.round((researched / uniq.length) * 100) : 0, missing, offBoard };
}
