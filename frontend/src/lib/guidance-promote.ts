// zzz863 — an AI-CONFIRMED claim is promoted into Active. The AI check reads the company's own document, finds the quote, and the numbers, period and basis must hold
// (lib/ai-verify). Once that is true the claim is no longer "only media said so": it is company-document evidence, read and quote-checked, exactly like a row the
// extractor took from the same document. A claim is promoted only when EVERY other Active rule already holds (period confirmed, not flagged, no newer conflicting
// filing, company resolved, not an unsourced implied figure). Anything else stays where it is. Pure: no clock beyond the verdict's own time, no network.
import type { GuUniverseRecordX } from './guidance-universe';
import { guidanceWording } from './guidance-semantics';

export interface PromotedRow { company: string; ticker: string | null; market: 'IN' | 'US'; metric: string; period: string; checkedAt: string | null; documentUrl: string | null }
export interface PromoteResult { defaultRecords: GuUniverseRecordX[]; claimsAwaiting: GuUniverseRecordX[]; promoted: PromotedRow[] }

const dayOf = (iso: unknown): string | null => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);
const confirmed = (r: any): { checkedAt: string | null; documentUrl: string | null } | null => {
  const a = r?.aiVerification; if (!a || a.status !== 'AI_CONFIRMED') return null;
  return { checkedAt: typeof a.checkedAt === 'string' ? a.checkedAt : null, documentUrl: typeof a.documentUrl === 'string' ? a.documentUrl : null };
};
/** True when the only thing keeping this point out of Active is that no company document was read. */
export function onlyUnreadDocument(p: any, rec: any): boolean {
  if (!p || p.periodStatus !== 'CONFIRMED' || p.needsReview || p.eventOverride || p.growthType === 'IMPLIED') return false;
  if (p.status !== 'ACTIVE' || !p.current || p.periodRunState === 'EXPIRED' || p.sourceConflict) return false;
  if (p.claimType === 'ANALYST_ESTIMATE' || p.claimType === 'CONSENSUS') return false;
  return !!(rec.companyId && rec.tickerResolved && (rec.ticker || (rec.tickers || [])[0]));
}
function promotePoint(p: any, c: { checkedAt: string | null; documentUrl: string | null }): any {
  const state = p.growthType === 'EXPLICIT' ? 'VERIFIED' : p.growthType === 'DERIVED' ? 'DERIVED' : 'PARTIAL';
  const day = dayOf(c.checkedAt);
  return {
    ...p, verification: 'VERIFIED', verificationState: state, verificationStatus: 'primary_verified', verificationReason: "Confirmed by the AI check against the company's own document (quote and numbers checked).",
    claimType: 'MANAGEMENT_GUIDANCE', sourceTier: 1, sourceTierLabel: 'TIER1 — company document (AI-checked)', primarySource: true, sourceName: "Company's own document (AI-checked)", sourceUrl: c.documentUrl || p.sourceUrl,
    primarySourceFound: true, primarySourceRead: true, primarySourceText: 'PRIMARY SOURCE FOUND', primarySourceReadText: 'primary source read',
    lastVerified: day || p.lastVerified, lastVerifiedDaysAgo: day ? 0 : p.lastVerifiedDaysAgo, staleVerification: false, freshness: 'FRESH',
    awaitingVerification: false, awaitingVerificationReason: null, listBucket: 'ACTIVE', inDefaultView: true, reviewReasons: [],
    wording: guidanceWording('primary_verified', p.calculationType),
  };
}
export function promoteConfirmed(b: { defaultRecords: GuUniverseRecordX[]; claimsAwaiting: GuUniverseRecordX[] }): PromoteResult {
  const keep: GuUniverseRecordX[] = []; const add: GuUniverseRecordX[] = []; const promoted: PromotedRow[] = [];
  for (const r of b.claimsAwaiting) {
    const c = confirmed(r);
    if (!c || !r.points.length || !r.points.every((p) => onlyUnreadDocument(p, r))) { keep.push(r); continue; }
    const pts = r.points.map((p) => promotePoint(p, c)); const h = pts[0];
    add.push({
      ...r, points: pts, verificationState: h.verificationState, verificationStatus: h.verificationStatus, claimType: h.claimType, sourceTier: 1, primarySourceFound: true, primarySourceRead: true,
      primarySourceText: h.primarySourceText, primarySource: true, sourceName: h.sourceName, sourceUrl: h.sourceUrl, lastVerified: h.lastVerified, lastVerifiedDaysAgo: h.lastVerifiedDaysAgo, staleVerification: false,
      freshness: 'FRESH', wording: h.wording, listBucket: 'ACTIVE', reviewReasons: [], reviewReasonCodes: [], inReviewQueue: false, needsReview: null,
    } as GuUniverseRecordX);
    for (const p of r.points) promoted.push({ company: r.record.company, ticker: r.record.ticker || r.tickers[0] || null, market: (r.record.market === 'US' ? 'US' : 'IN') as 'IN' | 'US', metric: String(p.metric), period: p.period, checkedAt: c.checkedAt, documentUrl: c.documentUrl });
  }
  return { defaultRecords: [...b.defaultRecords, ...add], claimsAwaiting: keep, promoted };
}
