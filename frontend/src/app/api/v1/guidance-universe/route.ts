// ═══════════════════════════════════════════════════════════════════════════
// GET /api/v1/guidance-universe?market=IN|US|ALL&metric=REVENUE|PAT|EPS|EBITDA|FCF&threshold=30&view=active|review|history&force=1   (zzz848, zzz853, Layer A)
//
// The persistent GUIDANCE UNIVERSE: management guidance that is still valid today, regardless of when it was announced (no event window).
// view=active (default): active + company resolved + period CONFIRMED + not needs-review. view=review: the review queue (records[] with reviewReasons[]).
// view=history (alias: all): also inactive records (expired / superseded / withdrawn, each with expiryReason) and excluded rows (analyst / consensus / commentary).
// zzz854: view=claims (alias: awaiting): claims awaiting verification (media / social / company document not read / last verified unknown). They are never
// in view=active or its counts. A newer primary-source EVENT for the same company + metric + period overrides a record (it moves to view=review with the
// reason 'Latest filing (date) says ...'). Response adds countEquations (Active = verified + derived + partial; highest active = Active rows >= threshold),
// viewCounts.claimsAwaiting and eventReconciliation.
// Extra (additive): viewCounts, invariantViolations (must be empty), servedFrom 'live'|'last_good'|'seed', builtAt. The universe is independent of the news cache.
// zzz857: the universe also reads the rows the AI extractor took from the companies' OWN documents (guidance-extract:v1:*, quote-checked; no AI call
// here). Each becomes an Active point sourced to that document (TIER1, read): growth 'stated' when the company gives a %, '(derived)' vs the prior
// fiscal year's actual when one is available, else the absolute target with 'growth not established'. The body adds `sources` (every input with its
// row count, COMPANY_DOC first) and `extractCoverage` { docs, extracted, rows, lastExtractAt } for the page.
// PUBLIC company data only (never holdings). No AI call and no document fetch in this route.
// zzz854 (AI verification): the "Claims awaiting verification" list IS the awaiting-verification list (one concept). Each claim is checked
// against the AI verifier's cached verdicts (lib/ai-verify): it carries aiVerification { status, reason, reasonText }; unchecked claims are
// queued for the 2-hourly verifier run (/api/v1/ai-verify); an AI-CONTRADICTED claim leaves the list (verificationAudit, with the reason)
// BEFORE the counts are built, so countEquations / viewCounts / invariants describe exactly the lists returned. AI-confirmed claims stay
// listed with the confirmation; promotion into Active happens through the events layer (event statuses), never here.
// ═══════════════════════════════════════════════════════════════════════════
import { NextRequest, NextResponse } from 'next/server';
import { getUniverseBundle, buildUniverseResponse, parseView, clampThreshold } from '@/lib/guidance-universe-service';
import type { GgMetric } from '@/lib/growth-guidance-types';
import { verifyUniverseClaims } from '@/lib/ai-verify';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const METRICS: GgMetric[] = ['REVENUE', 'PAT', 'EPS', 'EBITDA', 'FCF'];

export async function GET(req: NextRequest) {
  const t0 = Date.now();
  const sp = new URL(req.url).searchParams;
  const mk = String(sp.get('market') || 'ALL').toUpperCase();
  const market = mk === 'IN' || mk === 'US' ? mk : 'ALL';
  const m = String(sp.get('metric') || '').toUpperCase() as GgMetric;
  const metric = METRICS.includes(m) ? m : null;
  try {
    const b = await getUniverseBundle(t0, sp.get('force') === '1');
    const claimsBefore = b.build.claimsAwaiting ?? [];
    const vr = await verifyUniverseClaims(claimsBefore, { timeoutMs: 2_500 }).catch(() => null);
    // the bundle may be a shared cached object: copy, never mutate
    const gb = vr ? { ...b, build: { ...b.build, claimsAwaiting: vr.claims } } : b;
    const body: any = buildUniverseResponse(gb, { market, metric, threshold: clampThreshold(sp.get('threshold')), view: parseView(sp.get('view')) });
    const removed = vr?.removed ?? [];
    body.verification = vr?.verification ?? { provider: 'unknown', model: null, available: false, unavailableReason: 'The verification state could not be read; claims stay awaiting verification.', mode: 'enforce', primaryVerified: 0, checked: 0, confirmed: 0, contradicted: 0, awaiting: claimsBefore.length, awaitingByReason: {}, lastRunAt: null };
    body.verificationAudit = removed.slice(0, 200);
    // counts reconcile after the gate: claims shown + contradicted removed = claims before the gate; the claims count is the list
    const after = gb.build.claimsAwaiting ?? [];
    const recon: string[] = [];
    if (after.length + removed.length !== claimsBefore.length) recon.push(`claims awaiting (${after.length}) + AI-contradicted removed (${removed.length}) does not equal claims before verification (${claimsBefore.length})`);
    if (body.viewCounts?.claimsAwaiting != null && body.viewCounts.claimsAwaiting !== after.length) recon.push(`viewCounts.claimsAwaiting (${body.viewCounts.claimsAwaiting}) does not equal the claims list (${after.length})`);
    body.invariantViolations = [...(Array.isArray(body.invariantViolations) ? body.invariantViolations : []), ...recon];
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[guidance-universe] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The guidance universe could not be built. Please try again.' }, { status: 500 });
  }
}
