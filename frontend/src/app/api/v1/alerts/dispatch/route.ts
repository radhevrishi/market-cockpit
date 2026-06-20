// PATCH 0726 — Alert dispatch endpoint.
//
// POST /api/v1/alerts/dispatch?secret=<CRON_SECRET>
//   body: AlertPayload (see lib/alert-dispatcher.ts)
//   returns: DispatchResult JSON
//
// Auth gate: requires `?secret=${CRON_SECRET}` matching the env var so
// only internal callers (cron jobs, the news-alerts page firing rules)
// can dispatch alerts. If CRON_SECRET is unset the endpoint denies all
// requests — fail closed.
//
// Each channel gracefully no-ops when its env vars aren't set, so this
// endpoint is safe to deploy before SLACK_WEBHOOK_URL / SMTP_* /
// GENERIC_WEBHOOK_URL exist in the Vercel project.

import { NextRequest, NextResponse } from 'next/server';
import { dispatchAlert, type AlertPayload } from '@/lib/alert-dispatcher';
import { verifyCronSecret } from '@/lib/verifyAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

function isValidPayload(x: any): x is AlertPayload {
  if (!x || typeof x !== 'object') return false;
  if (!x.rule || typeof x.rule !== 'object') return false;
  if (typeof x.rule.id !== 'string' || typeof x.rule.name !== 'string') return false;
  if (!x.article || typeof x.article !== 'object') return false;
  if (typeof x.triggeredAt !== 'string') return false;
  return true;
}

export async function POST(req: NextRequest) {
  // PATCH 1101zzz2 / AUDIT H2 — constant-time secret comparison via shared
  // verifyCronSecret helper. Was `secret !== expected` which leaks timing on
  // mismatch (char-by-char early-exit). The helper uses crypto.timingSafeEqual.
  const auth = verifyCronSecret(req, { requireSecret: true });
  if (!auth.ok) {
    const status = auth.reason.includes('not configured') ? 503 : 401;
    return NextResponse.json({ error: auth.reason }, { status });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  if (!isValidPayload(body)) {
    return NextResponse.json(
      { error: 'invalid payload — need { rule:{id,name}, article:{...}, triggeredAt }' },
      { status: 400 },
    );
  }

  const result = await dispatchAlert(body);
  return NextResponse.json(result);
}
