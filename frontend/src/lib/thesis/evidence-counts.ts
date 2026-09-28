// ═══════════════════════════════════════════════════════════════════════════
// THE PAGE'S EVIDENCE COUNTS — FROM PERSISTED RECORDS ONLY.         (zzz770)
//
// The header used to count a name as "evidence read" when its row held a
// summary, and a summary can sit in React state after a read whose save
// failed. Every figure here is derived from the ledger the server returned
// (and the evidence state computed from it), so the header after a reload is
// the header before it. A bench name is never counted as held.
// ═══════════════════════════════════════════════════════════════════════════

import { evidenceStateOf, type CompanyEvidenceState, type CompanyLedger } from './evidence-ledger';

export interface CountableRow {
  origin: 'book' | 'bench' | 'both' | string;
  ledger?: CompanyLedger | null;
  freshness?: { evidence_state?: CompanyEvidenceState } | null;
}

export interface EvidenceCounts {
  total: number;
  held: number;
  bench: number;
  evidence_read: number;
  not_searched: number;
  incomplete: number;
  current: number;
  new_evidence: number;
  stale: number;
  source_unavailable: number;
  retrieval_failed: number;
  documents_read: number;
  by_state: Record<CompanyEvidenceState, number>;
}

/** Pure: the company's evidence state, preferring the one computed with the
 *  ledger (server or client), else computed here from the ledger. */
export function rowEvidenceState(r: CountableRow, now?: Date | string): CompanyEvidenceState {
  return r.freshness?.evidence_state || evidenceStateOf(r.ledger || null, now).state;
}

/** Pure: header counts from persisted ledgers. */
export function evidenceCounts(rows: CountableRow[], now?: Date | string): EvidenceCounts {
  const by: Record<CompanyEvidenceState, number> = {
    NOT_SEARCHED: 0, EVIDENCE_INCOMPLETE: 0, CURRENT: 0, NEW_EVIDENCE_AVAILABLE: 0,
    STALE: 0, SOURCE_UNAVAILABLE: 0, RETRIEVAL_FAILED: 0,
  };
  let held = 0, bench = 0, read = 0, docs = 0;
  for (const r of rows) {
    // A name that is held AND on the bench is held; bench-only is never held.
    if (r.origin === 'book' || r.origin === 'both') held++; else bench++;
    const l = r.ledger || null;
    if (l?.latest_period && l.periods?.[l.latest_period]) {
      read++;
      docs += l.periods[l.latest_period].documents_read || 0;
    }
    by[rowEvidenceState(r, now)]++;
  }
  return {
    total: rows.length, held, bench, evidence_read: read,
    not_searched: by.NOT_SEARCHED, incomplete: by.EVIDENCE_INCOMPLETE, current: by.CURRENT,
    new_evidence: by.NEW_EVIDENCE_AVAILABLE, stale: by.STALE,
    source_unavailable: by.SOURCE_UNAVAILABLE, retrieval_failed: by.RETRIEVAL_FAILED,
    documents_read: docs, by_state: by,
  };
}

/** Pure: "✓ Evidence read · Q1 FY27 · 3 documents · 12 facts · 9 events ·
 *  Last updated 2026-09-22" — from the persisted latest period, or null. */
export function evidenceReadLine(ledger: CompanyLedger | null | undefined): string | null {
  const p = ledger?.latest_period ? ledger.periods?.[ledger.latest_period] : null;
  if (!p) return null;
  const n = (x: number, w: string) => `${x} ${w}${x === 1 ? '' : 's'}`;
  return `✓ Evidence read · ${p.reporting_period} · ${n(p.documents_read || 0, 'document')} · ${n((p.facts || []).length, 'fact')} · ${n((p.events || []).length, 'event')} · Last updated ${String(p.updated_at || '').slice(0, 10)}`;
}

/** Pure: what a read changed, in words (from the store's merge diff). */
export function changesNote(diff: any): string | null {
  if (!diff || typeof diff !== 'object') return null;
  switch (diff.changes) {
    case 'NO_CHANGES': return 'No changes — the documents say what is already on file';
    case 'NEW_PERIOD': return `New period ${diff.period} added — earlier periods kept`;
    case 'REVISIONS': return `${diff.facts_updated || 0} fact(s) revised (${diff.facts_superseded || 0} superseded, kept in history)${diff.facts_new ? ` · ${diff.facts_new} new` : ''}`;
    case 'NEW_EVIDENCE': return `${diff.facts_new || 0} new fact(s) · ${diff.events_new || 0} new event(s)${diff.documents_new ? ` · ${diff.documents_new} new document(s)` : ''}`;
    default: return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// THE PAGE HEADER'S ARITHMETIC, IN ONE PLACE.                        (zzz784)
//
// "All 131 · 53 book · 78 bench · 12 large caps hidden … 119 of 119 shown ·
// 53 held · 66 bench" was right and unreadable: three populations and no sum.
// Every header number is derived here from the same row arrays, and the line
// it returns reconciles visibly: total − hidden = shown = book + bench, and
// the status buckets (plus "not yet assessed") add up to shown.
// ═══════════════════════════════════════════════════════════════════════════
export interface UniverseRow {
  origin: 'book' | 'bench' | 'both' | string;
  market?: string | null;
  assessment?: { status?: string | null } | null;
  pattern?: { fit?: string | null; pattern?: string | null; weak?: boolean; promoted?: boolean } | null;
}
export interface UniverseCounts {
  total: number;
  hiddenLargeCap: number;
  shown: number;
  book: number;
  bench: number;
  evaluated: number;
  notAssessed: number;
  byStatus: Record<string, number>;
  statusSum: number;
  thesisNotSet: number;
  provisional: number;
  /** zzz794: provisional types the figures did not decide (industry words did). */
  provisionalWeak: number;
  /** zzz802: nearest fits the filings confirmed (now confident auto types). */
  promoted: number;
  exportable: number;
  exportableUs: number;
  excluded: Record<string, number>;
  excludedN: number;
  /** "131 total − 12 large caps hidden = 119 shown = 53 book + 66 bench". */
  line: string;
}
/** zzz811: `market` picks the wording — the US page must never say NSE. */
export function universeCounts(allRows: UniverseRow[], shownRows: UniverseRow[], constructive: string[], opts?: { market?: 'IN' | 'US' }): UniverseCounts {
  const total = allRows.length, shown = shownRows.length;
  const hiddenLargeCap = total - shown;
  let book = 0, bench = 0, evaluated = 0, provisional = 0, provisionalWeak = 0, promoted = 0, exportable = 0, exportableUs = 0;
  const byStatus: Record<string, number> = {};
  const excluded: Record<string, number> = {};
  for (const r of shownRows) {
    if (r.origin === 'book' || r.origin === 'both') book++; else bench++;
    const s = r.assessment?.status || null;
    if (!s) continue;
    evaluated++;
    byStatus[s] = (byStatus[s] || 0) + 1;
    if (r.pattern?.fit === 'nearest' && s !== 'THESIS_NOT_SET') { provisional++; if (r.pattern.weak) provisionalWeak++; }
    if (r.pattern?.promoted) promoted++;
    if (constructive.includes(s)) { if (r.market === 'US') exportableUs++; else exportable++; }
    else excluded[s] = (excluded[s] || 0) + 1;
  }
  const notAssessed = shown - evaluated;
  const statusSum = Object.values(byStatus).reduce((a, b) => a + b, 0);
  const excludedN = Object.values(excluded).reduce((a, b) => a + b, 0);
  const line = `${total} total${hiddenLargeCap ? ` − ${hiddenLargeCap} large caps hidden` : ''} = ${shown} shown = ${book} book + ${bench} bench`
    + ` · ${evaluated} evaluated${notAssessed ? ` + ${notAssessed} not yet assessed` : ''}`
    + ` · ${byStatus.THESIS_NOT_SET || 0} thesis not set · ${provisional} provisional (nearest-fit${provisionalWeak ? `, ${provisionalWeak} of them a weak fit` : ''})${promoted ? ` · ${promoted} type${promoted === 1 ? '' : 's'} confirmed from filings` : ''}`
    + (opts?.market === 'US'
      ? ` · ${exportable + exportableUs} eligible for research export (US-listed, SEC filers) + ${excludedN} excluded = ${exportable + exportableUs + excludedN} evaluated`
      : ` · ${exportable} eligible for research export (NSE)${exportableUs ? ` + ${exportableUs} US eligible` : ''} + ${excludedN} excluded = ${exportable + exportableUs + excludedN} evaluated`);
  return { total, hiddenLargeCap, shown, book, bench, evaluated, notAssessed, byStatus, statusSum, thesisNotSet: byStatus.THESIS_NOT_SET || 0,
    provisional, provisionalWeak, promoted, exportable, exportableUs, excluded, excludedN, line };
}

// ═══════════════════════════════════════════════════════════════════════════
// RESEARCH PRIORITY — WHO IS ELIGIBLE, AND WHAT THE HEADER SAYS.     (zzz788)
//
// "71 intact theses" named a population the owner could not find: the list is
// strengthening + on-track only, and "intact" also describes neutral and
// confirmation-required cards. The header says "eligible" and names the rule.
// ═══════════════════════════════════════════════════════════════════════════
export const RESEARCH_PRIORITY_STATUSES = ['STRENGTHENING', 'ON_TRACK'] as const;
export function researchPriorityEligible(status: string | null | undefined): boolean {
  return !!status && (RESEARCH_PRIORITY_STATUSES as readonly string[]).includes(status);
}
export function researchPriorityTitle(n: number): string {
  // zzz790: says what it is for — CONFIRMATION REQUIRED is never counted here.
  return `Research priority — ${n} eligible ${n === 1 ? 'thesis' : 'theses'} ranked by evidenced catalyst — research allocation only, not a buy list, no price used`;
}

/** zzz802 — the India Research-priority row says WHY in plain words, the way
 *  the US page does; the ranking number itself is never shown (no visible
 *  0–100 scores). Drivers first (what the filings evidence), then the filed
 *  results. */
export function researchWhyLine(rank: { output?: { revenue?: number | null; earnings?: number | null; marginPp?: number | null } | null;
  drivers?: Array<{ group: string; text: string; quantified?: boolean }> | null } | null | undefined): string {
  if (!rank) return 'Why: no evidenced catalyst on file.';
  const bits: string[] = [];
  for (const d of (rank.drivers || []).slice(0, 2)) {
    const t = String(d.text).replace(/\s+/g, ' ').trim();
    bits.push(`${d.group.toLowerCase()}${d.quantified === false ? ' (management remark)' : ''} — ${t.length > 110 ? `${t.slice(0, 109)}…` : t}`);
  }
  const o = rank.output || {};
  const pct = (v: number) => `${v >= 0 ? '+' : ''}${v}%`;
  const out = [o.revenue != null ? `revenue ${pct(o.revenue)}` : null, o.earnings != null ? `earnings ${pct(o.earnings)}` : null,
    o.marginPp != null && o.marginPp > 0 ? `margin +${o.marginPp} points` : null].filter(Boolean).join(', ');
  if (out) bits.push(`filed results: ${out}`);
  return `Why: ${bits.join('; ') || 'filed results only — no mechanism evidenced yet'}.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// THE RESEARCH EXPORT, IN FACTS.                                      (zzz790)
// "87 in constructive statuses" was a judgement word over a mechanical rule.
// The rule is stated as it is: the export takes STRENGTHENING, ON TRACK,
// CONFIRMATION REQUIRED and RUNNING AHEAD OF PLAN (confirmation-required IS
// included, and the line says so); every other status is excluded and named.
// exportable (NSE) + US in these statuses + excluded = analysed.
// ═══════════════════════════════════════════════════════════════════════════
export const RESEARCH_EXPORT_STATUSES = ['STRENGTHENING', 'ON_TRACK', 'CONFIRMATION_REQUIRED', 'POSITIVE_EXPECTATION_GAP'] as const;
export interface ExportCounts { analysed: number; eligible: number; eligibleNse: number; eligibleUs: number; excluded: Array<[string, number]>; excludedN: number; line: string }
export function exportCounts(rows: UniverseRow[], label: (status: string) => string = (s) => s): ExportCounts {
  const analysed = rows.filter((r) => r.assessment?.status).length;
  const keep = (s: string | null | undefined) => !!s && (RESEARCH_EXPORT_STATUSES as readonly string[]).includes(s);
  const el = rows.filter((r) => keep(r.assessment?.status));
  const eligibleUs = el.filter((r) => r.market === 'US').length;
  const eligibleNse = el.length - eligibleUs;
  const ex: Record<string, number> = {};
  for (const r of rows) { const s = r.assessment?.status; if (s && !keep(s)) ex[s] = (ex[s] || 0) + 1; }
  const excluded = Object.entries(ex);
  const excludedN = excluded.reduce((t, [, n]) => t + n, 0);
  const line = `${analysed} analysed · ${el.length} eligible for research export (strengthening, on track, confirmation required, running ahead of plan — confirmation required is included)`
    + `${excludedN ? ` · ${excludedN} excluded (${excluded.map(([s, n]) => `${n} ${label(s).toLowerCase()}`).join(', ')})` : ''}`
    + `${eligibleUs ? ` · ${eligibleUs} of the ${el.length} are US names (not on an NSE list)` : ''}`
    + ` · ${el.length} + ${excludedN} = ${analysed}`;
  return { analysed, eligible: el.length, eligibleNse, eligibleUs, excluded, excludedN, line };
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE CONTROL — ONE DEFINITION FOR THE HEADER AND THE BUTTON.    (zzz790)
// "118 of 119 have evidence read · 1 remaining" beside "Read evidence for 2
// that need it" used two definitions. Both now come from here: UNREAD = no
// persisted period on the ledger (the header's own test); REQUIRES UPDATE =
// evidence on file but a newer document is known, it is stale, or the last
// retrieval failed / the source was unavailable. attention = unread + update.
// ═══════════════════════════════════════════════════════════════════════════
export interface AttentionRow extends CountableRow { symbol?: string; freshness?: { state?: string; evidence_state?: CompanyEvidenceState } | null }
export function evidenceAttention(rows: AttentionRow[], now?: Date | string): { unread: string[]; update: string[]; total: number; line: string } {
  const unread: string[] = [], update: string[] = [];
  for (const r of rows) {
    const l = r.ledger || null;
    const has = !!(l?.latest_period && l.periods?.[l.latest_period]);
    const es = rowEvidenceState(r, now);
    if (!has) unread.push(String(r.symbol || ''));
    else if (r.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' || r.freshness?.state === 'STALE'
      || es === 'NEW_EVIDENCE_AVAILABLE' || es === 'STALE' || es === 'RETRIEVAL_FAILED' || es === 'SOURCE_UNAVAILABLE') update.push(String(r.symbol || ''));
  }
  const total = unread.length + update.length;
  const line = total ? `${total} need${total === 1 ? 's' : ''} attention — ${unread.length} unread, ${update.length} require${update.length === 1 ? 's' : ''} update` : 'All evidence current';
  return { unread, update, total, line };
}
