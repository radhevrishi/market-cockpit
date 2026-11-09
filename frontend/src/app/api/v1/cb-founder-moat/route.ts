// zzz1231 — founder-led + moat for Conviction Beats names (lib/cb-founder-moat).
//   GET  ?market=IN|US&tickers=A,B        → the stored reads (no AI)
//   POST { market, items: [{ ticker, company, industry }] } → reads the ones not stored yet (≤ 10 a call, ≤ 40 a day)
import { NextRequest, NextResponse } from 'next/server';
import { kvGet, kvMGet, kvSet, kvIncrByFloat } from '@/lib/kv';
import { CB_FM_DAILY_MAX, CB_FM_PER_CALL, CB_FM_TTL_S, cbFmDayKey, cbFmKey, FM_SYSTEM, FM_TOOL, fmUserText, parseFmAnswer, type FounderMoat } from '@/lib/cb-founder-moat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MODEL = 'claude-haiku-4-5-20251001';   // mapped to the configured provider's model by the meter
const mkt = (v: unknown): 'IN' | 'US' | null => { const m = String(v || '').toUpperCase(); return m === 'IN' || m === 'US' ? m : null; };
const tk = (v: unknown) => String(v || '').toUpperCase().replace(/[^A-Z0-9&._-]/g, '').slice(0, 20);

async function stored(m: 'IN' | 'US', tickers: string[]): Promise<Record<string, FounderMoat>> {
  const out: Record<string, FounderMoat> = {};
  if (!tickers.length) return out;
  const vals = await kvMGet<FounderMoat>(tickers.map((t) => cbFmKey(m, t))).catch(() => [] as Array<FounderMoat | null>);
  tickers.forEach((t, i) => { if (vals[i]) out[t] = vals[i] as FounderMoat; });
  return out;
}

export async function GET(req: NextRequest) {
  const u = new URL(req.url);
  const m = mkt(u.searchParams.get('market'));
  if (!m) return NextResponse.json({ ok: false, error: 'market IN or US' }, { status: 400 });
  const tickers = Array.from(new Set(String(u.searchParams.get('tickers') || '').split(',').map(tk).filter(Boolean))).slice(0, 400);
  return NextResponse.json({ ok: true, market: m, results: await stored(m, tickers) }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const m = mkt(body?.market);
  if (!m) return NextResponse.json({ ok: false, error: 'market IN or US' }, { status: 400 });
  const items: Array<{ ticker: string; company: string | null; industry: string | null }> = (Array.isArray(body?.items) ? body.items : [])
    .map((x: any) => ({ ticker: tk(x?.ticker), company: x?.company ? String(x.company).slice(0, 120) : null, industry: x?.industry ? String(x.industry).slice(0, 80) : null }))
    .filter((x: any) => x.ticker);
  const have = await stored(m, items.map((x) => x.ticker));
  const todo = items.filter((x) => !have[x.ticker]);
  const used = Number(await kvGet<number>(cbFmDayKey()).catch(() => 0)) || 0;
  const room = Math.max(0, Math.min(CB_FM_PER_CALL, CB_FM_DAILY_MAX - used));
  const pick = todo.slice(0, room);
  const { anthropicMessages, modelConfigured } = await import('@/lib/anthropic-meter');
  if (!modelConfigured()) return NextResponse.json({ ok: true, results: have, read: 0, note: 'AI model not configured' });
  const results: Record<string, FounderMoat> = { ...have };
  const deadline = Date.now() + 50_000;
  let i = 0, read = 0, failed = 0;
  const worker = async () => {
    while (i < pick.length && Date.now() < deadline) {
      const x = pick[i++];
      await kvIncrByFloat(cbFmDayKey(), 1, 2 * 86_400).catch(() => null);
      try {
        const resp = await anthropicMessages('cb-founder-moat', {
          model: MODEL, max_tokens: 400, system: FM_SYSTEM,
          tools: [FM_TOOL as any], tool_choice: { type: 'tool', name: FM_TOOL.name },
          messages: [{ role: 'user', content: fmUserText({ ...x, market: m }) }],
        } as any, { signal: AbortSignal.timeout(30_000) });
        if (!resp.ok) { failed++; continue; }
        const j: any = await resp.json();
        const fm = parseFmAnswer((j?.content || []).find((c: any) => c?.type === 'tool_use')?.input);
        if (!fm) { failed++; continue; }
        await kvSet(cbFmKey(m, x.ticker), fm, CB_FM_TTL_S).catch(() => undefined);
        results[x.ticker] = fm; read++;
      } catch { failed++; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return NextResponse.json({
    ok: true, results, read, failed, waiting: Math.max(0, todo.length - pick.length), dailyUsed: used + read + failed, dailyMax: CB_FM_DAILY_MAX,
    note: room === 0 && todo.length ? `Daily AI limit reached (${CB_FM_DAILY_MAX} reads) — the rest are read tomorrow.` : null,
  });
}
