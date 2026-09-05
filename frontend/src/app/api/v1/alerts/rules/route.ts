// ════════════════════════════════════════════════════════════════════════════
// /api/v1/alerts/rules (zzz526) — server mirror of the Alert Center's rules.
// The Alert Center evaluates client-side while a tab is open; syncing the
// rules here lets the GitHub-Actions cron (/api/v1/cron/user-alerts) evaluate
// them server-side and push via Telegram/Slack even when the portal is closed.
// Storage: KV 'user-alerts:rules' (single-owner portal). GET also returns the
// recent server-fired hits so the Alert Center can display them.
// ════════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet } from '@/lib/kv';

export const dynamic = 'force-dynamic';

const RULES_KEY = 'user-alerts:rules';
const HITS_KEY = 'user-alerts:recent';

export async function GET() {
  try {
    const [rules, hits] = await Promise.all([
      kvGet<any[]>(RULES_KEY),
      kvGet<any[]>(HITS_KEY),
    ]);
    return NextResponse.json({ rules: Array.isArray(rules) ? rules : [], hits: Array.isArray(hits) ? hits : [] });
  } catch (e: any) {
    return NextResponse.json({ rules: [], hits: [], error: e?.message || 'kv unavailable' });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const rules = Array.isArray(body?.rules) ? body.rules : null;
    if (!rules) return NextResponse.json({ ok: false, error: 'rules[] required' }, { status: 400 });
    // Sanitize: keep only the fields the evaluator needs, cap at 50 rules.
    const clean = rules.slice(0, 50).map((r: any) => ({
      id: String(r?.id || '').slice(0, 60),
      ticker: String(r?.ticker || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim().slice(0, 20),
      kind: String(r?.kind || '').slice(0, 30),
      level: typeof r?.level === 'number' && Number.isFinite(r.level) ? r.level : undefined,
      createdAt: typeof r?.createdAt === 'number' ? r.createdAt : Date.now(),
    })).filter((r: any) => r.id && r.ticker && r.kind);
    await kvSet(RULES_KEY, clean);
    return NextResponse.json({ ok: true, count: clean.length });
  } catch (e: any) {
    // zzz530 — a real save failure must surface as an error status, not a silent 200 "ok"
    return NextResponse.json({ ok: false, error: e?.message || 'save failed' }, { status: 500 });
  }
}
