'use client';
// zzz854 — the review queue (items that are NOT event cards, each with its reason) and the AI verification block
// (status line, Awaiting verification, Removed after the AI check). Collapsed by default, light and print friendly.
import React from 'react';
import type { GuReviewItem } from '@/lib/guidance-upgrades-types';
import type { VerificationSummary } from '@/lib/ai-verify-types';
import { PRIMARY_SOURCE_STATE_LABEL, TAXONOMY_LABEL } from '@/lib/guidance-upgrades-format';
import { verificationLine, awaitingRowLine, auditRowLine } from '@/components/special-situations/ss-counts';
import { R, tint } from './gu-tokens';
import { AiCheckBadge } from './GuBits';
import { LazyDetails } from './GuMore';
import { aiCheckOf, guVerificationLists, reviewQueueLine, reviewStatusCounts } from './gu-ui';

const CAP = 80;
type ReviewRow = GuReviewItem & { aiVerification?: unknown };

export function GuReviewQueue({ items, count }: { items: ReviewRow[] | null | undefined; count?: number | null }) {
  const list = Array.isArray(items) ? items : [];
  const n = typeof count === 'number' ? count : list.length;
  if (!n && !list.length) return null;
  const groups = reviewStatusCounts(list);
  return (
    <LazyDetails data-gu-review-queue className="gu-card" style={{ border: `1px solid ${R.border}`, borderRadius: 8, padding: '6px 10px', background: R.bg }} summary={
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, letterSpacing: 0.4, color: R.text }}>
        REVIEW QUEUE ({n}) <span style={{ fontWeight: 400, color: R.dim }}>— found, but not shown as cards: {groups.length ? groups.map((g) => `${g.label} ${g.n}`).join(' · ') : 'reason on each row'}</span>
      </summary>}>
      <div style={{ fontSize: 12, color: R.dim, margin: '4px 0' }}>These are not upgrades. Each waits for something specific (numbers, the company document, a period check) or is not guidance at all.</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        {list.slice(0, CAP).map((r) => (
          <li key={r.id} style={{ fontSize: 12.5, borderTop: `1px solid ${R.border}`, paddingTop: 4, display: 'grid', gap: 2 }}>
            <div style={{ overflowWrap: 'anywhere' }}>{reviewQueueLine(r)}</div>
            <div style={{ color: R.dim, fontSize: 12 }}>
              {r.taxonomy && TAXONOMY_LABEL[r.taxonomy] ? `${TAXONOMY_LABEL[r.taxonomy]} · ` : ''}
              {r.primarySourceState ? PRIMARY_SOURCE_STATE_LABEL[r.primarySourceState] : 'Primary source: not stated'}
              {r.primarySourceUrl ? <> · <a href={r.primarySourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>document</a></> : null}
            </div>
            {Array.isArray(r.figures) && r.figures.length > 0 && <div style={{ color: R.dim, fontSize: 12 }}>Read so far: {r.figures.join('; ')}</div>}
            {aiCheckOf(r) && <AiCheckBadge x={r} />}
          </li>
        ))}
        {list.length > CAP && <li style={{ fontSize: 12, color: R.dim }}>and {list.length - CAP} more.</li>}
        {list.length === 0 && <li style={{ fontSize: 12, color: R.dim }}>The list itself was not sent with this answer.</li>}
      </ul>
    </LazyDetails>
  );
}

type AnyRow = Record<string, unknown> & { aiVerification?: unknown };
function rowText(r: AnyRow, kind: 'awaiting' | 'audit'): string {
  if (typeof r.claimText === 'string') return kind === 'audit' ? auditRowLine(r as never) : awaitingRowLine(r as never);
  const base = reviewQueueLine(r as unknown as GuReviewItem);
  const a = aiCheckOf(r);
  return a?.detail && !base.includes(a.detail) ? `${base} — ${a.detail}` : base;
}

/** AI verification state for guidance events. Unavailable is said plainly; awaiting and removed items are listed with their reasons. */
export function GuVerificationBlock({ data }: { data: { verification?: Partial<VerificationSummary> | null; awaitingVerificationCount?: number | null; reviewQueue?: AnyRow[] | null; awaitingVerification?: unknown[] | null; verificationAudit?: unknown[] | null } | null | undefined }) {
  if (!data) return null;
  const v = verificationLine(data.verification);
  const { awaiting, audit } = guVerificationLists(data);
  const nAwait = typeof data.awaitingVerificationCount === 'number' ? data.awaitingVerificationCount : awaiting.length;
  if (!v && !nAwait && !audit.length) return null;
  return (
    <section aria-label="AI verification" data-gu-verification style={{ display: 'grid', gap: 4 }}>
      {v && (
        <div role={v.available ? undefined : 'alert'} style={v.available ? { fontSize: 12, color: R.dim } : { fontSize: 12.5, fontWeight: 700, border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), borderRadius: 6, padding: '5px 9px' }}>{v.text}</div>
      )}
      {(nAwait > 0 || awaiting.length > 0) && (
        <LazyDetails data-gu-awaiting summary={
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>AWAITING VERIFICATION ({nAwait}) <span style={{ fontWeight: 400, color: R.dim }}>— not shown as upgrades until the company document confirms them</span></summary>}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            {(awaiting as AnyRow[]).slice(0, CAP).map((r, i) => <li key={String(r.id || r.claimId || i)} style={{ overflowWrap: 'anywhere' }}>{rowText(r, 'awaiting')}</li>)}
            {awaiting.length === 0 && <li style={{ color: R.dim }}>The list itself was not sent with this answer.</li>}
          </ul>
        </LazyDetails>
      )}
      {audit.length > 0 && (
        <LazyDetails data-gu-ai-audit summary={
          <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 800, letterSpacing: 0.4 }}>REMOVED AFTER THE AI CHECK ({audit.length}) <span style={{ fontWeight: 400, color: R.dim }}>— the company document does not support the claim</span></summary>}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12.5 }}>
            {(audit as AnyRow[]).slice(0, CAP).map((r, i) => <li key={String(r.id || r.claimId || i)} style={{ overflowWrap: 'anywhere' }}>{rowText(r, 'audit')}</li>)}
          </ul>
        </LazyDetails>
      )}
    </section>
  );
}
