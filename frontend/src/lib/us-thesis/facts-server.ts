// ═══════════════════════════════════════════════════════════════════════════
// THE US GRADER ROWS, SERVER SIDE, IN ONE BOUNDED BATCH.              (zzz815)
//
// "Loading XBRL figures and stored SEC evidence for 116 companies…" never
// ended, and every card said "no SEC filer found" — for AKAM, ITW, TXN. Three
// causes, all closed here and in lib/us-edgar:
//   · the SEC ticker map was downloaded once PER NAME (and retried 3 × 20 s
//     when SEC was slow), so a batch of 20 could run for many minutes;
//   · a failed map download was read as "this ticker is not in the SEC list"
//     and cached for an hour as NO SEC FILER;
//   · the batch had no deadline: one hung name held the whole response.
// Now: the map is fetched once (shared, de-duplicated) and a failure is a
// RETRIEVAL FAILURE ("SEC request failed — retrying"), never cached; each
// name has its own time limit; the batch answers before the platform's
// limit with every name accounted for (a row, an absence, or a failure);
// cached rows are answered first without touching SEC.
// No price, no model.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import { cikForTicker, companyFacts, submissions, SecTickerMapError } from '@/lib/us-edgar';
import { usFactsResult } from './facts-row';
import { fetchCompanyFactsFresh } from './sec-docs';

// zzz829: v5 — a row carries the newest 10-Q / 10-K on EDGAR; a row whose XBRL quarter is older is re-fetched fresh
export const US_FACTS_KEY = (t: string) => `us-thesis:facts:v5:${t}`;
const TTL_ROW_S = 12 * 3600;
const TTL_NONE_S = 3600;

const hasStatements = (f: any) => !!(f?.facts?.['us-gaap'] || f?.facts?.['ifrs-full']);

/** The honest per-name failure line. Never "no SEC filer". */
export function usFactsFailure(t: string, detail: string): Record<string, any> {
  return { ticker: t, requested: t, market: 'US', source: 'none', retrieval_failed: true, us_profile: null,
    why: `SEC request failed — retrying (${detail}). This is a retrieval failure, not a finding about the company.` };
}

/** "no SEC filer" — only when the ticker map is loaded and lacks every spelling. */
export function usNoFilerRow(t: string, tried: string[]): Record<string, any> {
  return { ticker: t, requested: t, market: 'US', source: 'none', no_filer: true, us_profile: null,
    why: `${t} is not in SEC's company ticker list (checked ${tried.join(', ')}) — no SEC filer, so there are no SEC figures to read` };
}

/** Every dependency of one name's row, injectable for tests. */
export interface UsFactsDeps {
  cik: (t: string) => Promise<{ cik: number | null; tried: string[] }>;
  submissions: (cik: number) => Promise<any | null>;
  companyFacts: (cik: number) => Promise<any | null>;
  companyFactsFresh: (cik: number) => Promise<any | null>;
  kvGet: (k: string) => Promise<any>;
  kvSet: (k: string, v: any, ttl: number) => Promise<any>;
}

export const liveUsFactsDeps: UsFactsDeps = {
  cik: (t) => cikForTicker(t),
  submissions: (c) => submissions(c),
  companyFacts: (c) => companyFacts(c),
  companyFactsFresh: (c) => fetchCompanyFactsFresh(c),
  kvGet: (k) => kvGet<any>(k),
  kvSet: (k, v, ttl) => kvSet(k, v, ttl),
};

/** Pure (zzz829): the newest periodic report (10-Q / 10-K / 20-F / 40-F) in a submissions list. */
export function latestPeriodic(recent: Array<{ form: string; filingDate: string; reportDate?: string | null }> | null | undefined): { form: string; filed: string; report_date: string | null } | null {
  let best: { form: string; filed: string; report_date: string | null } | null = null;
  for (const r of recent || []) {
    if (!/^(?:10-Q|10-K|20-F|40-F)(?:\/A)?$/i.test(String(r?.form || '')) || /\/A$/i.test(String(r.form))) continue;
    if (!best || String(r.filingDate) > best.filed) best = { form: String(r.form), filed: String(r.filingDate), report_date: r.reportDate ? String(r.reportDate) : null };
  }
  return best;
}

/** Pure (zzz829): the row's XBRL quarter is older than the newest 10-Q / 10-K on EDGAR — the words for the card, or null. */
export function xbrlBehindNote(row: { q_end?: string | null; period?: string | null } | null | undefined, latest: { form: string; filed: string; report_date: string | null } | null): string | null {
  const q = String(row?.q_end || '').slice(0, 10);
  const r = String(latest?.report_date || '').slice(0, 10);
  if (!q || !r || !/^\d{4}-\d{2}-\d{2}$/.test(q) || !/^\d{4}-\d{2}-\d{2}$/.test(r)) return null;
  if (Date.parse(r) - Date.parse(q) <= 10 * 86_400_000) return null;
  return `the ${latest!.form} for the period ended ${r} (filed ${latest!.filed}) is on EDGAR, but its XBRL figures are not in the SEC data yet — these are the latest figures SEC serves`;
}

/** Pure (zzz829): a cached row is stale when a newer quarter should be (or is known to be) filed. */
export function usFactsRowStale(hit: any, now: number = Date.now()): boolean {
  if (!hit || hit.source !== 'sec-xbrl') return false;
  const at = Date.parse(String(hit.fetched_at || '')) || 0;
  const age = now - at;
  if (hit.xbrl_behind && age > 2 * 3600_000) return true;
  const q = Date.parse(String(hit.q_end || ''));
  return Number.isFinite(q) && now - q > 135 * 86_400_000 && age > 6 * 3600_000;
}

/** One name's row from the cache, or null (also null when stale — see usFactsRowStale). */
export async function cachedUsFactsRow(t: string, deps: UsFactsDeps = liveUsFactsDeps): Promise<any | null> {
  const hit = await deps.kvGet(US_FACTS_KEY(t)).catch(() => null);
  if (usFactsRowStale(hit)) return null;
  return hit && (hit.source === 'sec-xbrl' || (hit.source === 'none' && !hit.retrieval_failed)) ? { ...hit, cached: true } : null;
}

/** One name's row, fetched from SEC. Never throws. */
export async function fetchUsFactsRow(t: string, deps: UsFactsDeps = liveUsFactsDeps): Promise<any> {
  let found: { cik: number | null; tried: string[] };
  try { found = await deps.cik(t); } catch (e: any) {
    return usFactsFailure(t, e instanceof SecTickerMapError || e?.kind === 'sec-ticker-map-unavailable' ? "SEC's ticker list could not be downloaded" : String(e?.message || e).slice(0, 120));
  }
  if (!found.cik) {
    const none = usNoFilerRow(t, found.tried);
    await deps.kvSet(US_FACTS_KEY(t), none, TTL_NONE_S).catch(() => null);
    return none;
  }
  const cik = found.cik;
  const subs = await deps.submissions(cik).catch(() => null);
  const since = new Date(Date.now() - 460 * 86_400_000).toISOString().slice(0, 10);
  const forms: string[] = (subs?.recent || []).filter((r: any) => r.filingDate >= since).map((r: any) => r.form);
  let facts = await deps.companyFacts(cik).catch(() => null);
  // A copy with no financial statements, for a company that files 10-Q/10-K,
  // is a bad answer — fetch it again rather than report "no us-gaap facts".
  if (!hasStatements(facts) && forms.some((f) => /^(10-Q|10-K|20-F|40-F)/.test(f))) {
    facts = (await deps.companyFactsFresh(cik).catch(() => null)) || facts;
  }
  if (!facts && !subs) return usFactsFailure(t, 'SEC EDGAR did not answer');
  const meta = { cik, company: subs?.name || facts?.entityName || null, sic: subs?.sic || null, sicDescription: subs?.sicDescription || null, forms };
  let res = usFactsResult(t, facts, meta);
  // zzz829: the newest 10-Q / 10-K on EDGAR is for a later quarter than the XBRL row — fetch companyfacts fresh
  // (bypassing the in-memory copy); if SEC still serves the older quarter, the row says so
  const latest = latestPeriodic(subs?.recent || []);
  if (res.row && xbrlBehindNote(res.row, latest)) {
    const fresh = await deps.companyFactsFresh(cik).catch(() => null);
    if (hasStatements(fresh)) { facts = fresh; res = usFactsResult(t, facts, meta); }
  }
  const behind = res.row ? xbrlBehindNote(res.row, latest) : null;
  if (res.row) { res.row.latest_periodic = latest; res.row.xbrl_behind = behind; res.row.fetched_at = new Date().toISOString(); }
  const out = res.row ? { ...res.row, us_profile: res.profile }
    : facts ? { ticker: t, requested: t, market: 'US', source: 'none', why: res.why, us_profile: res.profile }
      : { ...usFactsFailure(t, 'SEC XBRL figures did not download'), us_profile: res.profile };
  if (facts) await deps.kvSet(US_FACTS_KEY(t), out, res.row ? TTL_ROW_S : TTL_NONE_S).catch(() => null);
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  let timer: any;
  try {
    return await Promise.race([p, new Promise<T>((res) => { timer = setTimeout(() => res(onTimeout()), ms); })]);
  } finally { clearTimeout(timer); }
}

export interface UsFactsBatchOpts { force?: boolean; concurrency?: number; perNameMs?: number; deadlineMs?: number }

/**
 * Rows for many names in one bounded pass: cache first (no SEC), then SEC
 * for the rest, `concurrency` at a time, each name inside `perNameMs`, the
 * whole pass inside `deadlineMs`. Every requested name is in the answer.
 */
export async function usFactsBatch(tickers: string[], opts: UsFactsBatchOpts = {}, deps: UsFactsDeps = liveUsFactsDeps): Promise<{ rows: Record<string, any>; cached: number; fetched: number; failed: number; not_reached: number }> {
  const t0 = Date.now();
  const deadline = opts.deadlineMs ?? 45_000;
  const perName = opts.perNameMs ?? 25_000;
  const rows: Record<string, any> = {};
  let cached = 0;
  const todo: string[] = [];
  if (!opts.force) {
    const hits = await Promise.all(tickers.map((t) => cachedUsFactsRow(t, deps).catch(() => null)));
    tickers.forEach((t, i) => { if (hits[i]) { rows[t] = hits[i]; cached++; } else todo.push(t); });
  } else todo.push(...tickers);
  let i = 0, fetched = 0, notReached = 0;
  const worker = async () => {
    while (i < todo.length) {
      const t = todo[i++];
      const left = deadline - (Date.now() - t0);
      if (left < 3_000) { rows[t] = usFactsFailure(t, 'not reached before this request\'s time limit'); notReached++; continue; }
      rows[t] = await withTimeout(fetchUsFactsRow(t, deps).catch((e: any) => usFactsFailure(t, String(e?.message || e).slice(0, 120))),
        Math.min(perName, left - 1_000), () => usFactsFailure(t, `SEC did not answer within ${Math.round(Math.min(perName, left - 1_000) / 1000)} s`));
      fetched++;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 6, todo.length)) }, worker));
  const failed = Object.values(rows).filter((r) => r?.retrieval_failed).length;
  return { rows, cached, fetched, failed, not_reached: notReached };
}
