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
import { auditDerived } from '@/lib/guidance-derived-audit';
import { promoteConfirmed } from '@/lib/guidance-promote';
import { loadPipelineEvidence, pipelineView } from '@/lib/guidance-pipeline-service';

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
    const claimsBefore = b.build.claimsAwaiting ?? [];   // the claims before the AI gate
    const vr = await verifyUniverseClaims(claimsBefore, { timeoutMs: 2_500 }).catch(() => null);
    // the bundle may be a shared cached object: copy, never mutate
    const gb0 = vr ? { ...b, build: { ...b.build, claimsAwaiting: vr.claims } } : b;
    // zzz863: a claim the AI check CONFIRMED against the company's own document moves into Active (every other Active rule must already hold)
    const pr = promoteConfirmed({ defaultRecords: gb0.build.defaultRecords ?? [], claimsAwaiting: gb0.build.claimsAwaiting ?? [] });
    const gb = pr.promoted.length ? { ...gb0, build: { ...gb0.build, defaultRecords: pr.defaultRecords, claimsAwaiting: pr.claimsAwaiting } } : gb0;
    const body: any = buildUniverseResponse(gb, { market, metric, threshold: clampThreshold(sp.get('threshold')), view: parseView(sp.get('view')) });
    // zzz865: every DERIVED growth in the Active list, recalculated from its own stored numbers (target, base, base period, formula)
    try { body.derivedAudit = auditDerived((gb.build.defaultRecords ?? []) as any); } catch { /* the audit is additive */ }
    const removed = vr?.removed ?? [];
    body.verification = vr?.verification ?? { provider: 'unknown', model: null, available: false, unavailableReason: 'The verification state could not be read; claims stay awaiting verification.', mode: 'enforce', primaryVerified: 0, checked: 0, confirmed: 0, contradicted: 0, awaiting: claimsBefore.length, awaitingByReason: {}, lastRunAt: null };
    body.verificationAudit = removed.slice(0, 200);
    body.promoted = pr.promoted.slice(0, 100);
    // counts reconcile after the gate: claims shown + contradicted removed = claims before the gate; the claims count is the list
    const after = gb.build.claimsAwaiting ?? [];
    const promotedRecs = (gb.build.defaultRecords?.length ?? 0) - (gb0.build.defaultRecords?.length ?? 0);
    const recon: string[] = [];
    if (after.length + removed.length + promotedRecs !== claimsBefore.length) recon.push(`claims awaiting (${after.length}) + AI-contradicted removed (${removed.length}) + promoted to Active (${promotedRecs}) does not equal claims before verification (${claimsBefore.length})`);
    if (body.viewCounts?.claimsAwaiting != null && body.viewCounts.claimsAwaiting !== after.length) recon.push(`viewCounts.claimsAwaiting (${body.viewCounts.claimsAwaiting}) does not equal the claims list (${after.length})`);
    body.invariantViolations = [...(Array.isArray(body.invariantViolations) ? body.invariantViolations : []), ...recon];
    // zzz861: the real state of each market (distinct states, never a bare NO DATA), the claims table with its actionable status, and the wanted-companies list.
    try {
      const ev = await Promise.race([loadPipelineEvidence(), new Promise<null>((r) => setTimeout(() => r(null), 4_000))]);
      if (ev) {
        const contra = removed.flatMap((r: any) => [String(r.ticker || '').toUpperCase(), String(r.company || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()]).filter(Boolean);
        const act = (m: 'IN' | 'US') => (gb.build.defaultRecords ?? []).filter((r: any) => r.record.market === m).length;
        const vc = (gb.build.defaultRecords ?? []).flatMap((r: any) => [`${r.record.market}|${String(r.tickers?.[0] || r.record.ticker || '').toUpperCase()}`, `${r.record.market}|${String(r.record.company || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase()}`]);
        const promotedKeys = new Set(pr.defaultRecords.slice(gb0.build.defaultRecords?.length ?? 0).map((r) => r.entityKey));
        const pv = pipelineView(ev, claimsBefore.filter((r) => !promotedKeys.has(r.entityKey)), { IN: act('IN'), US: act('US') }, new Date(), contra, vc);
        body.extractCoverage = { ...(body.extractCoverage || { docs: 0, extracted: 0, rows: 0, lastExtractAt: null }), quality: pv.quality };
        // the collectors read this list (GET /api/v1/guidance-pipeline) so they go and fetch the company documents the claims are waiting on
        import('@/lib/kv').then((k) => k.kvSet('guidance-pipeline:wanted:v1', { at: new Date().toISOString(), wanted: pv.wanted }, 7 * 86_400)).catch(() => 0);
        // zzz862: every company that has a guidance record is on the watch set: its new filings are queued first and read first (see lib/guidance-watch.ts)
        import('@/lib/guidance-watch').then(async (w) => w.writeWatch(w.withRequested(w.watchOf([...(gb.build.defaultRecords ?? []), ...(gb.build.reviewQueue ?? []), ...claimsBefore].map((r: any) => ({ market: r.record.market, ticker: r.tickers?.[0] || r.record.ticker, company: r.record.company }))), await w.readRequested()))).catch(() => 0);
        body.pipeline = { claims: pv.claims.slice(0, 600), claimCounts: pv.claimCounts, wanted: pv.wanted, queueStages: pv.queueStages, evidenceErrors: ev.errors };
      }
    } catch { /* the pipeline view is additive */ }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[guidance-universe] error', e?.message || e);
    return NextResponse.json({ ok: false, error: 'The guidance universe could not be built. Please try again.' }, { status: 500 });
  }
}
