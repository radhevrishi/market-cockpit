// zzz861 — the missing link between the subject-only filings QUEUE and the guidance engine.
// Before: the queue worker fetched a filing, ran the regex extractor and (when numbers were not found) wrote a hand-off { docId }; but the AI extractor reads
// documents from the guidance-docs store, and nothing put these filings there, so the hand-off was a dead end and the universe never changed.
// Now: every filing the worker reads is turned into a GuidanceDoc and stored; the AI extractor then picks it up (same docId), and its result feeds the
// Guidance Universe. Pure builders here; the I/O is in `storeQueueDocs`. A filing whose host is not an exchange / SEC host is skipped (the store would refuse it).
import type { GuQueueItem } from './guidance-upgrades-types';
import type { DocFetchResult } from './guidance-upgrades-queue';
import type { GuidanceDoc, GuidanceDocKind } from './guidance-docs-types';
import { guidanceDocIdOf } from './us-edgar-backfill';
import { validateDoc, isExchangeHost } from './guidance-docs-store';

export const QUEUE_COLLECTOR = 'events-queue';
export function kindOfSource(sourceType: string, subject = ''): GuidanceDocKind {
  const t = `${sourceType} ${subject}`;
  return /transcript|con(?:ference)?\.? call/i.test(t) ? 'TRANSCRIPT' : /presentation|deck|investor meet/i.test(t) ? 'PRESENTATION' : /press release|earnings release|media release|8-?k|results|outcome/i.test(t) ? 'RESULTS_RELEASE' : /agm|annual general|chairman/i.test(t) ? 'AGM_SPEECH' : 'OTHER_COMPANY_DOC';
}
/** A raw document for the store's own validator (it re-checks host, ticker and text and picks the guidance passages). Null when the filing cannot be stored. */
export function docFromQueueRead(item: Pick<GuQueueItem, 'market' | 'ticker' | 'company' | 'source_url' | 'source_type' | 'subject' | 'event_date'>, doc: Pick<DocFetchResult, 'text' | 'resolvedUrl'>, now: Date): Record<string, unknown> | null {
  const url = doc.resolvedUrl || item.source_url; if (!url || !item.company) return null;
  let host = ''; try { host = new URL(url).hostname.toLowerCase(); } catch { return null; }
  if (!isExchangeHost(host)) return null;
  const tk = String(item.ticker || '').toUpperCase(); const ticker = /^[A-Z0-9&.\-_]{1,24}$/.test(tk) ? tk : null;
  const day = /^\d{4}-\d{2}-\d{2}/.test(item.event_date) ? item.event_date.slice(0, 10) : now.toISOString().slice(0, 10);
  return { docId: guidanceDocIdOf(url), market: item.market, ticker, company: item.company, kind: kindOfSource(item.source_type, item.subject), title: item.subject || item.source_type || 'filing',
    url, sourceHost: host, filedAt: `${day}T00:00:00.000Z`, periodHint: null, text: String(doc.text || ''), collectedAt: now.toISOString(), collector: QUEUE_COLLECTOR };
}
/** Validate and store the documents the worker read (bounded by the worker's own per-run cap). Never throws; returns counts. */
export async function storeQueueDocs(raws: Array<Record<string, unknown>>, now: Date): Promise<{ offered: number; stored: number; rejected: number }> {
  const ok: GuidanceDoc[] = []; let rejected = 0;
  for (const r of raws) { const v = validateDoc(r, QUEUE_COLLECTOR); if (v.ok) ok.push(v.doc); else rejected++; }
  if (!ok.length) return { offered: raws.length, stored: 0, rejected };
  try {
    const m = await import('./guidance-docs-store');
    const r = await m.ingestDocs({ collector: QUEUE_COLLECTOR, market: null, docs: ok, seen: [], status: null, coverage: null }, m.realDocsKv(), now);
    return { offered: raws.length, stored: r.stored, rejected };
  } catch { return { offered: raws.length, stored: 0, rejected: raws.length }; }
}
