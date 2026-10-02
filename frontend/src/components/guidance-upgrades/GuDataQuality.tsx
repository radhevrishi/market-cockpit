'use client';
// zzz860 — DATA QUALITY banner above the rankings. One line per market from the collectors' own numbers (never guessed), plus the "not exhaustive" footnote.
import React from 'react';
import type { GuDataQuality as Q, GuMarketQuality } from '@/lib/guidance-pipeline-coverage';
import { R, tint } from './gu-tokens';
import { LazyDetails } from './GuMore';
import { SOURCE_COVERAGE_TEXT, VERIFICATION_STAGE_TEXT } from '@/lib/guidance-pipeline-state';

const COLOR = { COMPLETE: R.green, PARTIAL: R.amber, PRIMARY_PENDING: R.amber, STALE: R.amber, SOURCE_FAILED: R.red, NO_SOURCE_DATA: R.red } as const;
const SC_COLOR: Record<string, string> = { COMPLETE: R.green, PARTIAL: R.amber, STALE: R.amber, SOURCE_FAILED: R.red, NO_SOURCE_DATA: R.red };
const VS_COLOR: Record<string, string> = { VERIFIED: R.green, PARTLY_VERIFIED: R.amber, PRIMARY_PENDING: R.amber, NOTHING_TO_VERIFY: R.grey };
const Chip = ({ label, text, color }: { label: string; text: string; color: string }) => (
  <span style={{ fontSize: 11.5, color: R.dim }}>{label}: <b style={{ fontWeight: 800, color, border: `1px solid ${tint(color, 45)}`, background: tint(color, 10), borderRadius: 10, padding: '0 8px' }}>{text}</b></span>
);
const CHIP: Record<string, string> = { COMPLETE: 'COMPLETE', PARTIAL: 'PARTIAL', PRIMARY_PENDING: 'PRIMARY PENDING', STALE: 'STALE', SOURCE_FAILED: 'SOURCE FAILED', NO_SOURCE_DATA: 'NO SOURCE DATA' };
const NAME = { IN: 'India', US: 'USA' } as const;
/** zzz863: ONE short row per market. The long sentence, the reasons and every number behind it sit in "Details". */
function Row({ m }: { m: GuMarketQuality }) {
  const i = m.inputs;
  const stats = i ? `${i.documentsPending} documents waiting · ${i.claims} claims · ${i.verifiedGuidance} verified` : '';
  return (
    <div data-gu-dq-line={m.market} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline', fontSize: 12.5 }}>
      <b style={{ minWidth: 44 }}>{NAME[m.market]}</b>
      {m.sourceCoverage && m.verification ? (<><Chip label="Sources" text={SOURCE_COVERAGE_TEXT[m.sourceCoverage]} color={SC_COLOR[m.sourceCoverage]} /><Chip label="Verification" text={VERIFICATION_STAGE_TEXT[m.verification]} color={VS_COLOR[m.verification]} /></>) : <span style={{ fontWeight: 800, color: COLOR[m.status] }}>{CHIP[m.status] ?? m.status}</span>}
      {stats && <span style={{ color: R.dim }}>{stats}</span>}
    </div>
  );
}
export function GuDataQuality({ quality }: { quality: Q | null | undefined }) {
  if (!quality) return (
    <div data-gu-data-quality role="note" style={{ fontSize: 12.5, color: R.amber }}>DATA QUALITY: coverage numbers could not be read, so the counts below must not be treated as complete.</div>
  );
  const { IN, US } = quality.markets;
  return (
    <div data-gu-data-quality role="note" style={{ border: `1px solid ${R.border}`, borderLeft: `3px solid ${quality.exhaustive ? R.green : R.amber}`, borderRadius: 8, padding: '8px 12px', display: 'grid', gap: 4 }}>
      <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: 0.5, color: R.dim }}>DATA QUALITY{quality.exhaustive ? '' : ' · counts are not complete yet'}</div>
      <Row m={IN} /><Row m={US} />
      <LazyDetails summary={<summary style={{ cursor: 'pointer', fontSize: 12, color: R.dim }}>Details: what is missing and why</summary>}>
        <div style={{ display: 'grid', gap: 6, fontSize: 12, color: R.dim }}>
          {[IN, US].map((m) => (
            <div key={m.market} data-gu-dq-detail={m.market}>
              <b style={{ color: R.text }}>{m.line}</b>
              {m.reasons?.length ? <div data-gu-dq-reasons>{m.reasons.join(' ')}</div> : null}
              <div>{NAME[m.market]}, saved-document store, last {m.windowDays} days ({m.tradingDays} trading days): {m.daysFullyCovered} fully covered, {m.daysPartial} partly covered, {m.daysFailed} failed, {m.daysNotRead} not read. Documents: {m.documentsDiscovered} found, {m.documentsProcessed} read, {m.documentsPending} pending.</div>
            </div>
          ))}
          {quality.footnote && <div style={{ color: R.amber }}>{quality.footnote}</div>}
          <div data-gu-dq-why>The store numbers count only documents the collectors have saved. The lines above also count filings the live scan found and queued, and the days it read straight from the exchange, so the two sets are different measures and are not expected to match.</div>
          <div data-gu-datasets>Four separate lists on this page: <b style={{ color: R.text }}>Guidance universe</b> (all guidance in force today) · <b style={{ color: R.text }}>Upgrade events</b> (changes inside the chosen window) · <b style={{ color: R.text }}>Claim queue</b> (media claims waiting for the company document) · <b style={{ color: R.text }}>Document queue</b> (company filings waiting to be read).</div>
        </div>
      </LazyDetails>
    </div>
  );
}
