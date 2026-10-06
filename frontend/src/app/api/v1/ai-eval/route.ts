// zzz883 — runs the guidance-extractor golden set through the real model and returns precision / recall / false positives / cost.
// PROTECTED (paid AI). GET ?run=1 runs (≈ $0.03); GET without run returns the last saved scorecard.
import { NextRequest, NextResponse } from 'next/server';
import { runGuidanceEval } from '@/lib/ai-eval';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const KEY = 'ai-eval:guidance:last';

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('run') !== '1') return NextResponse.json({ ok: true, last: await kvGet(KEY).catch(() => null) });
  const score = await runGuidanceEval();
  await kvSet(KEY, score, 400 * 86_400).catch(() => {});
  return NextResponse.json({ ok: true, ...score });
}
