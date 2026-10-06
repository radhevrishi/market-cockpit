// zzz913 — DAILY GAINERS BRIEF, sent by the app (was a Claude scheduled task at 12:50 Berlin).
//
// The app already researches the India gainers board after the close (daily-research.yml gainers-in on GitHub, which
// pre-fetches screener.in pages; the app job `gainers-in-backup` picks it up when GitHub's run did not happen or died).
// This module only READS that stored research and writes the brief. It makes no model call and no upstream fetch:
// every "what happened" line is the filing text the research already stored.
//
// Rules carried over from the owner's task:
//   • coverage is a fraction, never implied complete; unresearched names are listed, never scored
//   • small and mid caps only (India: under ₹30,000 Cr; unknown size kept and labelled)
//   • new / sustained (3+ sessions in a row) / dropped off, against the earlier sessions' boards
//   • ranked by research priority (the evidence), never by the size of the move
//   • the plain-text part has no "<" at all; every link is an anchor with a short label, never a bare URL
//   • light background, dark text; no buy / sell wording, no price targets
//   • it always goes out: the first slots wait for a complete sweep, the last slot sends what exists, marked PARTIAL
//
// Pure functions here (tested in __tests__/zzz913-gainers-brief.test.ts); the HTTP glue is in
// app/api/v1/cron/gainers-brief/route.ts and the two scheduler jobs at the end of this file.
import { PARTITION_META, primaryStatusOf, type PrimaryStatus } from './ai-gainers/research-view';
import { SMALL_MID_MAX_CR, knownCapCr } from './small-mid-filter';

// ── inputs ──────────────────────────────────────────────────────────────────

export interface BriefUniverseRow { ticker: string; company?: string | null; movePct?: number | null; marketCap?: number | null }
/** The subset of a ResearchItem the brief reads (the research GET's `view` arrays). All optional: an old view still renders. */
export interface BriefItem {
  ticker: string; company?: string | null; companyName?: string; displayTicker?: string;
  eventClass?: string; catalystFor?: string; sourceConfidence?: string; sourceExistence?: string; immaterialNegative?: boolean;
  primaryStatus?: PrimaryStatus; priority?: number; headline?: string; whatChanged?: string | null; whyResearch?: string;
  researchQuestion?: string; eventLabel?: string; sourceUrl?: string | null; filedDate?: string | null;
  portfolio?: { relevance?: string } | null;
}
export interface BriefResearch {
  date: string;
  session?: { date?: string; state?: string; isToday?: boolean; label?: string } | null;
  coverage?: { researched: number; total: number; pct: number } | null;
  remaining?: number;
  universe?: BriefUniverseRow[];
  findings?: Record<string, { status?: string } | undefined>;
  view?: Record<string, unknown> | null;
  updated_at?: string | null;
}
/** Earlier sessions' boards, NEWEST FIRST. `tickers: null` = that session's board is not stored (the streak stops there). */
export interface BoardHistoryEntry { date: string; tickers: string[] | null }

// ── decisions ───────────────────────────────────────────────────────────────

export type BriefDecision = 'skip_no_session' | 'defer' | 'send' | 'send_partial';
/**
 * When to send. Not a trading day today → nothing to brief. A complete sweep → send. Otherwise wait for a later slot,
 * and on the LAST slot send what exists, marked PARTIAL (a brief that arrives beats one that does not).
 */
export function briefDecision(r: Pick<BriefResearch, 'session' | 'coverage' | 'remaining'> | null, final: boolean): BriefDecision {
  if (r?.session && r.session.isToday === false) return 'skip_no_session';
  const total = Number(r?.coverage?.total || 0);
  const remaining = Number(r?.remaining ?? total);
  if (total > 0 && remaining <= 0) return 'send';
  return final ? 'send_partial' : 'defer';
}

export type BackupDecision = 'skip_no_session' | 'skip_complete' | 'skip_in_progress' | 'run';
/** a sweep that saved within this many minutes is still running (GitHub's run) — do not research the same names twice */
export const BACKUP_IN_PROGRESS_MIN = 15;
/** The app's backup India sweep runs only when GitHub's run did not happen, or stopped part-way and went quiet. */
export function backupDecision(r: Pick<BriefResearch, 'session' | 'coverage' | 'remaining' | 'updated_at'> | null, now: Date): BackupDecision {
  if (r?.session && r.session.isToday === false) return 'skip_no_session';
  const total = Number(r?.coverage?.total || 0);
  const remaining = Number(r?.remaining ?? total);
  if (total > 0 && remaining <= 0) return 'skip_complete';
  const upd = r?.updated_at ? Date.parse(String(r.updated_at)) : NaN;
  if (total > 0 && Number.isFinite(upd) && now.getTime() - upd < BACKUP_IN_PROGRESS_MIN * 60_000) return 'skip_in_progress';
  return 'run';
}

// ── board history ───────────────────────────────────────────────────────────

const ymd = (d: Date) => d.toISOString().slice(0, 10);
/** The `n` trading sessions before `date` (newest first), skipping weekends and the holidays `isHoliday` names. */
export function previousSessionDates(date: string, n: number, isHoliday: (ymd: string) => boolean = () => false): string[] {
  const out: string[] = [];
  const d = new Date(`${date}T00:00:00Z`);
  for (let k = 0; k < 40 && out.length < n; k++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    if (wd === 0 || wd === 6 || isHoliday(ymd(d))) continue;
    out.push(ymd(d));
  }
  return out;
}

/** Research-store key for one session's sweep (same as app/api/v1/ai-gainers/research — a test pins the two together). */
export const researchStateKey = (market: 'IN' | 'US', date: string) => `ai-gainers:research:v1:${market}:${date}`;

/** Small/mid tickers of a stored research state (unknown size kept). null when the state is missing. */
export function boardTickersOf(state: { universe?: BriefUniverseRow[] } | null | undefined): string[] | null {
  if (!state || !Array.isArray(state.universe)) return null;
  return state.universe.filter((u) => isSmallMid(u.marketCap)).map((u) => up(u.ticker)).filter(Boolean);
}

export interface BoardDelta {
  /** whether the previous session's board is known (otherwise "new" cannot be said) */
  known: boolean;
  newToday: string[];
  /** on the board this session and the sessions before it in a row (3 or more), longest first */
  sustained: Array<{ ticker: string; sessions: number }>;
  dropped: string[];
}
export const SUSTAINED_MIN_SESSIONS = 3;
export function boardDelta(today: string[], history: BoardHistoryEntry[]): BoardDelta {
  const now = Array.from(new Set(today.map(up)));
  const prev = history[0]?.tickers ? new Set(history[0].tickers.map(up)) : null;
  const streak = (t: string) => {
    let n = 1;
    for (const h of history) { if (!h.tickers || !h.tickers.map(up).includes(t)) break; n++; }
    return n;
  };
  const sustained = now.map((t) => ({ ticker: t, sessions: streak(t) })).filter((x) => x.sessions >= SUSTAINED_MIN_SESSIONS)
    .sort((a, b) => b.sessions - a.sessions || a.ticker.localeCompare(b.ticker));
  return {
    known: !!prev,
    newToday: prev ? now.filter((t) => !prev.has(t)) : [],
    sustained,
    dropped: prev ? [...prev].filter((t) => !now.includes(t)).sort() : [],
  };
}

// ── rows ────────────────────────────────────────────────────────────────────

const up = (s: unknown) => String(s ?? '').trim().toUpperCase();
const isSmallMid = (cap: unknown) => { const c = knownCapCr(cap); return c == null || c < SMALL_MID_MAX_CR; };

/** Every researched item in the view, one per ticker (first list wins). */
export function itemsByTicker(view: Record<string, unknown> | null | undefined): Map<string, BriefItem> {
  const m = new Map<string, BriefItem>();
  if (!view) return m;
  for (const k of ['top3', 'portfolio', 'queue', 'needsReading', 'watch', 'negative', 'immaterialNegative', 'noCatalyst', 'context', 'dataQuality']) {
    const arr = (view as any)[k];
    if (!Array.isArray(arr)) continue;
    for (const it of arr) { const t = up(it?.ticker); if (t && !m.has(t)) m.set(t, it as BriefItem); }
  }
  return m;
}

export interface BriefRow {
  ticker: string; company: string; movePct: number | null; marketCap: number | null;
  status: PrimaryStatus; statusLabel: string; priority: number;
  what: string; why: string; sourceUrl: string | null; held: boolean; watched: boolean;
}

const STATUS_ORDER: PrimaryStatus[] = ['confirmed', 'identified_impact_unknown', 'negative', 'secondary_unverified', 'older_context_only', 'no_catalyst', 'data_unavailable', 'recent_listing_excluded', 'not_researched'];

function statusOf(t: string, item: BriefItem | undefined, finding: { status?: string } | undefined): PrimaryStatus {
  if (!finding || !finding.status || finding.status === 'unresearched') return 'not_researched';
  if (item?.primaryStatus) return item.primaryStatus;
  if (item?.eventClass) return primaryStatusOf(item as any);
  if (finding.status === 'source_failed') return 'data_unavailable';
  if (finding.status === 'listing_artifact') return 'recent_listing_excluded';
  if (finding.status === 'negative') return 'negative';
  return 'no_catalyst';
}

/** Rating words are never passed through as if they were this brief's call; "<" never reaches the plain text. */
export function neutralText(s: unknown, max = 260): string {
  let t = String(s ?? '').replace(/\s+/g, ' ').trim()
    .replace(/\b(STRONG BUY|BUY|SELL|STRONG SELL|ACCUMULATE|AVOID|EXIT)\b/g, (w) => w.toLowerCase())
    .replace(/</g, '‹').replace(/>/g, '›');
  if (t.length > max) t = `${t.slice(0, max - 1).trimEnd()}…`;
  return t;
}

/** All small/mid names on the board, ranked: research priority (the evidence) first, never the move size. */
export function briefRows(r: BriefResearch): BriefRow[] {
  const items = itemsByTicker(r.view);
  const out: BriefRow[] = [];
  for (const u of r.universe || []) {
    const t = up(u.ticker);
    if (!t || !isSmallMid(u.marketCap)) continue;
    const it = items.get(t);
    const status = statusOf(t, it, r.findings?.[u.ticker] ?? r.findings?.[t]);
    const rel = it?.portfolio?.relevance || '';
    const what = status === 'not_researched' ? '' : neutralText(it?.whatChanged || it?.headline || it?.eventLabel || '');
    const why = status === 'confirmed' || status === 'identified_impact_unknown' || status === 'negative' || status === 'secondary_unverified'
      ? neutralText(it?.whyResearch || it?.researchQuestion || '', 200) : '';
    out.push({
      ticker: t,
      company: neutralText(it?.companyName || it?.company || u.company || t, 60),
      movePct: typeof u.movePct === 'number' && Number.isFinite(u.movePct) ? u.movePct : null,
      marketCap: knownCapCr(u.marketCap),
      status, statusLabel: PARTITION_META[status].label,
      priority: typeof it?.priority === 'number' ? it.priority : -1,
      what, why,
      sourceUrl: it?.sourceUrl && /^https?:\/\//i.test(it.sourceUrl) ? it.sourceUrl : null,
      held: rel === 'HOLDING', watched: rel === 'WATCHLIST',
    });
  }
  return out.sort((a, b) =>
    STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
    || b.priority - a.priority
    || Math.abs(b.movePct ?? 0) - Math.abs(a.movePct ?? 0)
    || a.ticker.localeCompare(b.ticker));
}

// ── composing ───────────────────────────────────────────────────────────────

export interface ComposedBrief { subject: string; text: string; html: string; partial: boolean; rows: BriefRow[]; coverageLine: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const niceDate = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return y && m && d ? `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}` : iso; };
const pct = (v: number | null) => (v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
const crore = (v: number | null) => (v == null ? 'size unknown' : `₹${Math.round(v).toLocaleString('en-IN')} Cr`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const href = (u: string) => esc(u);

const COLORS: Record<PrimaryStatus, string> = {
  confirmed: '#047857', identified_impact_unknown: '#b45309', secondary_unverified: '#a16207', negative: '#b91c1c',
  no_catalyst: '#4b5563', older_context_only: '#4b5563', data_unavailable: '#7c3aed', recent_listing_excluded: '#4b5563', not_researched: '#6b7280',
};
/** How many ranked rows the plain text (and Telegram) carries; the email HTML lists them all. */
export const TEXT_ROWS = 20;

export function composeBrief(r: BriefResearch | null, opts: { date: string; partial: boolean; history: BoardHistoryEntry[]; appUrl?: string | null; note?: string | null }): ComposedBrief {
  const rows = r ? briefRows(r) : [];
  const researched = rows.filter((x) => x.status !== 'not_researched');
  const total = rows.length;
  const coverageLine = total
    ? `Catalyst coverage ${researched.length}/${total} = ${Math.round((researched.length / total) * 100)}%.${researched.length < total ? ' The rest are listed below as not yet researched.' : ''}`
    : 'No research is stored for this session yet.';
  const subject = `${opts.partial ? 'PARTIAL — ' : ''}Daily Gainers Brief — ${niceDate(opts.date)}`;
  const closing = r?.session?.state === 'closed' ? `Closing data, ${niceDate(opts.date)}.` : `Data for the ${niceDate(opts.date)} session${r?.session?.label ? ` (${neutralText(r.session.label, 120)})` : ''}.`;
  const delta = boardDelta(rows.map((x) => x.ticker), opts.history);
  const book = rows.filter((x) => x.held || x.watched);
  const ranked = rows.filter((x) => x.status !== 'not_researched');
  const evidence = ranked.filter((x) => ['confirmed', 'identified_impact_unknown', 'secondary_unverified', 'negative'].includes(x.status));
  const noFiling = ranked.filter((x) => x.status === 'no_catalyst' || x.status === 'older_context_only');
  const failed = ranked.filter((x) => x.status === 'data_unavailable');
  const unresearched = rows.filter((x) => x.status === 'not_researched');
  const appLink = opts.appUrl && /^https?:\/\//i.test(opts.appUrl) ? `${opts.appUrl.replace(/\/+$/, '')}/ai-gainers` : null;

  // plain text (Telegram + the email's text part): no "<", no URLs
  const L: string[] = [];
  L.push(closing, 'India small and mid caps only (under ₹30,000 Cr; unknown size kept).', coverageLine);
  if (opts.partial) L.push(`PARTIAL: ${opts.note ? neutralText(opts.note, 200) : 'the research sweep had not finished by the last send time.'}`);
  L.push('');
  L.push('YOUR BOOK ON THE BOARD');
  if (book.length) for (const b of book) L.push(`- ${b.ticker} (${b.held ? 'held' : 'watchlist'}) ${pct(b.movePct)} — ${b.statusLabel}${b.what ? `: ${b.what}` : ''}`);
  else L.push('- none of your held or watched names is on the board');
  L.push('');
  L.push('BOARD CHANGES');
  if (!delta.known) L.push('- the previous session’s board is not stored, so new / dropped cannot be shown');
  else {
    L.push(`- new today (${delta.newToday.length}): ${delta.newToday.join(', ') || 'none'}`);
    L.push(`- dropped off since the last session (${delta.dropped.length}): ${delta.dropped.join(', ') || 'none'}`);
  }
  L.push(`- on the board ${SUSTAINED_MIN_SESSIONS}+ sessions in a row: ${delta.sustained.map((s) => `${s.ticker} (${s.sessions})`).join(', ') || 'none'}`);
  L.push('');
  L.push('NAMES WITH A FILED EVENT — ranked by the evidence, not by the size of the move');
  if (!evidence.length) L.push('- none found in the researched names');
  evidence.slice(0, TEXT_ROWS).forEach((x, i) => {
    L.push(`${i + 1}. ${x.ticker} ${x.company !== x.ticker ? `(${x.company}) ` : ''}${pct(x.movePct)} · ${crore(x.marketCap)} · ${x.statusLabel.toUpperCase()}`);
    if (x.what) L.push(`   What happened: ${x.what}`);
    if (x.why) L.push(`   Why look: ${x.why}`);
  });
  if (evidence.length > TEXT_ROWS) L.push(`… and ${evidence.length - TEXT_ROWS} more in the email table`);
  L.push('');
  L.push(`MOVING WITH NO COMPANY FILING FOUND (${noFiling.length}): ${noFiling.map((x) => `${x.ticker} ${pct(x.movePct)}`).join(', ') || 'none'}`);
  if (failed.length) L.push(`FILING SOURCE FAILED — not the same as "nothing found" (${failed.length}): ${failed.map((x) => x.ticker).join(', ')}`);
  L.push(`NOT YET RESEARCHED (${unresearched.length}): ${unresearched.map((x) => `${x.ticker} ${pct(x.movePct)}`).join(', ') || 'none'}`);
  L.push('');
  L.push('How to read: a filed event is the start of the research, not a call. "No company filing found" is a real finding — most names that rise on a day have none. No price targets here.');
  const text = L.join('\n').replace(/</g, '‹');

  // HTML (email): light background, dark text, every link an anchor with a short label
  const td = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top;font-size:13px;color:#111827';
  const th = 'padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;font-size:12px;color:#374151;background:#f9fafb';
  const chip = (s: PrimaryStatus, label: string) => `<span style="color:${COLORS[s]};font-weight:600">${esc(label)}</span>`;
  const list = (xs: string[]) => esc(xs.join(', ') || 'none');
  const H: string[] = [];
  H.push('<div style="background:#ffffff;color:#111827;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;max-width:1000px">');
  H.push(`<h2 style="margin:0 0 6px 0;font-size:20px;color:#111827">${esc(subject)}</h2>`);
  H.push(`<p style="margin:0 0 4px 0">${esc(closing)} India small and mid caps only (under ₹30,000 Cr; unknown size kept).</p>`);
  H.push(`<p style="margin:0 0 8px 0;font-weight:600">${esc(coverageLine)}</p>`);
  if (opts.partial) H.push(`<p style="margin:0 0 8px 0;color:#b91c1c;font-weight:600">PARTIAL: ${esc(opts.note ? neutralText(opts.note, 200) : 'the research sweep had not finished by the last send time.')}</p>`);
  H.push('<h3 style="font-size:15px;margin:14px 0 4px 0">Your book on the board</h3>');
  H.push(book.length ? `<ul style="margin:0;padding-left:18px">${book.map((b) => `<li><b>${esc(b.ticker)}</b> (${b.held ? 'held' : 'watchlist'}) ${esc(pct(b.movePct))} — ${chip(b.status, b.statusLabel)}${b.what ? `: ${esc(b.what)}` : ''}</li>`).join('')}</ul>` : '<p style="margin:0">None of your held or watched names is on the board.</p>');
  H.push('<h3 style="font-size:15px;margin:14px 0 4px 0">Board changes</h3><ul style="margin:0;padding-left:18px">');
  if (!delta.known) H.push('<li>The previous session’s board is not stored, so new / dropped cannot be shown.</li>');
  else H.push(`<li>New today (${delta.newToday.length}): ${list(delta.newToday)}</li><li>Dropped off since the last session (${delta.dropped.length}): ${list(delta.dropped)}</li>`);
  H.push(`<li>On the board ${SUSTAINED_MIN_SESSIONS}+ sessions in a row: ${list(delta.sustained.map((s) => `${s.ticker} (${s.sessions})`))}</li></ul>`);
  H.push('<h3 style="font-size:15px;margin:14px 0 4px 0">Ranked board — by the evidence, not by the size of the move</h3>');
  H.push(`<table style="border-collapse:collapse;width:100%;background:#ffffff"><tr><th style="${th}">#</th><th style="${th}">Company</th><th style="${th}">Move</th><th style="${th}">Size</th><th style="${th}">Verdict</th><th style="${th}">What happened</th><th style="${th}">Why look</th><th style="${th}">Source</th></tr>`);
  ranked.forEach((x, i) => {
    H.push(`<tr><td style="${td}">${i + 1}</td><td style="${td}"><b>${esc(x.ticker)}</b>${x.company !== x.ticker ? `<br><span style="color:#4b5563">${esc(x.company)}</span>` : ''}${x.held ? ' <span style="color:#047857">● held</span>' : x.watched ? ' <span style="color:#1d4ed8">● watch</span>' : ''}</td><td style="${td}">${esc(pct(x.movePct))}</td><td style="${td}">${esc(crore(x.marketCap))}</td><td style="${td}">${chip(x.status, x.statusLabel)}</td><td style="${td}">${esc(x.what || '—')}</td><td style="${td}">${esc(x.why || '—')}</td><td style="${td}">${x.sourceUrl ? `<a href="${href(x.sourceUrl)}" style="color:#1d4ed8">filing</a>` : '—'}</td></tr>`);
  });
  if (!ranked.length) H.push(`<tr><td style="${td}" colspan="8">No researched names yet.</td></tr>`);
  H.push('</table>');
  if (failed.length) H.push(`<p style="margin:8px 0 0 0"><b>Filing source failed</b> (not the same as “nothing found”): ${list(failed.map((x) => x.ticker))}</p>`);
  H.push(`<p style="margin:8px 0 0 0"><b>Not yet researched (${unresearched.length})</b> — not scored, not ranked: ${list(unresearched.map((x) => `${x.ticker} ${pct(x.movePct)}`))}</p>`);
  H.push(`<p style="margin:12px 0 0 0;color:#4b5563;font-size:12px">How to read: a filed event is the start of the research, not a call. “No catalyst found” is a real finding — most names that rise on a day have none. No price targets here. Ranked by research priority from the stored filings, never by the size of the move.${appLink ? ` Full cards: <a href="${href(appLink)}" style="color:#1d4ed8">AI Daily Gainers</a>.` : ''}</p>`);
  H.push('</div>');
  return { subject, text, html: H.join(''), partial: opts.partial, rows, coverageLine };
}

// ── scheduler jobs (registered at the end of APP_JOBS in app-scheduler.ts; loaded lazily there) ─────────────────

/** Structural copy of app-scheduler's JobCtx / JobOutcome (type-only, so this file never imports the scheduler). */
interface Ctx {
  slot: Date; deadline: number;
  call: (path: string, opts?: { method?: 'GET' | 'POST'; body?: unknown; timeoutMs?: number; retry?: boolean; noRetryStatuses?: number[] }) => Promise<{ status: number; ok: boolean; json: any; text: string; error: string | null }>;
  sleep: (ms: number) => Promise<void>;
  log: (m: string) => void;
}
interface Outcome { ok: boolean; status: number; error?: string | null }
const failOf = (r: { status: number; text: string; error: string | null }, what: string): Outcome => ({ ok: false, status: r.status, error: r.error || `${what} HTTP ${r.status}${r.text ? `: ${r.text.slice(0, 300)}` : ''}` });

/** UTC hour:minute of the brief's last slot — the one that always sends (PARTIAL when incomplete). */
export const BRIEF_FINAL_SLOT = '31 13 * * 1-5';
export const isFinalBriefSlot = (slot: Date) => slot.getUTCHours() === 13 && slot.getUTCMinutes() === 31;

export async function gainersBriefJob(ctx: Ctx): Promise<Outcome> {
  const final = isFinalBriefSlot(ctx.slot);
  // 503 = no message channel set up / not delivered: an answer, not an outage (retrying would not change it)
  const r = await ctx.call(`/api/v1/cron/gainers-brief?final=${final ? 1 : 0}`, { method: 'POST', timeoutMs: 150_000, noRetryStatuses: [503] });
  if (!r.ok) return failOf(r, 'gainers-brief');
  ctx.log(`decision ${r.json?.decision ?? '?'} · sent ${r.json?.sent ?? '?'} · coverage ${r.json?.coverage ?? '?'}`);
  return { ok: true, status: r.status };
}

/**
 * India gainers backup sweep. GitHub's daily-research.yml (gainers-in, 10:50 UTC) is the main run because it pre-fetches
 * screener.in pages; GitHub's cron sometimes skips. When today's sweep is missing or stopped part-way and went quiet, the
 * app runs the same steps itself (no re-process: names already researched are kept). Model reads stay inside the
 * research route's own daily ceiling (70 a day for India), so this never adds spend beyond a normal day.
 */
export async function gainersInBackupJob(ctx: Ctx, now: () => Date = () => new Date()): Promise<Outcome> {
  const g = await ctx.call('/api/v1/ai-gainers/research?market=IN', { timeoutMs: 90_000 });
  if (!g.ok || !g.json) return failOf(g, 'ai-gainers/research');
  const d = backupDecision(g.json, now());
  if (d !== 'run') { ctx.log(`no backup needed: ${d}`); return { ok: true, status: 200 }; }
  const scan = await ctx.call('/api/v1/ai-gainers?market=IN&limit=15&fresh=1', { timeoutMs: 120_000 });
  if (!scan.ok || !scan.json) return failOf(scan, 'ai-gainers');
  const scanned: any[] = Array.isArray(scan.json.scanned) ? scan.json.scanned : [];
  if (!scanned.length) { ctx.log('no India gainers list was read — nothing researched'); return { ok: true, status: 200 }; }
  const rows = scanned.map((x) => ({ ticker: x.ticker, company: x.company, move_pct: x.move_pct, volume: x.volume ?? null, price: x.price ?? null, market_cap: x.market_cap ?? null, perf: x.perf ?? null, filed_result: !!x.matched }));
  let last: any = null;
  for (let i = 0; i < 30; i++) {
    if (Date.now() >= ctx.deadline) break;
    const j = await ctx.call('/api/v1/ai-gainers/research', { method: 'POST', timeoutMs: 110_000, retry: false, body: { market: 'IN', rows: i === 0 ? rows : [], budget_ms: 40_000 } });
    if (!j.ok || !j.json) { await ctx.sleep(10_000); continue; }
    last = j.json;
    if (!last.remaining || last.researched_now === 0) break;
  }
  ctx.log(`backup sweep: board ${rows.length} names · remaining ${last?.remaining ?? '?'} · model reads today ${last?.model_reads ?? '?'}`);
  return { ok: true, status: 200 };
}
