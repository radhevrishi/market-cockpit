'use client';
// zzz854 — "How these numbers add up" for the Special Situations page: the count model line, its equations, what was held
// back and why, the AI verification state, and the collapsible "Awaiting verification" and "Removed after the AI check" lists.
// Light and print friendly. Every number is read from the feed payload; nothing is computed into a new figure here.
import React from 'react';
import type { AwaitingRow, RemovedRow, VerificationSummary } from '@/lib/ai-verify-types';
import { R, tint } from './radar-tokens';
import {
  otherCategories, auditRowLine, awaitingReasonCounts, awaitingRowLine, beforeVerificationLine, countModelSummary, coverageRawRows, equationRows, heldBackRows, verificationLine, type CountModelIn,
} from './ss-counts';

export interface SsCountFeed {
  count_model?: CountModelIn;
  held_back?: { reasons?: Array<{ reason: string; label?: string; count: number; examples?: string[] }>; byReason?: Record<string, number>; total?: number } | null;
  verification?: Partial<VerificationSummary> | null;
  awaitingVerification?: Array<Partial<AwaitingRow>> | null;
  awaitingVerificationCount?: number | null;
  verificationAudit?: Array<Partial<RemovedRow>> | null;
  by_tier_before_verification?: Record<string, number> | null;
}

const LIST_CAP = 60;

export function SsCountPanel({ feed, regionNote, knownCategories }: { feed: SsCountFeed | null | undefined; regionNote?: string | null; knownCategories?: string[] }) {
  if (!feed) return null;
  const cm = feed.count_model;
  const summary = countModelSummary(cm);
  const eqs = equationRows(cm);
  const held = heldBackRows(feed.held_back, cm);
  const ver = verificationLine(feed.verification);
  const awaiting = Array.isArray(feed.awaitingVerification) ? feed.awaitingVerification : [];
  const awaitingN = typeof feed.awaitingVerificationCount === 'number' ? feed.awaitingVerificationCount : awaiting.length;
  const audit = Array.isArray(feed.verificationAudit) ? feed.verificationAudit : [];
  const before = beforeVerificationLine(feed.by_tier_before_verification);
  const raw = coverageRawRows(cm);
  const reasons = awaitingReasonCounts(awaiting, feed.verification?.awaitingByReason as Record<string, number> | undefined);
  if (!summary && !ver && !held.length && !awaiting.length) return null;
  const bad = eqs.filter((e) => !e.holds);
  const other = otherCategories(cm, knownCategories);
  return (
    <div data-ss-count-panel style={{ marginTop: 6, marginBottom: 6, padding: '8px 10px', border: `1px solid ${R.border}`, borderRadius: 8, background: R.bg, color: R.text, fontSize: 12, display: 'grid', gap: 4 }}>
      {summary && (
        <div><b>How these numbers add up:</b> {summary}. The tier boxes, category boxes, coverage boxes and the Radar all count the same {cm?.shown ?? 0} shown events.{other ? ` ${other}` : ''}</div>
      )}
      {regionNote && <div style={{ color: R.dim }}>{regionNote}</div>}
      {bad.length > 0 && (
        <div role="alert" style={{ color: R.red, fontWeight: 700 }}>Counts do not add up: {bad.map((e) => `${e.id} ${e.text}`).join('; ')}. Do not rely on the boxes until this is fixed.</div>
      )}
      {eqs.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: R.dim }}>Show the checks ({eqs.filter((e) => e.holds).length} of {eqs.length} hold)</summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {eqs.map((e) => <li key={e.id} style={{ color: e.holds ? R.dim : R.red }}>{e.holds ? '✓' : '✕'} {e.id}: {e.text}</li>)}
          </ul>
        </details>
      )}
      {held.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer' }}><b>Held back ({held.reduce((a, h) => a + h.count, 0)})</b> <span style={{ color: R.dim }}>— not shown as cards, by reason</span></summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {held.map((h) => <li key={h.reason}><b>{h.count}</b> {h.label}{h.examples.length ? <span style={{ color: R.dim }}> (e.g. {h.examples.join(', ')})</span> : null}</li>)}
          </ul>
        </details>
      )}
      {ver && (
        <div role={ver.available ? undefined : 'alert'} style={ver.available ? { color: R.dim } : { color: R.text, fontWeight: 700, border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), borderRadius: 6, padding: '4px 8px' }}>
          {ver.text}
        </div>
      )}
      {before && <div style={{ color: R.dim }}>{before}. The boxes above show only events that passed the check.</div>}
      {(awaitingN > 0 || awaiting.length > 0) && (
        <details data-ss-awaiting>
          <summary style={{ cursor: 'pointer' }}><b>Awaiting verification ({awaitingN})</b> <span style={{ color: R.dim }}>— hidden from the lists until the company document confirms them{reasons.length ? `: ${reasons.map((r) => `${r.label} ${r.count}`).join(' · ')}` : ''}</span></summary>
          {awaiting.length === 0 ? <div style={{ color: R.dim, paddingTop: 4 }}>The list itself was not sent with this payload.</div> : (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {awaiting.slice(0, LIST_CAP).map((r, i) => (
                <li key={`${r.claimId || r.refId || i}`} style={{ overflowWrap: 'anywhere' }}>
                  {awaitingRowLine(r)}
                  {r.primaryUrl ? <> · <a href={r.primaryUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>document</a></> : null}
                </li>
              ))}
              {awaiting.length > LIST_CAP && <li style={{ color: R.dim }}>and {awaiting.length - LIST_CAP} more.</li>}
            </ul>
          )}
        </details>
      )}
      {audit.length > 0 && (
        <details data-ss-audit>
          <summary style={{ cursor: 'pointer' }}><b>Removed after the AI check ({audit.length})</b> <span style={{ color: R.dim }}>— the company document does not support the headline</span></summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {audit.slice(0, LIST_CAP).map((r, i) => (
              <li key={`${r.claimId || r.refId || i}`} style={{ overflowWrap: 'anywhere' }}>
                {auditRowLine(r)}
                {r.quote ? <span style={{ color: R.dim }}> — the document says: “{r.quote}”</span> : null}
                {r.documentUrl ? <> · <a href={r.documentUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>document</a></> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {raw.length > 0 && (
        <details>
          <summary style={{ cursor: 'pointer', color: R.dim }}>Coverage before the checks (RAW, pre-filter)</summary>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: R.dim }}>
            {raw.map((r) => <li key={r.bucket}>{r.bucket}: {r.shown} shown of {r.raw} raw</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
