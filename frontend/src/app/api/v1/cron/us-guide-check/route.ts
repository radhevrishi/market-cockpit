// zzz963 — run the US lowered-outlook / working-capital re-check now (the app scheduler runs it every 2 h in US hours).
// POST with the x-cron-secret header. Spends AI only within US_GUIDE_CHECK_DAILY_USD.
import { NextResponse } from 'next/server';
import { verifyCronSecret } from '@/lib/verifyAuth';
import { runUsGuideChecks } from '@/lib/us-guide-check';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 400;

export async function POST(req: Request) {
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.reason }, { status: auth.reason.includes('not configured') ? 503 : 401 });
  try {
    const r = await runUsGuideChecks({ budgetMs: 200_000 });
    return NextResponse.json({ ok: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 502 });
  }
}
export async function GET(req: Request) { return POST(req); }
