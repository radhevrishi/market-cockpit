// zzz1211 — Railway health check. The new deploy only takes traffic once this answers 200, so the old one keeps serving
// while the new one boots (before: every deploy = several minutes of "site not answering"; 5 deploys on 2 Nov afternoon).
// Answers from memory only — no database, Redis or network — so it says "the server is up and serving requests".
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ ok: true, up_s: Math.round(process.uptime()) }, { headers: { 'Cache-Control': 'no-store' } });
}
