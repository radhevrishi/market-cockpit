// zzz879 — the runner for the India results PDF backup (see lib/india-results-pdf.ts).
// Called by POST /api/v1/results-pdf (hourly GitHub job). Every network / KV / model
// step is injected so the run can be tested without any of them.
import {
  RP_QUEUE_KEY, RP_STATUS_KEY, RP_LOCK_KEY, RP_HAVE_KEY, RP_RESULT_KEY, RP_LATEST_KEY, RP_FAIL_KEY, RP_RESULT_TTL_S, RP_QUEUE_TTL_S, RP_MAX_TRIES, RP_MODEL, RP_FEATURE,
  RESULTS_TOOL, RESULTS_SYSTEM, resultsUserPrompt, resultsExcerpt, looksLikeResultsText, checkResultsAnswer, dueItems, mergeQueue,
  type RpQueueItem, type RpRecord, type RpFail,
} from './india-results-pdf';

export interface RpKv {
  get: <T>(k: string) => Promise<T | null>;
  set: (k: string, v: unknown, ttl?: number) => Promise<void>;
  setNX: (k: string, v: unknown, ttl: number) => Promise<boolean>;
  del: (k: string) => Promise<void>;
  /** zzz1211 — optional batched read: the queue scan read 2 keys per queued company on every run (~600 commands a run). */
  mget?: <T>(keys: string[]) => Promise<Array<T | null>>;
}
export interface RpDeps {
  kv: RpKv;
  /** Screener's newest quarter end for the ticker (via enrich), or null when unknown. */
  screenerQuarter: (ticker: string, filed: string) => Promise<string | null>;
  /** Candidate results-PDF URLs for the filing, best first. */
  findDocs: (item: RpQueueItem) => Promise<string[]>;
  readPdf: (url: string) => Promise<{ text: string; failure?: string | null }>;
  callModel: (req: { system: string; user: string }) => Promise<{ ok: true; raw: unknown; costUsd: number; model: string } | { ok: false; kind: string; message: string }>;
  /** Re-grade one India day after new figures landed (the names first re-read with no cache). */
  regrade: (date: string, tickers: string[]) => Promise<void>;
  now?: () => Date;
}
export interface RpRunOptions { maxItems?: number; maxUsd?: number; budgetMs?: number; /** zzz1221 — names read at once (default 4) */ concurrency?: number }
export interface RpOutcome { ticker: string; want: string; outcome: 'read' | 'screener_caught_up' | 'no_document' | 'not_readable' | 'rejected' | 'model_error' | 'spend_cap'; detail: string; costUsd?: number }
export interface RpRunSummary { ok: boolean; skipped?: string; queued: number; due: number; outcomes: RpOutcome[]; spentUsd: number; regraded: string[] }

export async function runResultsPdf(d: RpDeps, o: RpRunOptions = {}): Promise<RpRunSummary> {
  const maxItems = o.maxItems ?? 12, maxUsd = o.maxUsd ?? 0.3, budget = o.budgetMs ?? 200_000;
  const now = d.now ? d.now() : new Date();
  const t0 = Date.now();
  const got = await d.kv.setNX(RP_LOCK_KEY, now.toISOString(), 300).catch(() => false);   // zzz882: unconfirmed lock = skip (no double AI spend)
  if (!got) return { ok: true, skipped: 'another run is in progress', queued: 0, due: 0, outcomes: [], spentUsd: 0, regraded: [] };
  try {
    const queue = mergeQueue(await d.kv.get<RpQueueItem[]>(RP_QUEUE_KEY), []);
    const done = new Set<string>(); const fails = new Map<string, RpFail>();
    if (d.kv.mget) {
      for (let i = 0; i < queue.length; i += 100) {
        const part = queue.slice(i, i + 100);
        const keys = part.flatMap((q) => [RP_RESULT_KEY(q.ticker, q.want), RP_FAIL_KEY(q.ticker, q.want)]);
        const vals = await d.kv.mget<any>(keys).catch(() => keys.map(() => null));
        part.forEach((q, j) => {
          const k = `${q.ticker}|${q.want}`;
          const have = vals[2 * j] as RpRecord | null, f = vals[2 * j + 1] as RpFail | null;
          if (have && (have as any).quotes) done.add(k);
          if (f) fails.set(k, f);
        });
      }
    } else for (const q of queue) {
      const k = `${q.ticker}|${q.want}`;
      // zzz898: a record read before row quotes were stored is re-read once (it is not used for the overlay)
      const have = await d.kv.get<RpRecord>(RP_RESULT_KEY(q.ticker, q.want));
      if (have && (have as any).quotes) done.add(k);
      const f = await d.kv.get<RpFail>(RP_FAIL_KEY(q.ticker, q.want));
      if (f) fails.set(k, f);
    }
    const due = dueItems(queue, done, fails, now.getTime());
    const outcomes: RpOutcome[] = []; const regrade = new Map<string, Set<string>>(); let spent = 0;
    const mark = (date: string, t: string) => { const s = regrade.get(date) || new Set<string>(); s.add(t); regrade.set(date, s); };
    const resolved = new Set<string>(done);
    const fail = async (q: RpQueueItem, outcome: RpOutcome['outcome'], detail: string, costUsd = 0) => {
      const k = `${q.ticker}|${q.want}`; const prev = fails.get(k);
      const rec: RpFail = { at: now.toISOString(), tries: (prev?.tries || 0) + 1, reason: detail };
      await d.kv.set(RP_FAIL_KEY(q.ticker, q.want), rec, 60 * 86_400).catch(() => {});
      if (rec.tries >= RP_MAX_TRIES) resolved.add(k);   // gave up: leaves the queue, the fail record says why
      outcomes.push({ ticker: q.ticker, want: q.want, outcome, detail, costUsd });
    };
    // zzz1221 — names are read 4 at a time: one at a time, a results day (50+ filed names) got through ~7 an hour
    // (each name waits on Screener, the exchange feeds and the PDF), so filed companies said "figures being read" for hours.
    let stop = false;
    const one = async (q: RpQueueItem): Promise<void> => {
      const k = `${q.ticker}|${q.want}`;
      // 1. Screener caught up → no AI spent
      const sq = await d.screenerQuarter(q.ticker, q.filed).catch(() => null);
      if (sq && sq >= q.want) { resolved.add(k); outcomes.push({ ticker: q.ticker, want: q.want, outcome: 'screener_caught_up', detail: `Screener now has the quarter ending ${sq}` }); mark(q.filed, q.ticker); return; }
      // 2. the results PDF
      const urls = await d.findDocs(q).catch(() => [] as string[]);
      if (!urls.length) { await fail(q, 'no_document', 'no results PDF found for this filing on NSE / BSE'); return; }
      let text = ''; let url = ''; const why: string[] = [];
      for (const u of urls.slice(0, 4)) {
        const r = await d.readPdf(u).catch((e: any) => ({ text: '', failure: String(e?.message || e) }));
        if (looksLikeResultsText(r.text)) { text = r.text; url = u; break; }
        why.push(r.failure || (r.text ? 'not a results statement' : 'no text (scanned or empty PDF)'));
      }
      if (!text) { await fail(q, 'not_readable', `results PDF could not be read: ${why.slice(0, 2).join('; ')}`); return; }
      if (stop || spent >= maxUsd) return;
      // 3. the model copies the figures; every figure is checked against the PDF text
      const excerpt = resultsExcerpt(text);
      const nonce = Math.random().toString(36).slice(2, 10);
      const m = await d.callModel({ system: RESULTS_SYSTEM, user: resultsUserPrompt(q.ticker, q.want, excerpt, nonce) });
      if (!m.ok) {
        if (m.kind === 'spend_cap' || m.kind === 'no_key') { outcomes.push({ ticker: q.ticker, want: q.want, outcome: 'spend_cap', detail: m.message }); stop = true; return; }
        await fail(q, 'model_error', m.message); return;
      }
      spent += m.costUsd;
      const chk = checkResultsAnswer(m.raw, { ticker: q.ticker, want: q.want, filed: q.filed, docText: excerpt, url, model: m.model, now });
      if (!chk.ok) { await fail(q, 'rejected', chk.reason, m.costUsd); return; }
      const rec: RpRecord = chk.record;
      await d.kv.set(RP_RESULT_KEY(q.ticker, q.want), rec, RP_RESULT_TTL_S);
      await d.kv.set(RP_LATEST_KEY(q.ticker), rec, RP_RESULT_TTL_S);
      resolved.add(k); mark(q.filed, q.ticker);
      outcomes.push({ ticker: q.ticker, want: q.want, outcome: 'read', detail: `revenue ₹${rec.sales_curr_cr} Cr (${rec.basis})`, costUsd: m.costUsd });
    };
    const work = due.slice(0, maxItems);
    let next = 0;
    const lane = async () => {
      while (next < work.length) {
        if (stop || Date.now() - t0 > budget || spent >= maxUsd) return;
        const q = work[next++];
        try { await one(q); } catch { /* one name never stops the run */ }
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(8, o.concurrency ?? 4)) }, lane));
    // zzz1211 — the list of tickers with a stored record (always written, so readers know the list exists)
    {
      const prevHave = await d.kv.get<string[]>(RP_HAVE_KEY).catch(() => null);
      const have = new Set<string>(Array.isArray(prevHave) ? prevHave : []);
      for (const o of outcomes) if (o.outcome === 'read') have.add(o.ticker);
      await d.kv.set(RP_HAVE_KEY, Array.from(have).slice(-3000), RP_RESULT_TTL_S).catch(() => {});
    }
    // the queue keeps only what is still open
    const left = queue.filter((q) => !resolved.has(`${q.ticker}|${q.want}`));
    await d.kv.set(RP_QUEUE_KEY, left, RP_QUEUE_TTL_S);
    const regraded: string[] = [];
    for (const date of Array.from(regrade.keys()).sort()) {
      if (Date.now() - t0 > budget + 60_000) break;
      try { await d.regrade(date, Array.from(regrade.get(date) || [])); regraded.push(date); } catch { /* the day re-grades on its next refresh */ }
    }
    const summary: RpRunSummary = { ok: true, queued: left.length, due: due.length, outcomes, spentUsd: Math.round(spent * 10000) / 10000, regraded };
    await d.kv.set(RP_STATUS_KEY, { at: now.toISOString(), ...summary }, 30 * 86_400).catch(() => {});
    return summary;
  } finally {
    await d.kv.del(RP_LOCK_KEY).catch(() => {});
  }
}

/** The graded route adds names it holds back for "new quarter not on Screener yet" (a confirmed filing only). */
export async function enqueueResultsPdf(kv: Pick<RpKv, 'get' | 'set'>, items: RpQueueItem[]): Promise<void> {
  if (!items.length) return;
  const prev = await kv.get<RpQueueItem[]>(RP_QUEUE_KEY).catch(() => null);
  const next = mergeQueue(prev, items);
  if (JSON.stringify(next) !== JSON.stringify(prev || [])) await kv.set(RP_QUEUE_KEY, next, RP_QUEUE_TTL_S);
}

export { RESULTS_TOOL, RP_MODEL, RP_FEATURE };
