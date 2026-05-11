// ─── Multi-source aggregator + reconciliation ─────────────────────────────
// Takes events from multiple adapters and produces ONE canonical list per
// (security_id, filing_date) tuple.  Priority order: NSE > BSE > Trendlyne >
// Tickertape > RSS.  When sources conflict on a field, the highest-priority
// source wins.  ISIN is the cross-source key when available; falls back to
// (symbol, filing_date) tuple.

import { CanonicalEvent } from './types.js';

function dedupKey(e: CanonicalEvent): string {
  // Prefer ISIN if present (cross-exchange canonical)
  if (e.isin && e.isin.length === 12) return `isin:${e.isin}|${e.filing_date}`;
  return `sym:${e.symbol}|${e.filing_date}`;
}

/**
 * Merge events from multiple sources.  Highest-priority source's fields win
 * on conflict; lower-priority sources fill in missing fields.
 */
export function reconcile(byAdapter: Map<string, CanonicalEvent[]>): CanonicalEvent[] {
  // Flatten with stable sort: higher priority first
  const all: CanonicalEvent[] = [];
  for (const evs of byAdapter.values()) all.push(...evs);
  all.sort((a, b) => a.source_priority - b.source_priority);

  const byKey = new Map<string, CanonicalEvent>();
  for (const ev of all) {
    const k = dedupKey(ev);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, { ...ev });
      continue;
    }
    // Lower-priority — merge any missing fields
    for (const key of Object.keys(ev) as (keyof CanonicalEvent)[]) {
      if (existing[key] == null && ev[key] != null) {
        (existing as any)[key] = ev[key];
      }
    }
    // If THIS source is higher priority (lower number) than the existing,
    // promote source-of-record fields.  (Stable sort makes this rare.)
    if (ev.source_priority < existing.source_priority) {
      existing.source = ev.source;
      existing.source_priority = ev.source_priority;
      existing.attachment = ev.attachment || existing.attachment;
      existing.source_url = ev.source_url || existing.source_url;
    }
  }
  return Array.from(byKey.values()).sort((a, b) =>
    b.filing_date.localeCompare(a.filing_date) || a.symbol.localeCompare(b.symbol)
  );
}

/**
 * Validate canonical event — drops obviously malformed rows before push.
 */
export function validate(events: CanonicalEvent[]): CanonicalEvent[] {
  return events.filter((e) => {
    if (!e.symbol || e.symbol.length < 1 || e.symbol.length > 30) return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.filing_date)) return false;
    if (!e.company || e.company.length < 2) return false;
    return true;
  });
}
