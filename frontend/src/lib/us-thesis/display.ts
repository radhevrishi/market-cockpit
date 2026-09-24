// ═══════════════════════════════════════════════════════════════════════════
// US PAGE WORDING: THE COMPANY'S OWN PERIODS, SEC WORDS, $M.          (zzz793)
//
// The shared ledger keys every period by an India-style calendar key
// ("Q1 FY27" = the quarter to 30 Jun 2026). That key must stay the key — the
// engine orders and compares periods with it — but a US owner must never
// read it. Nor "concall", "exchange announcement", "screener data", or
// "$13.2 mn". This module is the last step before display: it maps every
// such string in a card's data to the company's own fiscal period
// ("Q4 FY2026") and to SEC wording, deep, including object keys (so the
// card's own lookups by period still line up). It never changes a number.
// Pure.
// ═══════════════════════════════════════════════════════════════════════════

import { fiscalPeriodName, niceDate, type FiscalCalendar } from './xbrl';

const INDIA_KEY = /\bQ([1-4])\s?FY'?(\d{2})\b(?!\d)/g;
const INDIA_FY = /\bFY'?(\d{2})\b(?!\d)/g;

/** "Q1 FY27" → the calendar date the India key's quarter ends on. */
export function indiaKeyEnd(key: string): string | null {
  const m = /^Q([1-4])\s?FY'?(\d{2})$/.exec(String(key || '').trim());
  if (!m) return null;
  const q = Number(m[1]), fyEnd = 2000 + Number(m[2]);
  const [y, mo] = q === 4 ? [fyEnd, 3] : [fyEnd - 1, q * 3 + 3];
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return `${y}-${String(mo).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

interface NamerSource {
  calendar?: FiscalCalendar | null;
  ledger?: { periods?: Record<string, { documents?: Array<{ label?: string; period?: string | null; kind?: string }> }> } | null;
}

/**
 * key → the company's own name for that period. From the period's own
 * 10-Q / 10-K when one is on file (its quarter-end date), else from the
 * calendar quarter the key stands for, placed in the company's fiscal year.
 */
export function usPeriodNamer(src: NamerSource): (key: string) => string {
  const cal = src.calendar || null;
  const exact = new Map<string, string>();
  for (const [k, p] of Object.entries(src.ledger?.periods || {})) {
    for (const d of p?.documents || []) {
      const m = /(?:quarter|fiscal year) ended (\d{4}-\d{2}-\d{2})/.exec(String(d?.label || ''));
      const end = m ? m[1] : null;
      if (!end) continue;
      const name = fiscalPeriodName(end, 'Q', cal);
      if (name) { exact.set(k, name); break; }
    }
  }
  return (key: string) => {
    const k = key.replace(/\s+/g, ' ').replace(/FY'/, 'FY').trim();
    if (exact.has(k)) return exact.get(k)!;
    const end = indiaKeyEnd(k);
    if (!end) return key;
    const name = fiscalPeriodName(end, 'Q', cal);
    return name || `the quarter to ${niceDate(end).replace(/ \d+,/, '')}`;
  };
}

/** SEC wording and $M, for one string. Numbers are never changed. */
export function usText(s: string, name: (key: string) => string, cal: FiscalCalendar | null = null): string {
  if (!s) return s;
  let t = s.replace(INDIA_KEY, (m, q, y) => name(`Q${q} FY${y}`));
  // A bare India fiscal year ("FY26") → the company's fiscal year that
  // contains 31 March of that year.
  t = t.replace(INDIA_FY, (m, y) => (cal ? fiscalPeriodName(`20${y}-03-31`, 'FY', cal) || 'the prior fiscal year' : 'the prior fiscal year'));
  t = t
    .replace(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?mn\b/g, '$$$1M')
    .replace(/\$\s?(\d[\d,]*(?:\.\d+)?)\s?bn\b/g, '$$$1B')
    .replace(/(\d[\d,]*(?:\.\d+)?)\s?USD million\b/g, '$$$1M')
    // zzz797: the shared engine's India wording sizes a one-off against the
    // profit "(₹815 Cr)". On a US card that figure is the XBRL profit in USD
    // millions — never rupees, never crore.
    .replace(/(?:₹|\bRs\.?|\bINR)\s?(\d[\d,]*(?:\.\d+)?)\s?(?:Cr\b|crores?\b)/g, '$$$1M')
    .replace(/(?<![\w$₹])(\d[\d,]*(?:\.\d+)?)\s?(?:Cr\b|crores?\b)/g, '$$$1M')
    .replace(/filing, concall or exchange announcement/gi, '10-Q, 10-K, 8-K or earnings release (SEC EDGAR)')
    .replace(/\bexchange announcements?\b/gi, 'SEC filing')
    .replace(/\bconcall(s)?\b/gi, 'earnings release$1')
    .replace(/\bscreener(?:\.in)? (?:data|figures?|table|exports?)\b/gi, 'SEC XBRL figures')
    .replace(/\bSEBI\b/g, 'SEC');
  return t;
}

/** Deep: every string (and every object key) through usText. */
export function usLocalize<T>(x: T, name: (key: string) => string, cal: FiscalCalendar | null = null, seen = new WeakMap<object, any>()): T {
  if (typeof x === 'string') return usText(x, name, cal) as any;
  if (!x || typeof x !== 'object') return x;
  if (seen.has(x as any)) return seen.get(x as any);
  if (Array.isArray(x)) {
    const out: any[] = [];
    seen.set(x as any, out);
    for (const v of x) out.push(usLocalize(v, name, cal, seen));
    return out as any;
  }
  if (Object.getPrototypeOf(x) !== Object.prototype) return x;
  const out: Record<string, any> = {};
  seen.set(x as any, out);
  for (const [k, v] of Object.entries(x as any)) out[usText(k, name, cal)] = usLocalize(v, name, cal, seen);
  return out as any;
}

/** The whole display copy of a US row. The row itself (and its keys) is
 *  left untouched for the engine; only what the card prints is mapped. */
export function usDisplayRow<R extends { ledger?: any; sec?: any; graded?: any }>(row: R): R {
  return usDisplayer(row)(row);
}

/** A reusable display mapper for one row's company (its calendar and its
 *  ledger's periods): apply it to anything printed about that company. */
export function usDisplayer(row: { ledger?: any; sec?: any; graded?: any } | null | undefined): <T>(x: T) => T {
  const cal: FiscalCalendar | null = row?.sec?.calendar || row?.graded?.fiscal_calendar || null;
  const name = usPeriodNamer({ calendar: cal, ledger: row?.ledger || null });
  return <T>(x: T): T => usLocalize(x, name, cal);
}
