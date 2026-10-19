// zzz1132 (guidance retest R5) — two facts the AI-read event did not carry because its text was only the quoted guidance sentences:
// the NEXT RESULTS DATE the release gives, and TIMING / ONE-TIME effects behind a raise. Read from the stored document text once per
// document (no AI), kept in a small KV record for a year and in memory, then attached to the extract result. A document is read once,
// never on every page load. Server-only.
import type { GuidanceExtractResult } from './guidance-docs-types';
import { getDoc } from './guidance-docs-store';
import { kvMGet, kvSet } from './kv';
import { nextResultsDateIn, timingEffectsOf } from './guidance-upgrades';

export interface DocFacts { nextResultsDate: string | null; timing: string[] | null; v: number }
export const DOC_FACTS_VERSION = 1;
const KEY = (id: string) => `gu-docfacts:v${DOC_FACTS_VERSION}:${id}`;
const mem = new Map<string, DocFacts>();

/** The facts in one document's text (pure). */
export function docFactsOf(text: string | null | undefined, filedAt: string | null | undefined): DocFacts {
  return { nextResultsDate: nextResultsDateIn(text, String(filedAt || '').slice(0, 10)), timing: timingEffectsOf(text), v: DOC_FACTS_VERSION };
}

/** Attach facts to the results (in place copy). At most `budget` documents are read from the store per call; the rest come next time. */
export async function withDocFacts(results: GuidanceExtractResult[], opts: { budget?: number; read?: typeof getDoc } = {}): Promise<GuidanceExtractResult[]> {
  const need = results.filter((r) => r && r.status === 'ok' && !r.docFacts && /^[0-9a-f]{20}$/.test(r.docId));
  const missing = need.filter((r) => !mem.has(r.docId)).map((r) => r.docId);
  if (missing.length) {
    const got = await kvMGet<DocFacts>(missing.map(KEY)).catch(() => missing.map(() => null));
    missing.forEach((id, i) => { const f = got[i]; if (f && f.v === DOC_FACTS_VERSION) mem.set(id, f); });
  }
  const toRead = need.filter((r) => !mem.has(r.docId)).slice(0, opts.budget ?? 40);
  const read = opts.read ?? getDoc;
  for (let i = 0; i < toRead.length; i += 8) {
    await Promise.all(toRead.slice(i, i + 8).map(async (r) => {
      const d = await read(r.docId).catch(() => null);
      if (!d || typeof d.text !== 'string') return;
      const f = docFactsOf(d.text, r.filedAt);
      mem.set(r.docId, f);
      void kvSet(KEY(r.docId), f, 365 * 86_400).catch(() => {});
    }));
  }
  return results.map((r) => (r && !r.docFacts && mem.has(r.docId) ? { ...r, docFacts: mem.get(r.docId)! } : r));
}
