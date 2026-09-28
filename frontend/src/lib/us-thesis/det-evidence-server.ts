// ═══════════════════════════════════════════════════════════════════════════
// US EVIDENCE READ WITHOUT AI — THE SEC HALF (server only).           (zzz815)
//
// For one company: its SEC filing list (cached), the latest quarter's 8-K
// earnings release (EX-99.1) and 10-Q / 10-K MD&A — the same documents and
// the same polite, User-Agent-carrying fetch the AI read uses (sec-docs) —
// read by the deterministic US reader, persisted to KV. No model, no price.
// Every document has a time limit; a name never takes longer than its budget.
// ═══════════════════════════════════════════════════════════════════════════

import { kvGet, kvSet } from '@/lib/kv';
import { cikForTicker, submissions } from '@/lib/us-edgar';
import { usCandidatesFromSubmissions, planUsRead } from './adapter';
import { readUsDocument } from './sec-docs';
import { buildUsDetEvidence, US_DET_KEY, type UsDetDoc, type UsDetEvidence } from './det-evidence';

const TTL_S = 7 * 24 * 3600;
const TTL_FAILED_S = 15 * 60;
const DOC_MS = 20_000;
const DOC_CHARS = 60_000;

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: any;
  try { return await Promise.race([p, new Promise<T>((res) => { t = setTimeout(() => res(fallback), ms); })]); } finally { clearTimeout(t); }
}

export async function loadUsDetEvidence(tickers: string[]): Promise<Record<string, UsDetEvidence>> {
  const out: Record<string, UsDetEvidence> = {};
  const hits = await Promise.all(tickers.map((t) => kvGet<UsDetEvidence>(US_DET_KEY(t)).catch(() => null)));
  tickers.forEach((t, i) => { if (hits[i]) out[t] = hits[i]!; });
  return out;
}

/** Read one company without AI and persist the record. Never throws. */
export async function runUsDetEvidence(ticker: string, budgetMs = 45_000): Promise<UsDetEvidence> {
  const t0 = Date.now();
  const left = () => budgetMs - (Date.now() - t0);
  const fail = (detail: string): UsDetEvidence => buildUsDetEvidence(ticker, [{ label: 'SEC EDGAR', url: null, outcome: 'download_failed', detail }], { period: null, filed: null });
  let rec: UsDetEvidence;
  try {
    const found = await cikForTicker(ticker);
    if (!found.cik) {
      rec = { ...buildUsDetEvidence(ticker, [], { period: null, filed: null }), note: `${ticker} is not in SEC's company ticker list — nothing to read` };
    } else {
      const subs = await submissions(found.cik);
      if (!subs) rec = fail('SEC EDGAR submissions did not answer');
      else {
        const all = usCandidatesFromSubmissions(subs.recent, found.cik, new Date());
        const plan = planUsRead(all, null);
        const docs: Array<UsDetDoc & { text?: string }> = [];
        for (const c of plan.docs) {
          if (left() < 4_000) { docs.push({ label: c.label, url: c.url, outcome: 'not_reached', detail: 'time budget reached' }); continue; }
          const r = await withTimeout(readUsDocument(found.cik, c, DOC_CHARS), Math.min(DOC_MS, left() - 1_000),
            { cand: c, outcome: 'download_failed' as const, text: '', docUrl: null, detail: `EDGAR did not answer within ${Math.round(DOC_MS / 1000)} s` });
          docs.push({ label: c.label, url: r.docUrl || c.url, outcome: r.outcome, chars: r.text.length, detail: r.detail || null, text: r.text });
        }
        rec = buildUsDetEvidence(ticker, docs, { period: plan.period, filed: plan.docs.map((d) => d.dateIso).sort().pop() || null, found: all.length });
      }
    }
  } catch (e: any) {
    rec = fail(e?.kind === 'sec-ticker-map-unavailable' ? "SEC's ticker list could not be downloaded" : String(e?.message || e).slice(0, 160));
  }
  await kvSet(US_DET_KEY(ticker), rec, rec.state === 'RETRIEVAL_FAILED' ? TTL_FAILED_S : TTL_S).catch(() => null);
  return rec;
}
