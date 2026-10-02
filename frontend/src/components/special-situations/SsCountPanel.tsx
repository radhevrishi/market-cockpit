'use client';
// zzz854 — "How these numbers add up" for the Special Situations page: the count model line, its equations, what was held
// back and why, the AI verification state, and the collapsible "Awaiting verification" and "Removed after the AI check" lists.
// Light and print friendly. Every number is read from the feed payload; nothing is computed into a new figure here.
import React, { useEffect, useState } from 'react';
import type { AwaitingRow, RemovedRow, VerificationSummary } from '@/lib/ai-verify-types';
import { R, tint } from './radar-tokens';
import {
  otherCategories, auditRowLine, coverageRawFallback, nothingVerifiedBanner, unverifiedCards, verificationProgressLine, type UnverifiedEventIn, awaitingReasonCounts, awaitingRowLine, beforeVerificationLine, countModelSummary, coverageRawRows, equationRows, heldBackRows, verificationLine, type CountModelIn,
} from './ss-counts';

export interface SsCountFeed {
  count_model?: CountModelIn;
  held_back?: { reasons?: Array<{ reason: string; label?: string; count: number; examples?: string[] }>; byReason?: Record<string, number>; total?: number } | null;
  verification?: Partial<VerificationSummary> | null;
  awaitingVerification?: Array<Partial<AwaitingRow>> | null;
  awaitingVerificationCount?: number | null;
  verificationAudit?: Array<Partial<RemovedRow>> | null;
  by_tier_before_verification?: Record<string, number> | null;
  coverage_diagnostic_raw?: { label?: string; buckets?: Array<{ bucket?: string; count?: number }> } | null;
}

/**
 * zzz856 — a <details> whose list is in the DOM only while it is open (after mount). A closed <details> keeps its children
 * under content-visibility: hidden, so text readers and copy-paste saw rows of EMPTY bullets ("Show the checks (5 of 5
 * hold) • • • • •"). Server render (and the first client render) still include the list, so SSR output is unchanged.
 */
function Fold({ summary, children, ...rest }: { summary: React.ReactNode; children: React.ReactNode } & Record<string, unknown>) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  return (
    <details {...rest} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary style={{ cursor: 'pointer' }}>{summary}</summary>
      {open || !mounted ? children : null}
    </details>
  );
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
  const rawOnly = raw.length ? [] : coverageRawFallback(feed.coverage_diagnostic_raw);
  const progress = verificationProgressLine(feed.verification as any, feed.awaitingVerificationCount);
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
        <Fold summary={<span style={{ color: R.dim }}>Show the checks ({eqs.filter((e) => e.holds).length} of {eqs.length} hold)</span>}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {eqs.map((e, i) => <li key={e.id || i} style={{ color: e.holds ? R.text : R.red }}>{e.holds ? '✓ holds' : '✕ fails'} — {e.id ? `${e.id}: ` : ''}{e.text}</li>)}
          </ul>
        </Fold>
      )}
      {held.length > 0 && (
        <Fold summary={<><b>Held back ({held.reduce((a, h) => a + h.count, 0)})</b> <span style={{ color: R.dim }}>— not shown as cards, by reason</span></>}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {held.map((h) => <li key={h.reason}><b>{h.count}</b> {h.label}{h.examples.length ? <span style={{ color: R.dim }}> (e.g. {h.examples.slice(0, 3).join(', ')})</span> : null}</li>)}
          </ul>
        </Fold>
      )}
      {ver && (
        <div role={ver.available ? undefined : 'alert'} style={ver.available ? { color: R.dim } : { color: R.text, fontWeight: 700, border: `1px dashed ${R.amber}`, background: tint(R.amber, 10), borderRadius: 6, padding: '4px 8px' }}>
          {ver.text}
        </div>
      )}
      {progress && <div data-ss-progress style={{ color: R.text }}>{progress}</div>}
      {before && <div style={{ color: R.dim }}>{before}. The boxes above show only events that passed the check.</div>}
      {(awaitingN > 0 || awaiting.length > 0) && (
        <Fold data-ss-awaiting="" summary={<><b>Awaiting verification ({awaitingN})</b> <span style={{ color: R.dim }}>— hidden from the lists until the company document confirms them{reasons.length ? `: ${reasons.map((r) => `${r.label} ${r.count}`).join(' · ')}` : ''}</span></>}>
          {awaiting.length === 0 ? <div style={{ color: R.dim, paddingTop: 4 }}>The list itself was not sent with this payload.</div> : (
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {awaiting.slice(0, LIST_CAP).map((r, i) => (
                <li key={`${r.claimId || r.refId || i}`} style={{ overflowWrap: 'anywhere' }}>
                  {awaitingRowLine(r)}
                  {r.primaryUrl ? <> · <a href={r.primaryUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>document</a></> : null}
                </li>
              ))}
              {(awaitingN > Math.min(awaiting.length, LIST_CAP)) && <li style={{ color: R.dim }}>and {awaitingN - Math.min(awaiting.length, LIST_CAP)} more (first {Math.min(awaiting.length, LIST_CAP)} listed here).</li>}
            </ul>
          )}
        </Fold>
      )}
      {audit.length > 0 && (
        <Fold data-ss-audit="" summary={<><b>Removed after the AI check ({audit.length})</b> <span style={{ color: R.dim }}>— the company document does not support the headline</span></>}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {audit.slice(0, LIST_CAP).map((r, i) => (
              <li key={`${r.claimId || r.refId || i}`} style={{ overflowWrap: 'anywhere' }}>
                {auditRowLine(r)}
                {r.quote ? <span style={{ color: R.dim }}> — the document says: “{r.quote}”</span> : null}
                {r.documentUrl ? <> · <a href={r.documentUrl} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>document</a></> : null}
              </li>
            ))}
          </ul>
        </Fold>
      )}
      {(raw.length > 0 || rawOnly.length > 0) && (
        <Fold summary={<span style={{ color: R.dim }}>Coverage before the checks (RAW, pre-filter)</span>}>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: R.text }}>
            {raw.length > 0
              ? raw.map((r) => <li key={r.bucket}>{r.bucket}: {r.shown} shown of {r.raw} raw</li>)
              : rawOnly.map((r) => <li key={r.bucket}>{r.bucket}: {r.raw} raw</li>)}
          </ul>
        </Fold>
      )}
    </div>
  );
}

/** zzz856 — top banner when nothing is verified yet but items wait for the company-document check. Renders nothing otherwise. */
export function SsVerifyBanner({ feed }: { feed: SsCountFeed | null | undefined }) {
  const text = feed ? nothingVerifiedBanner(feed.count_model, feed.verification as any, feed.awaitingVerificationCount) : null;
  if (!text) return null;
  return (
    <div data-ss-nothing-verified role="status" style={{ margin: '6px 0', padding: '8px 12px', border: `1px solid ${R.amber}`, borderLeft: `4px solid ${R.amber}`, borderRadius: 6, background: R.bg, color: R.text, fontSize: 13, fontWeight: 600 }}>
      {text}
    </div>
  );
}

export const SHOW_UNVERIFIED_KEY = 'mc:specsit:showUnverified';
/** The opt-in toggle's state: default OFF, remembered for this browser tab only (sessionStorage), every access guarded. */
export function useShowUnverified(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => { try { if (window.sessionStorage.getItem(SHOW_UNVERIFIED_KEY) === '1') setOn(true); } catch { /* storage blocked */ } }, []);
  const set = (v: boolean) => { setOn(v); try { if (v) window.sessionStorage.setItem(SHOW_UNVERIFIED_KEY, '1'); else window.sessionStorage.removeItem(SHOW_UNVERIFIED_KEY); } catch { /* storage blocked */ } };
  return [on, set];
}

export function ShowUnverifiedToggle({ on, onChange, count }: { on: boolean; onChange: (v: boolean) => void; count: number }) {
  return (
    <label data-ss-unverified-toggle style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: R.text, cursor: 'pointer', margin: '4px 0' }}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      Show unverified items (labelled){count > 0 ? ` — ${count}` : ''}
    </label>
  );
}

const UNVERIFIED_STEP = 50;
/** zzz856 — awaiting events as plain cards in their own section: grey dashed, the reason on each card, no Tier or decision badges. Not counted in any box. */
export function UnverifiedSection({ events, awaiting, region = 'ALL' }: { events: ReadonlyArray<UnverifiedEventIn> | null | undefined; awaiting?: SsCountFeed['awaitingVerification']; region?: string }) {
  const [limit, setLimit] = useState(UNVERIFIED_STEP);
  const cards = unverifiedCards(events, awaiting, region);
  return (
    <section data-ss-unverified style={{ border: `1px dashed ${R.grey}`, borderRadius: 8, padding: '10px 12px', background: R.bg, color: R.text }}>
      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '0.3px', color: R.dim }}>UNVERIFIED — not confirmed by a company document</div>
      <div style={{ fontSize: 12, color: R.dim, margin: '2px 0 8px' }}>
        {cards.length} item{cards.length === 1 ? '' : 's'}{region !== 'ALL' ? ` in region ${region}` : ''}. Shown only because you asked. They are not in any box or count above and carry no tier or decision. Ordered by how they ranked before the hold.
      </div>
      {cards.length === 0 ? <div style={{ fontSize: 12, color: R.dim }}>No unverified items in this payload.</div> : (
        <div style={{ display: 'grid', gap: 6 }}>
          {cards.slice(0, limit).map((c) => (
            <div key={c.id} data-ss-unverified-card style={{ border: `1px dashed ${R.grey}`, borderRadius: 6, padding: '6px 10px', fontSize: 12, overflowWrap: 'anywhere' }}>
              <div><b>{c.company}</b>{c.region ? <span style={{ color: R.dim }}> · {c.region}</span> : null}</div>
              <div>{c.headline}</div>
              <div style={{ color: R.dim }}>Why unverified: {c.reason}{c.link ? <> · <a href={c.link} target="_blank" rel="noopener noreferrer" style={{ color: R.cyan }}>source</a></> : null}</div>
            </div>
          ))}
          {cards.length > limit && (
            <button type="button" onClick={() => setLimit((n) => n + UNVERIFIED_STEP)} style={{ justifySelf: 'start', padding: '4px 12px', fontSize: 12, borderRadius: 6, border: `1px solid ${R.border}`, background: 'transparent', color: R.text, cursor: 'pointer' }}>
              Show {Math.min(UNVERIFIED_STEP, cards.length - limit)} more ({cards.length - limit} left)
            </button>
          )}
        </div>
      )}
    </section>
  );
}
