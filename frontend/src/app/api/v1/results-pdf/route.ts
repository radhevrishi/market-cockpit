// zzz879 — India results PDF backup: run (POST, cron secret / service key) and status (GET).
// See lib/india-results-pdf.ts for what it does and why.
import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';
import { SITE_COOKIE, expectedToken, safeEqual, hasServiceKey } from '@/lib/site-auth';
import { runResultsPdf, RESULTS_TOOL, RP_MODEL, RP_FEATURE, type RpDeps, type RpKv } from '@/lib/india-results-pdf-run';
import { RP_QUEUE_KEY, RP_STATUS_KEY, type RpQueueItem } from '@/lib/india-results-pdf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://mc-scraper.radhev-232.workers.dev';
const RESULTS_SUBJECT = /financial result|results? for the (quarter|period)|outcome of (the )?board meeting|un-?audited|audited/i;
const NOT_RESULTS = /intimation|newspaper|advertisement|trading window|record date|investor (meet|call)|transcript/i;

async function authorised(req: NextRequest): Promise<boolean> {
  if (hasServiceKey(req.headers.get('x-cron-secret')) || hasServiceKey(req.headers.get('x-mc-key'))) return true;
  const want = await expectedToken();
  const got = req.cookies.get(SITE_COOKIE)?.value || '';
  return !!want && !!got && safeEqual(want, got);
}
const ipOf = (req: NextRequest) => req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'anon';

function realKv(timeoutMs = 5_000): RpKv {
  const race = <T,>(p: Promise<T>, fb: T): Promise<T> => Promise.race([p.catch(() => fb), new Promise<T>((r) => setTimeout(() => r(fb), timeoutMs))]);
  return {
    get: async <T,>(k: string) => { const m = await import('@/lib/kv'); return race(m.kvGet<T>(k), null); },
    set: async (k, v, ttl) => { const m = await import('@/lib/kv'); await race(m.kvSet(k, v, ttl), undefined); },
    setNX: async (k, v, ttl) => { const m = await import('@/lib/kv'); return race(m.kvSetNX(k, v, ttl), false); },
    del: async (k) => { const m = await import('@/lib/kv'); await race(m.kvDel(k), undefined); },
  };
}

async function feed(path: string): Promise<any[]> {
  try {
    const r = await fetch(`${CF_WORKER_URL}${path}`, { signal: AbortSignal.timeout(20_000) });
    if (!r.ok) return [];
    const j: any = await r.json();
    const a = Array.isArray(j) ? j : (j?.items || j?.data || j?.results || []);
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}
const shift = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const near = (a: string | null | undefined, b: string, days: number) => !!a && Math.abs(Date.parse(`${String(a).slice(0, 10)}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) <= days * 86_400_000;

function realDeps(origin: string): RpDeps {
  return {
    kv: realKv(),
    screenerQuarter: async (ticker, filed) => {
      const r = await fetch(`${origin}/api/v1/earnings/enrich?symbols=${encodeURIComponent(ticker)}&filed=${filed}&nocache=1`, { signal: AbortSignal.timeout(60_000), headers: { 'x-mc-key': process.env.CRON_SECRET || '' } });
      if (!r.ok) return null;
      const j: any = await r.json();
      const e = j?.data?.[ticker] || j?.data?.[ticker.toUpperCase()];
      return e?.latest_quarter_end_iso ? String(e.latest_quarter_end_iso).slice(0, 10) : null;
    },
    findDocs: async (q: RpQueueItem) => {
      const out: string[] = [];
      const add = (u: unknown) => { const s = String(u || ''); if (/^https:\/\//.test(s) && !out.includes(s)) out.push(s); };
      if (q.url && /\.pdf(\?|$)|AttachLive|AttachHis|nsearchives/i.test(q.url)) add(q.url);
      // NSE: the scraper worker's results feed for the filing day and the days around it
      const days = [q.filed, shift(q.filed, -1), shift(q.filed, 1), shift(q.filed, -2)];
      const lists = await Promise.all([feed('/api/results/latest'), ...days.map((d) => feed(`/api/results/day/${d}`))]);
      for (const f of lists.flat()) {
        if (String(f?.symbol || '').toUpperCase() !== q.ticker) continue;
        if (!near(f?.filing_date, q.filed, 3)) continue;
        if (NOT_RESULTS.test(String(f?.subject || '')) && !RESULTS_SUBJECT.test(String(f?.subject || ''))) continue;
        add(f?.attachment_url);
      }
      // BSE: the scrip's announcement list (a BSE-coded name has its code as the ticker)
      try {
        const { fetchBseAnnouncementsLite } = await import('@/lib/thesis/evidence-discovery');
        const bse = await fetchBseAnnouncementsLite(q.ticker, /^\d{6}$/.test(q.ticker) ? q.ticker : null, 30);
        for (const it of bse.items || []) {
          const subj = `${it.subject} ${it.summary || ''}`;
          if (!RESULTS_SUBJECT.test(subj) || (NOT_RESULTS.test(subj) && !/financial result/i.test(subj))) continue;
          if (!near(it.dateIso, q.filed, 3)) continue;
          add(it.url);
        }
      } catch { /* BSE unreachable: NSE candidates only */ }
      return out;
    },
    readPdf: async (url) => {
      const { extractPdfText } = await import('@/lib/pdf-text-extractor');
      const r = await extractPdfText(url, { maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000 });
      return { text: r.text || '', failure: r.failure_reason || null };
    },
    callModel: async ({ system, user }) => {
      const m = await import('@/lib/anthropic-meter');
      const body = { model: RP_MODEL, max_tokens: 700, temperature: 0, system, messages: [{ role: 'user' as const, content: user }], tools: [RESULTS_TOOL as any], tool_choice: { type: 'tool', name: RESULTS_TOOL.name } };
      let resp: Response;
      try { resp = await m.anthropicMessages(RP_FEATURE, body as any, { signal: AbortSignal.timeout(45_000) }); }
      catch (e: any) { return { ok: false, kind: 'error', message: e?.name === 'TimeoutError' ? 'model call timed out' : 'model call failed' }; }
      if (!resp.ok) {
        let type = ''; try { const j: any = await resp.json(); type = String(j?.error?.type || ''); } catch { /* status only */ }
        return { ok: false, kind: resp.status === 402 || type === 'spend_cap' ? 'spend_cap' : type === 'no_key' ? 'no_key' : 'error', message: `model HTTP ${resp.status}${type ? ` (${type})` : ''}` };
      }
      const j: any = await resp.json().catch(() => null);
      const model = m.activeModel(RP_MODEL);
      const tool = (Array.isArray(j?.content) ? j.content : []).find((b: any) => b?.type === 'tool_use' && b?.name === RESULTS_TOOL.name);
      if (!tool) return { ok: false, kind: 'error', message: j?.stop_reason === 'max_tokens' ? 'answer cut off' : 'no tool answer' };
      return { ok: true, raw: tool.input, costUsd: m.costOf(model, j?.usage), model };
    },
    regrade: async (date, tickers) => {
      // the names first, with no cache, so the new figures are in enrich before the day is rebuilt
      await fetch(`${origin}/api/v1/earnings/enrich?symbols=${tickers.map(encodeURIComponent).join(',')}&filed=${date}&nocache=1`, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      await fetch(`${origin}/api/v1/earnings/graded?date=${date}&force=1`, { signal: AbortSignal.timeout(120_000), headers: { 'x-mc-key': process.env.CRON_SECRET || '' } }).catch(() => null);
    },
  };
}

export async function GET(req: NextRequest) {
  if (!checkRateLimit(`results-pdf:get:${ipOf(req)}`, 30, 60_000).allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const kv = realKv();
  const [queue, status] = await Promise.all([kv.get<RpQueueItem[]>(RP_QUEUE_KEY), kv.get<any>(RP_STATUS_KEY)]);
  return NextResponse.json({ ok: true, queue: (queue || []).map((q) => ({ ticker: q.ticker, filed: q.filed, want: q.want })), lastRun: status }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  if (!(await authorised(req))) return NextResponse.json({ ok: false, error: 'login required' }, { status: 401, headers: NO_STORE });
  if (!checkRateLimit(`results-pdf:post:${ipOf(req)}`, 4, 60_000).allowed) return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: NO_STORE });
  const sp = new URL(req.url).searchParams;
  const maxItems = Math.max(1, Math.min(25, Number(sp.get('max_items')) || 12));
  const maxUsd = Math.max(0.01, Math.min(1, Number(sp.get('max_usd')) || 0.3));
  try {
    const out = await runResultsPdf(realDeps(new URL(req.url).origin), { maxItems, maxUsd, budgetMs: 150_000 });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 200) }, { status: 500, headers: NO_STORE });
  }
}
