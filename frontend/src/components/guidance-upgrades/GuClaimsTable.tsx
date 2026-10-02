'use client';
// zzz861 — CLAIMS awaiting a company document, one row per claim, with what happens next. A claim is a secondary source's statement; it is never shown as
// "company stated". Columns come straight from the backend claims table (lib/guidance-claims.ts).
import React from 'react';
import type { GuidanceClaim } from '@/lib/guidance-claims';
import { R, tint } from './gu-tokens';
import { GuFold } from './GuPanel';

const VCOLOR: Record<string, string> = { VERIFIED: R.green, CONTRADICTED: R.red, PRIMARY_NOT_FOUND: R.amber, PRIMARY_NOT_READ: R.amber, NO_GUIDANCE_IN_DOCUMENT: R.grey, NOT_COMPARABLE: R.amber };
const VTEXT: Record<string, string> = { VERIFIED: 'Verified', CONTRADICTED: 'Contradicted', PRIMARY_NOT_FOUND: 'Primary not found', PRIMARY_NOT_READ: 'Primary not read', NO_GUIDANCE_IN_DOCUMENT: 'No guidance in document', NOT_COMPARABLE: 'Not comparable' };
const PTEXT: Record<string, string> = { FOUND: 'Found', NOT_FOUND: 'Not found', NOT_YET_FETCHED: 'Not yet fetched' };
export function GuClaimsTable({ claims, market }: { claims: GuidanceClaim[] | undefined; market: 'IN' | 'US' | 'ALL' }) {
  const rows = (claims || []).filter((c) => market === 'ALL' || c.market === market);
  if (!rows.length) return null;
  const open = rows.filter((c) => c.claim_status === 'AWAITING_PRIMARY').length;
  return (
    <GuFold title="Claims and what happens next" count={rows.length} accent={R.amber} defaultOpen={false}>
      <div data-gu-claims-table style={{ display: 'grid', gap: 6, fontSize: 12.5 }}>
        <div style={{ color: R.dim }}>{open} of {rows.length} claims still wait for a company document. A claim is what a secondary source says; it stays out of the main lists until the company's own document confirms it.</div>
        {rows.slice(0, 120).map((c) => (
          <div key={c.claim_id} data-gu-claim={c.verification_status} style={{ border: `1px solid ${R.border}`, borderLeft: `3px solid ${VCOLOR[c.verification_status] ?? R.grey}`, borderRadius: 8, padding: '6px 10px', display: 'grid', gap: 2 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
              <b>{c.company}</b><span style={{ color: R.dim }}>{c.market === 'IN' ? 'India' : 'USA'}{c.ticker ? ` · ${c.ticker}` : ''}</span>
              <span>{c.claimed_metric} {c.claimed_period}: {c.claimed_growth}</span>
              <span style={{ fontWeight: 800, fontSize: 11.5, color: VCOLOR[c.verification_status], border: `1px solid ${tint(VCOLOR[c.verification_status] ?? R.grey, 45)}`, borderRadius: 10, padding: '0 8px' }}>{VTEXT[c.verification_status]}</span>
            </div>
            <div style={{ color: R.dim }}>Secondary source reports this ({c.secondary_source}{c.source_date ? `, ${c.source_date}` : ''}). Primary document: <b>{PTEXT[c.primary]}</b> · Document: <b>{c.document === 'AVAILABLE' ? 'Available' : 'Pending'}</b> · Processing: <b>{c.processing === 'NONE' ? 'Not queued' : c.processing.charAt(0) + c.processing.slice(1).toLowerCase()}</b></div>
            <div>Next: {c.next_action}</div>
          </div>
        ))}
      </div>
    </GuFold>
  );
}
