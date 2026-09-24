// zzz797 — the owner's US gainers scan criteria.
//
//   GET  → the criteria in use (saved, or the defaults), the defaults, and a
//          plain-words summary. Public: it holds no personal data, and the
//          gainers board it drives is public too.
//   PUT  → save. OWNER ONLY (login cookie, or a service key). Body:
//          { criteria: {...} }                 save these (partial is fine —
//                                              missing fields keep the saved value)
//          { reset: true }                     back to the defaults
//          { link: "https://…/screener/…" }    read what can be read from a
//                                              pasted TradingView link / filter JSON
//          Any save changes the criteria hash, and the gainers scan cache key
//          carries that hash — the next page load reads a fresh list.

import { NextRequest, NextResponse } from 'next/server';
import { isRedisAvailable } from '@/lib/kv';
import { SITE_COOKIE, expectedToken, safeEqual, hasServiceKey } from '@/lib/site-auth';
import { loadUsScanCriteria, saveUsScanCriteria } from '@/lib/ai-gainers/us-scan-criteria-store';
import {
  DEFAULT_US_SCAN_CRITERIA, criteriaHash, describeCriteria, isDefaultCriteria, parseScreenerLink, parseUsScanCriteria,
} from '@/lib/ai-gainers/us-scan-criteria';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function isOwner(req: NextRequest): Promise<boolean> {
  try {
    if (hasServiceKey(req.headers.get('x-mc-key')) || hasServiceKey(req.headers.get('x-cron-secret'))) return true;
    const want = await expectedToken();
    const got = req.cookies.get(SITE_COOKIE)?.value || '';
    return !!want && !!got && safeEqual(want, got);
  } catch { return false; }
}

function view(c: ReturnType<typeof parseUsScanCriteria>['criteria'], stored: boolean, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    criteria: c,
    stored,
    is_default: isDefaultCriteria(c),
    hash: criteriaHash(c),
    summary: describeCriteria(c),
    defaults: DEFAULT_US_SCAN_CRITERIA,
    defaults_summary: describeCriteria({ ...DEFAULT_US_SCAN_CRITERIA, exchanges: [...DEFAULT_US_SCAN_CRITERIA.exchanges] }),
    ...extra,
  };
}

export async function GET() {
  const { criteria, stored, problems } = await loadUsScanCriteria();
  return NextResponse.json(view(criteria, stored, problems.length ? { problems } : {}), { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(req: NextRequest) {
  if (!(await isOwner(req))) {
    return NextResponse.json({ ok: false, error: 'Only the signed-in owner can change the scan criteria.' }, { status: 401 });
  }
  let body: any = null;
  try { body = await req.json(); } catch { /* handled below */ }
  if (!body || typeof body !== 'object') return NextResponse.json({ ok: false, error: 'The request had no settings in it.' }, { status: 400 });

  const current = await loadUsScanCriteria();
  let merged: Record<string, unknown>;
  let link: ReturnType<typeof parseScreenerLink> | null = null;

  if (body.reset === true) {
    merged = { ...DEFAULT_US_SCAN_CRITERIA, exchanges: [...DEFAULT_US_SCAN_CRITERIA.exchanges], screenerUrl: current.criteria.screenerUrl };
  } else {
    merged = { ...current.criteria, ...(body.criteria && typeof body.criteria === 'object' ? body.criteria : {}) };
    if (typeof body.link === 'string') {
      link = parseScreenerLink(body.link);
      if (link.criteria) merged = { ...merged, ...link.criteria };
      // A real link is kept for reference; pasted JSON is not a link.
      if (link.kind === 'screener_link') merged.screenerUrl = body.link.trim();
    }
  }
  merged.updatedAt = new Date().toISOString();

  const { criteria, problems } = parseUsScanCriteria(merged);
  try { await saveUsScanCriteria(criteria); } catch (e: any) {
    return NextResponse.json({ ok: false, error: `The settings could not be saved: ${String(e?.message || e).slice(0, 200)}` }, { status: 500 });
  }
  return NextResponse.json(view(criteria, true, {
    problems,
    link,
    persisted: isRedisAvailable(),
    ...(isRedisAvailable() ? {} : { warning: 'Saved on this server only (the shared store is not configured), so the setting may reset when the server restarts.' }),
  }));
}
