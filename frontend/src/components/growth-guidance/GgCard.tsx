'use client';
// zzz846 — the company card: the short facts only. Detail lives in the drawer.
import React from 'react';
import type { GgCompany } from '@/lib/growth-guidance-types';
import { CATALYST_LABEL, NOT_ESTABLISHED, QUALITY_LABEL, fmtGrowth, isAnalyst, isMuted, pointFor, verificationText } from '@/lib/growth-guidance-format';
import { R, box, tint } from './gg-tokens';
import { Chip, ConflictBanner, Field, HeldChip, KindChip, MarketTag, NotVerifiedBanner, OrganicChip, StatusDotView, ValidityChip } from './GgBits';

export function GgCard({ c, onOpen, unverified }: { c: GgCompany; onOpen: (id: string) => void; unverified?: boolean }) {
  const analyst = isAnalyst(c.primary?.kind);
  const muted = isMuted(c.validity);
  const catalyst = c.catalysts?.[0] ? CATALYST_LABEL[c.catalysts[0]] : null;
  const driver = (c.driverText || '').trim() || catalyst || NOT_ESTABLISHED;
  return (
    <div className="gg-card" style={box({ padding: 12, display: 'grid', gap: 8, opacity: muted ? 0.65 : 1, borderStyle: analyst || unverified ? 'dashed' : 'solid' })}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0 }}>
          <button type="button" onClick={() => onOpen(c.id)} style={{ all: 'unset', cursor: 'pointer', fontSize: 15, fontWeight: 800, color: R.text }}>{c.company}</button>
          <span style={{ fontSize: 12, color: R.dim, marginLeft: 8 }}>{c.ticker || 'ticker not resolved'}</span>
          <div><MarketTag c={c} /></div>
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', alignItems: 'center' }}>
          <KindChip c={c} /><OrganicChip c={c} />{muted && <ValidityChip v={c.validity} />}<HeldChip held={!!c.portfolio?.held} />
        </div>
      </div>
      {unverified && <NotVerifiedBanner />}
      <ConflictBanner c={c} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10 }}>
        <Field label={`${c.primary?.period || 'Period'} revenue growth`}>{fmtGrowth(pointFor(c, 'REVENUE'))}</Field>
        <Field label="PAT growth">{fmtGrowth(pointFor(c, 'PAT'))}</Field>
        <Field label="Driver">{driver}</Field>
        <Field label="Evidence">{verificationText(c.verification)} · {QUALITY_LABEL[c.quality] ?? ''}</Field>
        <Field label="Duration">{c.guidanceDuration || NOT_ESTABLISHED}</Field>
        <Field label="Tracking"><StatusDotView c={c} /></Field>
        <Field label="Next proof">{c.nextProof || NOT_ESTABLISHED}</Field>
      </div>
      <div className="gg-noprint"><button type="button" onClick={() => onOpen(c.id)} style={{ fontSize: 11, fontWeight: 700, padding: '4px 10px', borderRadius: 5, cursor: 'pointer', border: `1px solid ${R.cyan}`, background: tint(R.cyan, 12), color: R.cyan }}>See the proof</button></div>
    </div>
  );
}
export { Chip };
