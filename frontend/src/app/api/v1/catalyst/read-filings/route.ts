// ═══════════════════════════════════════════════════════════════════════════
// POST /api/v1/catalyst/read-filings — read a few filings for the
// "New · last 10 days" tab on Portfolio Catalysts (India + US).      (zzz813)
//
// Body: { market: 'IN' | 'US', items: [{ url, ticker, subject, date, company? }] }
// Answer: { reads: FilingRead[] } — one per item, in order.
//
// Each document is read ONCE: the result is cached per URL (KV, 60 days,
// versioned by FILING_READ_VERSION) and in memory. The PDF text itself is
// also cached by the shared extractor. A failed fetch is never cached in KV
// (the next visit tries again) and is remembered in memory for 30 minutes so
// a page reload does not hammer the exchange.
//
// Polite and bounded: at most 6 items per call, 2 at a time, 12 s per
// document, and the whole call ends by 45 s — anything not reached comes back
// "not reached in this pass" and the page asks again. Only exchange / SEC
// hosts are fetched. No model is called: the read is deterministic
// (lib/catalyst/filing-read).
// ═══════════════════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { kvGet, kvSet } from '@/lib/kv';
import { extractPdfText } from '@/lib/pdf-text-extractor';
import { fetchEdgarDocuments, htmlToText } from '@/lib/ai-gainers/edgar-research';
import { readFilingText, toFilingRead, filingReadVersion } from '@/lib/catalyst/filing-read';
import type { FilingRead } from '@/lib/catalyst/filing-read-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_ITEMS = 6;
const CONCURRENCY = 2;
const DOC_TIMEOUT_MS = 12_000;
const CALL_BUDGET_MS = 45_000;
const KV_TTL_S = 60 * 24 * 3600;
const FAIL_MEMO_MS = 30 * 60_000;

const ALLOWED_HOST = /(^|\.)(bseindia\.com|nseindia\.com|sec\.gov)$/i;

const mem = new Map<string, FilingRead>();
const failMemo = new Map<string, { at: number; read: FilingRead }>();

const keyOf = (url: string, market: 'IN' | 'US') => `pc-filing-read:${filingReadVersion(market)}:${createHash('sha1').update(url.trim()).digest('hex').slice(0, 20)}`;

/** Exchange / SEC hosts, or a company's own published PDF (screener.in concall links point there).
 *  Never a bare IP, localhost or an internal name. */
function allowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (ALLOWED_HOST.test(u.hostname)) return true;
    const h = u.hostname.toLowerCase();
    if (!h.includes('.') || /^\d+(\.\d+){3}$/.test(h) || h.includes(':') || /(^|\.)(localhost|local|internal|lan)$/.test(h)) return false;
    return /\.pdf$/i.test(u.pathname);
  } catch { return false; }
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | null = null;
  const timer = new Promise<T>((res) => { t = setTimeout(() => res(fallback), ms); });
  try { return await Promise.race([p, timer]); } finally { if (t) clearTimeout(t); }
}

async function indiaText(url: string): Promise<{ text: string; failure: string | null }> {
  const isPdf = /\.pdf(?:$|\?)/i.test(url) || /AttachLive|AttachHis|corporate\//i.test(url);
  if (isPdf) {
    const ext = await extractPdfText(url, { timeoutMs: DOC_TIMEOUT_MS });
    if (ext.source === 'FAILED') return { text: '', failure: ext.failure_reason || 'download failed' };
    if (!ext.text || ext.text.length < 200) return { text: ext.text || '', failure: 'no readable text in the document (scanned image or empty)' };
    return { text: ext.text, failure: null };
  }
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), DOC_TIMEOUT_MS);
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36', Accept: 'text/html,application/pdf,*/*' } });
    clearTimeout(t);
    if (!r.ok) return { text: '', failure: `HTTP ${r.status}` };
    const ct = r.headers.get('content-type') || '';
    if (/pdf/i.test(ct)) {
      const ext = await extractPdfText(url, { timeoutMs: DOC_TIMEOUT_MS });
      return ext.source === 'FAILED' ? { text: '', failure: ext.failure_reason || 'download failed' } : { text: ext.text, failure: ext.text.length < 200 ? 'no readable text' : null };
    }
    const text = htmlToText((await r.text()).slice(0, 2_000_000));
    return { text, failure: text.length < 200 ? 'no readable text on the page' : null };
  } catch (e: any) {
    return { text: '', failure: e?.name === 'AbortError' ? 'timed out' : (e?.message || 'fetch failed') };
  }
}

async function usText(url: string): Promise<{ text: string; failure: string | null }> {
  const docs = await fetchEdgarDocuments(url, DOC_TIMEOUT_MS).catch(() => []);
  if (!docs.length) return { text: '', failure: 'SEC EDGAR did not return the filing' };
  const ex = docs.find((d) => d.role === 'ex99');
  const primary = docs.find((d) => d.role === 'primary');
  // the press release carries the story; the 8-K body names the items
  const text = [ex?.text || '', primary?.text?.slice(0, 6_000) || ''].filter(Boolean).join(' ');
  return { text, failure: text.length < 200 ? 'no readable text in the filing' : null };
}

interface Item { url: string; ticker: string; subject: string; date: string | null; company: string | null }

async function readOne(it: Item, market: 'IN' | 'US'): Promise<FilingRead> {
  const k = keyOf(it.url, market);
  const ver = filingReadVersion(market);
  const m = mem.get(k);
  if (m) return m;
  const f = failMemo.get(k);
  if (f && Date.now() - f.at < FAIL_MEMO_MS) return f.read;
  try {
    const hit = await kvGet<FilingRead>(k);
    if (hit && hit.status === 'read' && hit.version === ver) { mem.set(k, hit); return hit; }
  } catch { /* cold cache */ }
  if (!allowed(it.url)) return toFilingRead(it.url, null, 'not an exchange, SEC or company PDF address — not fetched', new Date(), ver);
  const got = market === 'US' ? await usText(it.url) : await indiaText(it.url);
  if (got.failure) {
    const read = toFilingRead(it.url, null, got.failure, new Date(), ver);
    failMemo.set(k, { at: Date.now(), read });
    return read;
  }
  const core = readFilingText({ subject: it.subject, text: got.text, market, company: it.company, issuer: it.ticker, date: it.date, url: it.url });
  const read = toFilingRead(it.url, core, null, new Date(), ver);
  if (read.status === 'read') {
    mem.set(k, read);
    if (mem.size > 2000) mem.delete(mem.keys().next().value as string);
    try { await kvSet(k, read, KV_TTL_S); } catch { /* memory still holds it */ }
  }
  return read;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  let body: any = null;
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'body must be JSON' }, { status: 400 }); }
  const market: 'IN' | 'US' = body?.market === 'US' ? 'US' : 'IN';
  const items: Item[] = (Array.isArray(body?.items) ? body.items : []).slice(0, MAX_ITEMS)
    .filter((x: any) => x && typeof x.url === 'string' && x.url.length < 1000)
    .map((x: any) => ({ url: String(x.url), ticker: String(x.ticker || '').toUpperCase().slice(0, 24), subject: String(x.subject || '').slice(0, 400), date: x.date ? String(x.date).slice(0, 10) : null, company: x.company ? String(x.company).slice(0, 120) : null }));
  if (!items.length) return NextResponse.json({ ok: true, reads: [] });

  const out: FilingRead[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      const left = CALL_BUDGET_MS - (Date.now() - t0);
      if (left < 3_000) { out[i] = toFilingRead(items[i].url, null, 'not reached in this pass — will retry', new Date(), filingReadVersion(market)); continue; }
      out[i] = await withTimeout(readOne(items[i], market), Math.min(left - 1_000, DOC_TIMEOUT_MS * 2 + 2_000),
        toFilingRead(items[i].url, null, 'timed out reading the document — will retry', new Date(), filingReadVersion(market)));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return NextResponse.json({ ok: true, market, version: filingReadVersion(market), reads: out, ms: Date.now() - t0 },
    { headers: { 'Cache-Control': 'no-store' } });
}
