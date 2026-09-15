'use client';

// ═══════════════════════════════════════════════════════════════════════════
// THE PROCESS PANEL  (zzz630)
//
// Three of the four things the bench could not answer, rendered per company:
// which kind of good quarter this is, whether management does what it says,
// and whether anything physical is holding the demand up. The fourth — the
// funnel — belongs to the page, not to a card, and lives there.
//
// Every claim shows its reasons, and every bucket shows what argued AGAINST
// it too. A label with no tension under it is an opinion wearing a badge.
// ═══════════════════════════════════════════════════════════════════════════

import React, { useMemo } from 'react';
import { bucketFor, managementRecord, bottleneckFor, BUCKET_META } from '@/lib/us-process';
import type { UsConvictionEntry } from '@/lib/conviction-beats-us';

const DIM = 'var(--mc-text-3)';
const MUT = 'var(--mc-text-2)';
const TXT = 'var(--mc-text-0)';

export default function UsProcessPanel({ e, siblings, themeId }: {
  e: UsConvictionEntry;
  /** Every bench entry for this ticker, so the management record can span
   *  quarters rather than judging a company on one print. */
  siblings?: UsConvictionEntry[];
  themeId?: string | null;
}) {
  const b = useMemo(() => bucketFor(e), [e]);
  const meta = BUCKET_META[b.bucket];
  const mgmt = useMemo(() => managementRecord(siblings && siblings.length ? siblings : [e]), [siblings, e]);
  const bn = useMemo(() => bottleneckFor(e.ticker, themeId ?? null), [e.ticker, themeId]);

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--mc-bg-4)' }}>
      <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 0.5, color: MUT, marginBottom: 7 }}>
        🧭 THE PROCESS — which kind of quarter, who is running it, and what is holding demand up
      </div>

      {/* ── 1. WHICH BUCKET ────────────────────────────────────────────── */}
      <div style={{ background: `${meta.color}0f`, border: `1px solid ${meta.color}3d`, borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, color: meta.color, letterSpacing: 0.4 }}>
            {b.bucket !== '?' && b.bucket !== 'F' ? `${b.bucket} · ` : ''}{meta.label.toUpperCase()}
          </span>
          <span style={{ fontSize: 10.5, color: MUT, flex: 1, minWidth: 220, lineHeight: 1.5 }}>{meta.blurb}</span>
        </div>
        {b.reasons.length > 0 && (
          <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 10.5, color: MUT, lineHeight: 1.55 }}>
            {b.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        {/* THE TENSION IS THE POINT. A classifier that only prints its
            supporting evidence is a classifier you cannot argue with. */}
        {b.against.length > 0 && (
          <div style={{ marginTop: 6, paddingTop: 5, borderTop: `1px dashed ${meta.color}33` }}>
            <div style={{ fontSize: 9.5, fontWeight: 800, color: '#F59E0B', marginBottom: 2 }}>AGAINST THIS READ</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 10, color: '#F59E0B', lineHeight: 1.55 }}>
              {b.against.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* ── 2. MANAGEMENT · PROMISE AGAINST DELIVERY ───────────────────── */}
      <div style={{ marginTop: 8, background: 'var(--mc-bg-1)', border: '1px solid var(--mc-bg-4)', borderRadius: 8, padding: '8px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: 0.4, color: mgmt.hitRate == null ? DIM : mgmt.hitRate >= 80 ? '#22C55E' : mgmt.hitRate >= 60 ? '#EAB308' : '#EF4444' }}>
            👔 MANAGEMENT{mgmt.hitRate != null ? ` · ${mgmt.hitRate}%` : ''}
          </span>
          <span style={{ fontSize: 10.5, color: MUT, flex: 1, minWidth: 240, lineHeight: 1.5 }}>{mgmt.verdict}</span>
        </div>
        <div style={{ fontSize: 9.5, color: DIM, marginTop: 4, lineHeight: 1.5 }}>
          Measured only against numbers the company published itself and has since had to deliver — not a judgement of &ldquo;good management&rdquo;, which no filing supports.
          {mgmt.thin ? ' Too few marked metrics here to call it a record.' : ''}
        </div>
        {mgmt.detail.length > 0 && (
          <ul style={{ margin: '5px 0 0', paddingLeft: 16, fontSize: 9.5, color: DIM, lineHeight: 1.5 }}>
            {mgmt.detail.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        )}
      </div>

      {/* ── 3. THE BOTTLENECK ─────────────────────────────────────────── */}
      <div style={{ marginTop: 8, background: bn ? 'rgba(34,197,94,0.06)' : 'var(--mc-bg-1)', border: `1px solid ${bn ? 'rgba(34,197,94,0.3)' : 'var(--mc-bg-4)'}`, borderRadius: 8, padding: '8px 10px' }}>
        {!bn ? (
          <div style={{ fontSize: 10.5, color: DIM, lineHeight: 1.5 }}>
            <b style={{ color: MUT }}>⛓ BOTTLENECK — none mapped.</b> This name is not on a tracked supply-constraint chain, so its growth has to stand on the company&rsquo;s own execution rather than on somebody else having no choice but to buy.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, fontWeight: 900, color: '#22C55E', letterSpacing: 0.4 }}>⛓ {bn.label.toUpperCase()}</span>
              {/* A NAMED PROXY AND A THEME COINCIDENCE ARE NOT THE SAME
                  EVIDENCE, so they are never printed as though they were. */}
              <span title={bn.link === 'named' ? 'This ticker is on the chain’s hand-curated proxy list' : 'Inferred from the rotation theme this name sits in — circumstantial, not curated'}
                style={{ fontSize: 8.5, fontWeight: 900, borderRadius: 4, padding: '1px 5px', color: bn.link === 'named' ? '#22C55E' : '#94A3B8', background: bn.link === 'named' ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)', border: `1px solid ${bn.link === 'named' ? '#22C55E55' : '#94A3B855'}` }}>
                {bn.link === 'named' ? `NAMED${bn.exposure ? ` · ${bn.exposure}` : ''}` : 'VIA THEME — circumstantial'}
              </span>
            </div>
            {bn.thesis && <div style={{ fontSize: 10.5, color: MUT, marginTop: 4, lineHeight: 1.5 }}>{bn.thesis}</div>}
            {bn.metric && (
              <div style={{ fontSize: 10, color: TXT, marginTop: 4, lineHeight: 1.5 }}>
                <b style={{ color: MUT }}>The constraint:</b> {bn.metric}{bn.metricDetail ? <span style={{ color: DIM }}> — {bn.metricDetail}</span> : null}
              </div>
            )}
            {bn.counter && (
              <div style={{ fontSize: 9.5, color: '#F59E0B', marginTop: 4, lineHeight: 1.5 }}>
                <b>What ends it:</b> {bn.counter}
              </div>
            )}
            {bn.link === 'theme' && (
              <div style={{ fontSize: 9, color: DIM, marginTop: 4 }}>
                This link comes from the theme this name sits in, not from a curated proxy list — treat it as a place to start looking, not as evidence.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
