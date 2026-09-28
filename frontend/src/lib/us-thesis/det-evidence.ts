// ═══════════════════════════════════════════════════════════════════════════
// US EVIDENCE READ WITHOUT AI — THE CHEAP STRUCTURAL ROWS.            (zzz815)
//
// Most US names on the page have never had their SEC documents read (that
// read uses AI and runs on a click). But several structural rows need no
// model at all:
//   · the filed order backlog (RPO) — already on the card from XBRL;
//   · inventories at the quarter end vs a year earlier — XBRL, filed;
//   · backlog / bookings / book-to-bill / awards / new facility / guidance
//     raised or lowered — stated in the 8-K earnings release (EX-99.1) or
//     the 10-Q MD&A, read sentence by sentence by the deterministic US
//     reader (catalyst-text.ts), every row quoting its own sentence.
// These are persisted server-side (KV `us-thesis:det:v1:<T>`), labelled
// "read without AI", and fill the card ONLY where no AI read exists. They
// never mark a name as "evidence read" — the AI "Read evidence" button
// stays, on click. Pure: no fetch here (see det-evidence-server.ts).
// ═══════════════════════════════════════════════════════════════════════════

import type { StructuralEvent } from '@/lib/thesis/evidence-extract';
import { usCatalystEvents, mergeUsEvents } from './catalyst-text';
import { sanitizeUsEvents } from './sanitize';
import { usdWords, niceDate, type UsInstantYoY } from './xbrl';

export const US_DET_LABEL = 'read without AI';
export const US_DET_VERSION = 1;
export const US_DET_KEY = (t: string) => `us-thesis:det:v${US_DET_VERSION}:${t}`;

export interface UsDetDoc { label: string; url: string | null; outcome: 'read' | 'download_failed' | 'too_short' | 'not_reached'; chars?: number; detail?: string | null }

export interface UsDetEvidence {
  ticker: string;
  v: number;
  /** Always 'deterministic' — no model was called. */
  source: 'deterministic';
  /** "read without AI" — printed on the card beside every row it fills. */
  label: string;
  read_at: string;
  /** The quarter the documents report (shared calendar key), when known. */
  period: string | null;
  /** Filing date of the newest document read. */
  filed: string | null;
  state: 'EVIDENCE_FOUND' | 'NOTHING_STATED' | 'NO_DOCUMENTS' | 'RETRIEVAL_FAILED';
  documents: UsDetDoc[];
  events: StructuralEvent[];
  note: string;
}

/** Pure: the record for one company from the documents read. */
export function buildUsDetEvidence(ticker: string, docs: Array<UsDetDoc & { text?: string }>, meta: { period: string | null; filed: string | null; now?: Date; found?: number }): UsDetEvidence {
  const read = docs.filter((d) => d.outcome === 'read' && d.text);
  const events = usCatalystEvents(read.map((d) => ({ label: `${d.label} — ${US_DET_LABEL}`, text: String(d.text) })));
  const failed = docs.some((d) => d.outcome === 'download_failed' || d.outcome === 'not_reached');
  const state: UsDetEvidence['state'] = events.length ? 'EVIDENCE_FOUND'
    : read.length ? 'NOTHING_STATED'
      : failed ? 'RETRIEVAL_FAILED' : 'NO_DOCUMENTS';
  const names = read.map((d) => d.label.replace(/,? filed \d{4}-\d{2}-\d{2}$/, '')).join(' + ');
  const note = state === 'EVIDENCE_FOUND' ? `${events.length} structural statement${events.length === 1 ? '' : 's'} read without AI from ${names}`
    : state === 'NOTHING_STATED' ? `Read without AI: ${names} — no backlog, bookings, award, facility or guidance statement with a figure found (the AI read may find more)`
      : state === 'RETRIEVAL_FAILED' ? 'SEC documents could not be downloaded this time — a retrieval failure, retried later'
        : `EDGAR lists no 10-Q, 10-K or 8-K earnings release in the last 15 months${meta.found ? ` (${meta.found} filings checked)` : ''}`;
  return {
    ticker, v: US_DET_VERSION, source: 'deterministic', label: US_DET_LABEL, read_at: (meta.now || new Date()).toISOString(),
    period: meta.period, filed: meta.filed, state,
    documents: docs.map(({ text: _t, ...d }) => d), events, note,
  };
}

/** Pure: the filed inventories as a working-capital row (amounts, not judged). */
export function usInventoryEvent(inv: UsInstantYoY | null | undefined): StructuralEvent | null {
  if (!inv?.cur) return null;
  const after = usdWords(inv.cur.value);
  const before = inv.prev ? usdWords(inv.prev.value) : null;
  const ev = `Inventories were ${after} at ${niceDate(inv.cur.end)}${before ? ` against ${before} at ${niceDate(inv.prev!.end)}` : ''} (SEC XBRL ${inv.concept}, filed figures).`;
  const out = sanitizeUsEvents([{
    variable: 'working_capital', value_type: 'ACTUAL', before, after, unit: null, period: null,
    direction: inv.prev ? (inv.cur.value > inv.prev.value * 1.001 ? 'up' : inv.cur.value < inv.prev.value * 0.999 ? 'down' : 'flat') : 'unknown',
    evidence_text: ev, source: `SEC XBRL — ${US_DET_LABEL}`, confidence: 'HIGH',
  } as StructuralEvent]);
  return out[0] || null;
}

/**
 * Pure: the summary the engine reads for a row. An AI-read summary wins and
 * is only topped up with the filed inventory row; with no AI read, the
 * deterministic events (and inventories) are the summary's events, flagged
 * `read_without_ai`. The ROW's own summary is never changed, so a name read
 * only without AI still counts as "no SEC evidence read" and keeps its AI
 * Read button.
 */
export function withUsDetEvidence(summary: any | null, det: UsDetEvidence | null | undefined, inventory?: UsInstantYoY | null): any | null {
  const inv = usInventoryEvent(inventory);
  const extra: StructuralEvent[] = [...(summary ? [] : (det?.events || [])), ...(inv ? [inv] : [])];
  if (!extra.length) return summary;
  const base: StructuralEvent[] = Array.isArray(summary?.events) ? summary.events : [];
  return { ...(summary || {}), events: mergeUsEvents(base, extra), ...(summary ? {} : { read_without_ai: true, read_without_ai_note: det?.note || null }) };
}

/** Pure: whether a stored record should be refreshed (older than a day, or failed). */
export function usDetNeedsRun(det: UsDetEvidence | null | undefined, now: Date = new Date(), maxAgeH = 24): boolean {
  if (!det || det.v !== US_DET_VERSION) return true;
  if (det.state === 'RETRIEVAL_FAILED') return now.getTime() - Date.parse(det.read_at) > 10 * 60_000;
  return now.getTime() - Date.parse(det.read_at) > maxAgeH * 3600_000;
}

/** Pure: book first, then the bench; names with an AI read are skipped. */
export function usDetQueue<T extends { symbol: string; origin: string; summary?: any; det?: UsDetEvidence | null; figures?: { state?: string; noFiler?: boolean } | null }>(rows: T[], now: Date = new Date()): string[] {
  const want = rows.filter((r) => !r.summary && usDetNeedsRun(r.det, now) && !!r.figures && (r.figures.state === 'ok' || r.figures.state === 'none') && !r.figures.noFiler);
  const book = want.filter((r) => r.origin !== 'bench').map((r) => r.symbol).sort();
  const bench = want.filter((r) => r.origin === 'bench').map((r) => r.symbol).sort();
  return [...book, ...bench];
}
