// zzz854 — pure helpers for the Special Situations count model and the AI verification state (no React, no I/O).
// One count model from the feed route drives the banner tiers, category chips, coverage and the radar check line.
// Rules: a missing field renders gracefully (older cached payloads), silence never passes (an unavailable AI check is said
// plainly), no number is invented: every figure here is read from the payload.
import type { FeedCountModel } from '@/lib/special-sit-qa';
import type { AwaitingRow, RemovedRow, VerificationSummary } from '@/lib/ai-verify-types';
import { FEED_QUARANTINE_LABEL } from '@/lib/special-sit-feed-quality';

export type CountModelIn = Partial<FeedCountModel> | null | undefined;
const num = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const n0 = (n: unknown): number => (num(n) ? n : 0);
const sum = (r: Record<string, number> | null | undefined): number => Object.values(r || {}).reduce((a, b) => a + n0(b), 0);

/** '1,204 raw feed items → 727 distinct events = 412 shown + 301 held back + 14 merged duplicates'. Null when the payload has no count model. */
export function countModelSummary(cm: CountModelIn): string | null {
  if (!cm || !num(cm.shown) || !num(cm.canonical_events)) return null;
  const held = n0(cm.held_back?.total);
  const raw = num(cm.raw_items) ? `${cm.raw_items} raw feed items → ` : '';
  return `${raw}${cm.canonical_events} distinct events = ${cm.shown} shown + ${held} held back + ${n0(cm.merged_duplicates)} merged duplicates`;
}

/** The equations (E1–E6) with a tick or a cross. A failed equation is shown, never hidden. */
export function equationRows(cm: CountModelIn): Array<{ id: string; text: string; holds: boolean }> {
  const eq = Array.isArray(cm?.equations) ? cm!.equations : [];
  return eq.filter((e) => e && typeof e.text === 'string').map((e) => ({ id: String(e.id || ''), text: e.text, holds: !!e.holds }));
}

export interface HeldBackRow { reason: string; label: string; count: number; examples: string[] }
type HeldBackIn = { reasons?: Array<{ reason: string; label?: string; count: number; examples?: string[] }>; byReason?: Record<string, number>; total?: number } | null | undefined;
/** Held back, by reason, largest first. Uses the route's list when sent; else the count model's per-reason counts. */
export function heldBackRows(heldBack: HeldBackIn, cm?: CountModelIn): HeldBackRow[] {
  const label = (r: string, l?: string) => (l && l.trim()) || (FEED_QUARANTINE_LABEL as Record<string, string>)[r] || r.toLowerCase().replace(/_/g, ' ');
  if (heldBack && Array.isArray(heldBack.reasons) && heldBack.reasons.length) {
    return heldBack.reasons.filter((x) => x && n0(x.count) > 0).map((x) => ({ reason: x.reason, label: label(x.reason, x.label), count: n0(x.count), examples: Array.isArray(x.examples) ? x.examples.filter(Boolean).slice(0, 5) : [] }))
      .sort((a, b) => b.count - a.count);
  }
  const by = (cm?.held_back?.by_reason || heldBack?.byReason || {}) as Record<string, number>;
  return Object.entries(by).filter(([, n]) => n0(n) > 0).map(([r, n]) => ({ reason: r, label: label(r), count: n0(n), examples: [] })).sort((a, b) => b.count - a.count);
}

export const AI_UNAVAILABLE_TEXT = 'AI check unavailable — items stay hidden until checked.';
export interface VerificationLine { text: string; available: boolean }
const hhmm = (iso: string | null | undefined): string | null => { const t = iso ? Date.parse(iso) : NaN; return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC` : null; };
/** One line on the AI verification state. Unavailable is said plainly, never left silent. Null only when the payload has no verification block (older cache). */
export function verificationLine(v: Partial<VerificationSummary> | null | undefined): VerificationLine | null {
  if (!v || typeof v !== 'object') return null;
  if (v.available === false) return { text: `${AI_UNAVAILABLE_TEXT}${v.unavailableReason ? ` ${String(v.unavailableReason).trim()}` : ''}`, available: false };
  const who = [v.provider && v.provider !== 'unknown' ? v.provider : null, v.model || null].filter(Boolean).join(' ');
  const last = hhmm(v.lastRunAt);
  // zzz880: two different things, said separately — "606 confirmed by the filing itself · 0 checked · 0 confirmed" read as a contradiction.
  // (1) items the company's own filing already proves (no AI needed); (2) what the AI check has done for the rest.
  const prim = num(v.primaryVerified) ? `${v.primaryVerified} confirmed directly from the company's own filing (no AI check needed). ` : '';
  const ai = `AI check of the rest${who ? ` (${who})` : ''}: ${n0(v.checked)} checked, ${n0(v.confirmed)} confirmed, ${n0(v.contradicted)} contradicted, ${n0(v.awaiting)} waiting`;
  return { text: `${prim}${ai}${last ? ` · last run ${last}` : ' · not run yet'}${v.mode === 'report' ? ' · report mode: unchecked items are still listed, with their label' : ''}`, available: true };
}

const AWAIT_REASON_WORD: Record<string, string> = {
  queued: 'Not checked yet', no_primary: 'No company document to read', not_found: 'Not found in the document', unreadable: 'Document could not be read',
  error: 'Check failed, will retry', verification_unavailable: 'AI check unavailable',
};
export function awaitingReasonWord(r: string | null | undefined): string { return (r && AWAIT_REASON_WORD[r]) || 'Awaiting verification'; }
/** 'Acme (ACME) — Acme raised FY26 revenue guidance ... — No company document to read' */
export function awaitingRowLine(r: Partial<AwaitingRow>): string {
  const who = `${r.company || 'Company not named'}${r.ticker ? ` (${r.ticker})` : ''}`;
  const why = (r.reasonText && String(r.reasonText).trim()) || awaitingReasonWord(r.reason);
  return `${who} — ${r.claimText ? String(r.claimText).trim() : 'claim text not given'} — ${why}`;
}
/** Counts of awaiting rows by reason, largest first ('No company document to read 40 · Not checked yet 12'). */
export function awaitingReasonCounts(rows: ReadonlyArray<Partial<AwaitingRow>> | null | undefined, byReason?: Record<string, number> | null): Array<{ reason: string; label: string; count: number }> {
  const c: Record<string, number> = {};
  if (byReason && Object.keys(byReason).length) for (const [k, v] of Object.entries(byReason)) c[k] = n0(v);
  else for (const r of rows || []) { const k = r.reason || 'queued'; c[k] = (c[k] || 0) + 1; }
  return Object.entries(c).filter(([, n]) => n > 0).map(([reason, count]) => ({ reason, label: awaitingReasonWord(reason), count })).sort((a, b) => b.count - a.count);
}
export function auditRowLine(r: Partial<RemovedRow>): string {
  const who = `${r.company || 'Company not named'}${r.ticker ? ` (${r.ticker})` : ''}`;
  return `${who} — ${r.claimText ? String(r.claimText).trim() : 'claim text not given'} — removed: ${r.reason ? String(r.reason).trim() : 'the document does not support it'}`;
}

/** Header numbers from the count model (verified, shown set). Null when the caller must count itself (older payload or a region filter). */
export function headerFromModel(cm: CountModelIn, region: string): { tiers: { TIER_1: number; TIER_2: number; WATCHLIST: number }; categories: Record<string, number> } | null {
  if (!cm || region !== 'ALL' || !cm.shown_by_tier || !cm.shown_by_category) return null;
  const t = cm.shown_by_tier;
  return { tiers: { TIER_1: n0(t.TIER_1), TIER_2: n0(t.TIER_2), WATCHLIST: n0(t.WATCHLIST) }, categories: { ...cm.shown_by_category } };
}

/** 'Before the AI check: Tier 1 16 · Tier 2 281 · Watchlist 245'. Null when absent. */
export function beforeVerificationLine(t: Record<string, number> | null | undefined): string | null {
  if (!t || typeof t !== 'object' || !Object.keys(t).length) return null;
  return `Before the AI check (raw tiers): Tier 1 ${n0(t.TIER_1)} · Tier 2 ${n0(t.TIER_2)} · Watchlist ${n0(t.WATCHLIST)}`;
}

/** Coverage buckets shown vs raw, labelled RAW. Null when the count model has no raw coverage. */
export function coverageRawRows(cm: CountModelIn): Array<{ bucket: string; shown: number; raw: number }> {
  const rows = Array.isArray(cm?.coverage_shown_vs_raw) ? cm!.coverage_shown_vs_raw : [];
  return rows.filter((r) => r && r.bucket).map((r) => ({ bucket: r.bucket, shown: n0(r.shown), raw: n0(r.raw) })).sort((a, b) => b.raw - a.raw || a.bucket.localeCompare(b.bucket));
}

/** The radar's own check (E5): every shown event lands in exactly one radar section, or was merged into another card for the same deal. */
export function radarReconcile(sectionCounts: Record<string, number>, shown: number | null | undefined, radarMerged = 0): { text: string; holds: boolean } | null {
  if (!num(shown)) return null;
  const s = sum(sectionCounts);
  const m = n0(radarMerged);
  return { text: m > 0 ? `Radar sections ${s} + ${m} merged into another card for the same deal = shown events ${shown}` : `Radar sections ${s} = shown events ${shown}`, holds: s + m === shown };
}

/** Shown events whose category has no box of its own ('Not in a category box: UNCATEGORISED 3'). Null when every shown event has a box. */
export function otherCategories(cm: CountModelIn, known?: string[] | null): string | null {
  if (!cm?.shown_by_category || !known || !known.length) return null;
  const rest = Object.entries(cm.shown_by_category).filter(([k, n]) => !known.includes(k) && n0(n) > 0);
  return rest.length ? `Not in a category box: ${rest.map(([k, n]) => `${k.toLowerCase().replace(/_/g, ' ')} ${n}`).join(' · ')}.` : null;
}

// ─── zzz856: "nothing verified yet" banner, verification progress, the opt-in UNVERIFIED list ──────────────────────
const clock = (iso: unknown): string | null => { const t = typeof iso === 'string' ? Date.parse(iso) : NaN; return Number.isFinite(t) ? `${new Date(t).toISOString().slice(11, 16)} UTC` : null; };
type VerificationIn = (Partial<VerificationSummary> & { nextRunAt?: string | null; next_run_at?: string | null; nextRunEta?: string | null; shownNotChecked?: number; awaitingWithPrimary?: number; awaitingNoPrimary?: number }) | null | undefined;

/** Awaiting count: the verification block first, then the route's awaitingVerificationCount. Null when neither is sent. */
export function awaitingTotal(v: VerificationIn, awaitingCount?: number | null): number | null {
  if (num(v?.awaiting)) return v!.awaiting as number;
  return num(awaitingCount) ? awaitingCount : null;
}

/** 'AI check: last run 14:05 UTC, next run ~14:35 UTC'. Absent fields say 'unknown'; nothing is invented. */
export function aiRunPhrase(v: VerificationIn): string {
  if (!v || typeof v !== 'object') return 'AI check: state unknown';
  if (v.available === false) return `AI check: unavailable${v.unavailableReason ? ` (${String(v.unavailableReason).trim().replace(/\.$/, '')})` : ''}`;
  const last = clock(v.lastRunAt);
  const nextIso = v.nextRunAt ?? v.next_run_at ?? v.nextRunEta;
  const next = clock(nextIso);
  return `AI check: ${last ? `last run ${last}` : v.lastRunAt === null ? 'not run yet' : 'last run unknown'}, next run ${next ? `~${next}` : 'unknown'}`;
}

/** The top banner when nothing is verified but items are waiting. Null otherwise (or when the shown count is not sent). */
export function nothingVerifiedBanner(cm: CountModelIn, v: VerificationIn, awaitingCount?: number | null): string | null {
  // zzz858: not-yet-checked events are shown (marked) while the hourly AI check catches up
  const sn = v && num(v.shownNotChecked) ? (v.shownNotChecked as number) : 0;
  if (sn > 0) {
    const shown = cm && num(cm.shown) ? (cm.shown as number) : null;
    return `${sn}${shown != null ? ` of the ${shown}` : ''} event${sn === 1 ? '' : 's'} shown ${sn === 1 ? 'is' : 'are'} not checked yet against the company's own document — each is marked "⏳ Not checked yet". ${aiRunPhrase(v)}. Anything the check cannot confirm is removed automatically.`;
  }
  const n = awaitingTotal(v, awaitingCount);
  if (!cm || !num(cm.shown) || cm.shown !== 0 || !n || n <= 0) return null;
  return `Nothing verified yet. ${n} item${n === 1 ? ' is' : 's are'} waiting for the company-document check (${aiRunPhrase(v)}). They are hidden until confirmed.`;
}

/** 'Verification progress: 0 confirmed · 0 checked · 1267 awaiting (No company document to read 1239 · Not checked yet 28)'. */
export function verificationProgressLine(v: VerificationIn, awaitingCount?: number | null): string | null {
  if (!v || typeof v !== 'object') return null;
  const n = awaitingTotal(v, awaitingCount);
  let split = '';
  if (num(v.awaitingWithPrimary) || num(v.awaitingNoPrimary)) split = ` (with a company document ${n0(v.awaitingWithPrimary)} · without ${n0(v.awaitingNoPrimary)})`;
  else { const r = awaitingReasonCounts(null, v.awaitingByReason as Record<string, number> | undefined); if (r.length) split = ` (${r.map((x) => `${x.label} ${x.count}`).join(' · ')})`; }
  const conf = num(v.confirmed) ? `${v.confirmed} confirmed by the AI check` : 'confirmed unknown';
  const prim = num(v.primaryVerified) ? ` · ${v.primaryVerified} confirmed by the filing itself` : '';
  return `Verification progress: ${conf}${prim} · ${num(v.checked) ? v.checked : 'unknown'} checked · ${n ?? 'unknown'} awaiting${split}`;
}

export interface UnverifiedEventIn {
  event_id?: string; quarantine_reason?: string | null; tier_before_hold?: string | null; category_before_hold?: string | null; target_name?: string | null;
  region?: string; event_type?: string; tickers?: string[]; primary_filing?: { title?: string; link?: string; source?: string; pub_date?: string } | null;
}
export interface UnverifiedCard { id: string; company: string; headline: string; reason: string; link: string | null; region: string | null; tierBefore: string | null }
const TIER_ORDER: Record<string, number> = { TIER_1: 0, TIER_2: 1, WATCHLIST: 2, NOISE: 3 };
/** Events held back only because they await verification, sorted by their tier before the hold. Reason from the awaiting list (refId = event_id). */
export function unverifiedCards(events: ReadonlyArray<UnverifiedEventIn> | null | undefined, awaiting?: ReadonlyArray<Partial<AwaitingRow>> | null, region = 'ALL'): UnverifiedCard[] {
  const why = new Map<string, Partial<AwaitingRow>>();
  for (const r of awaiting || []) if (r?.refId) why.set(String(r.refId), r);
  return (events || [])
    .filter((e) => e && e.quarantine_reason === 'AWAITING_VERIFICATION' && (region === 'ALL' || e.region === region))
    .map((e, i) => {
      const r = e.event_id ? why.get(String(e.event_id)) : undefined;
      const headline = (e.primary_filing?.title || '').trim() || (r?.claimText || '').trim() || 'Headline not given';
      const company = (e.target_name || '').trim() || (r?.company || '').trim() || 'Company not named';
      const reason = (r?.reasonText && String(r.reasonText).trim()) || (r?.reason ? awaitingReasonWord(r.reason) : 'Awaiting verification (reason not sent with this payload)');
      return { id: String(e.event_id || `u${i}`), company, headline, reason, link: e.primary_filing?.link || r?.primaryUrl || null, region: e.region || null, tierBefore: e.tier_before_hold || null, _i: i };
    })
    .sort((a, b) => (TIER_ORDER[a.tierBefore || ''] ?? 9) - (TIER_ORDER[b.tierBefore || ''] ?? 9) || a._i - b._i)
    .map(({ _i, ...c }) => c);
}

/** Raw coverage rows from the route's coverage_diagnostic_raw when the count model has none. */
export function coverageRawFallback(raw: { buckets?: Array<{ bucket?: string; count?: number }> } | null | undefined): Array<{ bucket: string; raw: number }> {
  const b = Array.isArray(raw?.buckets) ? raw!.buckets : [];
  return b.filter((x) => x && x.bucket).map((x) => ({ bucket: String(x.bucket), raw: n0(x.count) })).sort((a, b) => b.raw - a.raw || a.bucket.localeCompare(b.bucket));
}
