// ═══════════════════════════════════════════════════════════════════════════
// SEC EDGAR RETRIEVAL FOR THE US THESIS READER.                      (zzz790)
//
// Server-only network half of lib/us-thesis/adapter. SEC fair access: every
// request carries the declared User-Agent (SEC_USER_AGENT, the same default
// every other EDGAR caller in this repo uses) and requests from this process
// are spaced ≥ 125 ms apart (the SEC ceiling is 10/second).
//
// Filing lists come from the shared cached helpers in lib/us-edgar
// (tickerToCik, submissions, companyFacts); the earnings release is resolved
// by lib/us-guidance releaseDocument (ranked EX-99.1 with a picture check).
// Only the 10-Q / 10-K primary document is fetched here, because the shared
// text helpers cap at 60k characters and the MD&A of a 10-K sits past that.
// ═══════════════════════════════════════════════════════════════════════════

import { releaseDocument } from '@/lib/us-guidance';
import { usHtmlToText, mdnaSection, looksLikeUsEarningsRelease, type UsDocCandidate } from './adapter';

const SEC_UA = process.env.SEC_USER_AGENT || 'market-cockpit research radhev.232@gmail.com';
const SPACING_MS = 125;
let last = 0;

async function secFetch(url: string, timeoutMs = 15_000): Promise<Response | null> {
  const wait = last + SPACING_MS - Date.now();
  last = Math.max(Date.now(), last + SPACING_MS);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  try {
    return await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: '*/*', 'Accept-Encoding': 'gzip, deflate' }, cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
  } catch { return null; }
}

export interface UsReadDoc {
  cand: UsDocCandidate;
  outcome: 'read' | 'download_failed' | 'too_short';
  text: string;
  docUrl: string | null;
  detail?: string;
}

/** The primary document of a periodic filing: the largest .htm that is not an exhibit. */
async function primaryDocUrl(indexUrl: string): Promise<string | null> {
  const dir = indexUrl.replace(/\/[^/]*$/, '');
  const r = await secFetch(`${dir}/index.json`);
  if (!r || !r.ok) return null;
  try {
    const j: any = await r.json();
    const items: any[] = j?.directory?.item || [];
    const htm = items.filter((it) => /\.htm(l)?$/i.test(String(it?.name || ''))
      && !/^R\d+\.htm/i.test(String(it.name)) && !/index/i.test(String(it.name))
      && !/(^|[-_])ex[-_]?\d|exhibit|ex\d{2,}/i.test(String(it.name)));
    htm.sort((a, b) => (parseInt(String(b.size), 10) || 0) - (parseInt(String(a.size), 10) || 0));
    return htm[0] ? `${dir}/${htm[0].name}` : null;
  } catch { return null; }
}

/** Read one candidate. Never throws; the outcome says what happened. */
export async function readUsDocument(cik: number, c: UsDocCandidate, budget: number): Promise<UsReadDoc> {
  if (c.role === 'release') {
    const doc = await releaseDocument(cik, c.accession, c.url).catch(() => ({ url: null, html: null }));
    if (!doc.html) return { cand: c, outcome: 'download_failed', text: '', docUrl: null, detail: 'EX-99.1 could not be downloaded from EDGAR' };
    const text = usHtmlToText(doc.html);
    if (text.length < 800 || !looksLikeUsEarningsRelease(text)) {
      return { cand: c, outcome: 'too_short', text: '', docUrl: doc.url, detail: text.length < 800 ? 'the exhibit carries no readable text (image or empty)' : 'the exhibit is not an earnings release' };
    }
    return { cand: c, outcome: 'read', text: text.slice(0, Math.max(0, budget)), docUrl: doc.url };
  }
  const url = await primaryDocUrl(c.url);
  if (!url) return { cand: c, outcome: 'download_failed', text: '', docUrl: null, detail: 'the filing index could not be read' };
  const r = await secFetch(url, 25_000);
  if (!r || !r.ok) return { cand: c, outcome: 'download_failed', text: '', docUrl: url, detail: `EDGAR answered ${r ? `HTTP ${r.status}` : 'nothing'}` };
  let html = '';
  try { html = await r.text(); } catch { html = ''; }
  const text = mdnaSection(usHtmlToText(html), c.form, Math.min(70_000, Math.max(0, budget)));
  if (text.length < 1200) return { cand: c, outcome: 'too_short', text: '', docUrl: url, detail: 'no readable MD&A text' };
  return { cand: c, outcome: 'read', text, docUrl: url };
}
