// zzz909 — GET /api/v1/guidance-diagnose?tickers=FCL,UFLEX&market=IN → for each company: which of its own documents the
// collector stored (kind, date, text size, extracted?), what the AI extractor filed from each (status, rows kept, rows dropped,
// row summaries), whether the events queue holds it (stage), and where it sits in the guidance universe (Active / review /
// claims / history, with the reasons). Answers "why is company X not on the guidance page?" in one call.
// PROTECTED (owner login or service key; the manual workflow guidance-diagnose.yml calls it with x-cron-secret). Read-only.
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvMGet } from '@/lib/kv';
import { DOCS_INDEX_KEY } from '@/lib/guidance-docs-store';
import { resultKey } from '@/lib/ai-guidance-extract';
import { QUEUE_KEY } from '@/lib/guidance-upgrades-queue';
import type { GuidanceDocIndex, GuidanceExtractResult } from '@/lib/guidance-docs-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const norm = (t: unknown) => String(t ?? '').toUpperCase().replace(/^(NSE|BSE):/, '').replace(/\.(NS|BO)$/, '').trim();
const nameKey = (s: unknown) => String(s ?? '').toLowerCase().replace(/\b(limited|ltd|india|the)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const tickers = Array.from(new Set(String(sp.get('tickers') || '').split(',').map(norm).filter((t) => /^[A-Z0-9][A-Z0-9&.\-]{0,19}$/.test(t)))).slice(0, 80);
  const names = String(sp.get('names') || '').split('|').map(nameKey).filter(Boolean);
  if (!tickers.length) return NextResponse.json({ ok: false, error: 'tickers=A,B required (max 80)' }, { status: 400 });
  const market = String(sp.get('market') || 'IN').toUpperCase() === 'US' ? 'US' : 'IN';

  const [index, queue, bundle] = await Promise.all([
    kvGet<GuidanceDocIndex>(DOCS_INDEX_KEY).catch(() => null),
    kvGet<any>(QUEUE_KEY).catch(() => null),
    (async () => { const s = await import('@/lib/guidance-universe-service'); return s.getUniverseBundle(Date.now()); })().catch(() => null),
  ]);
  const rows = (index?.rows || []).filter((r) => r.market === market);
  const lists: Array<[string, any[]]> = bundle ? [['active', bundle.build.defaultRecords ?? []], ['review', bundle.build.reviewQueue ?? []], ['claims', bundle.build.claimsAwaiting ?? []], ['inactive', (bundle.build as any).inactive ?? []], ['excluded', (bundle.build as any).excluded ?? []]] : [];

  const out: Record<string, unknown> = {};
  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i]; const nk = names[i] || '';
    const docs = rows.filter((r) => norm(r.ticker) === t || (!r.ticker && nk && nameKey(r.company).includes(nk)));
    const res = docs.length ? await kvMGet<GuidanceExtractResult>(docs.map((d) => resultKey(d.docId))).catch(() => docs.map(() => null)) : [];
    const q = (queue?.items || []).filter((x: any) => x?.market === market && norm(x?.ticker) === t);
    const uni: any[] = [];
    for (const [name, l] of lists) for (const r of l) {
      const rt = [r?.record?.ticker, ...(r?.tickers || [])].map(norm);
      if (rt.includes(t)) uni.push({ list: name, display: r.display ?? null, metric: r.metric ?? r.record?.primary?.metric ?? null, period: r.record?.primary?.period ?? null, verification: r.record?.verification ?? null, reasons: r.reviewReasons ?? r.reasons ?? r.expiryReason ?? r.why ?? null, statement: String(r.statement ?? '').slice(0, 200) });
    }
    out[t] = {
      documents: docs.map((d, k) => ({ docId: d.docId, kind: d.kind, filedAt: d.filedAt, textChars: d.textChars, extracted: !!d.extracted,
        extract: res[k] ? { status: res[k]!.status, kept: res[k]!.rows.length, dropped: res[k]!.dropped, note: res[k]!.note ?? null, promptVersion: res[k]!.promptVersion ?? null,
          rows: res[k]!.rows.slice(0, 12).map((x) => ({ metric: x.metric, period: x.period, periodKind: x.periodKind, low: x.low, high: x.high, unit: x.unit, status: x.status, growthLow: x.growthPctLow ?? null, quote: String(x.quote || '').slice(0, 160) })) } : null })),
      queue: q.slice(0, 10).map((x: any) => ({ status: x.processing_status, source_type: x.source_type, subject: String(x.subject || '').slice(0, 120), event_date: x.event_date, attempts: x.attempt_count, last_error: x.last_error })),
      universe: uni,
    };
  }
  return NextResponse.json({ ok: true, market, indexRows: rows.length, indexUpdatedAt: index?.updatedAt ?? null, queueItems: (queue?.items || []).length, companies: out }, { headers: { 'Cache-Control': 'no-store' } });
}
