// zzz1166 — POST /api/v1/transformational/ai — the AI "multibagger chance" read.
//   { ids: [...] }                       → those events (the owner clicked "Ask AI" on a row)
//   { auto: true, market, sinceDays }    → the strongest events without an AI read yet (after "Research again with AI")
// Each event is read once (the answer is stored); at most 12 a call and 60 a day.
import { NextRequest, NextResponse } from 'next/server';
import { saveAi } from '@/lib/transformational/store';
import { loadReviewed } from '@/lib/transformational/reviewed';
import { aiMultibagger, AI_DAILY_MAX, AI_PER_CALL_MAX } from '@/lib/transformational/ai';
import type { TgItem, TgMarket } from '@/lib/transformational/core';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const dayKey = () => `transformational:ai:count:${new Date().toISOString().slice(0, 10)}`;

export async function POST(req: NextRequest) {
  const body: any = await req.json().catch(() => ({}));
  const m = String(body?.market || '').toUpperCase();
  const market: TgMarket | undefined = m === 'IN' || m === 'US' ? m : undefined;
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String).slice(0, AI_PER_CALL_MAX) : [];
  const sinceDays = Math.max(1, Math.min(60, Number(body?.sinceDays) || 3));
  try {
    const all = await loadReviewed(ids.length ? 75 : sinceDays, market);
    let pick: TgItem[];
    if (ids.length) pick = all.filter((x) => ids.includes(x.id) && !(x.ai && !body?.again));
    else pick = all.filter((x) => !x.ai && !x.needsCheck && x.strength !== 'NOTABLE').sort((a, b) => b.mb.score - a.mb.score);   // reviewed: clean text + screener figures
    const { kvGet, kvIncrByFloat } = await import('@/lib/kv');
    const used = Number(await kvGet<number>(dayKey()).catch(() => 0)) || 0;
    const room = Math.max(0, Math.min(AI_PER_CALL_MAX, AI_DAILY_MAX - used));
    pick = pick.slice(0, room);
    const deadline = Date.now() + 50_000;
    const done: Array<{ id: string; ai: any }> = []; const failed: string[] = [];
    let i = 0;
    const worker = async () => {
      while (i < pick.length && Date.now() < deadline) {
        const x = pick[i++];
        const ai = await aiMultibagger(x);
        await kvIncrByFloat(dayKey(), 1, 2 * 86_400).catch(() => null);
        if (!ai) { failed.push(x.id); continue; }
        await saveAi(x.id, x.market, ai).catch(() => undefined);
        done.push({ id: x.id, ai });
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    return NextResponse.json({
      ok: true, read: done.length, failed, results: done, dailyUsed: used + done.length + failed.length, dailyMax: AI_DAILY_MAX,
      note: room === 0 ? `Daily AI limit reached (${AI_DAILY_MAX} reads) — the rules read still shows.` : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
