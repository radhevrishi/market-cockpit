// zzz863 — an AI-confirmed claim moves into Active; anything that fails another Active rule stays a claim.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { promoteConfirmed } from '../guidance-promote';
import { buildUniverse, summarize } from '../guidance-universe';
import { getSeedRows } from '../guidance-universe-service';

const NOW = new Date('2026-10-02T09:00:00Z');
const b = buildUniverse([], null, getSeedRows().rows, NOW, {});
const tag = (r: any, status = 'AI_CONFIRMED') => ({ ...r, aiVerification: { status, checkedAt: '2026-10-02T08:00:00Z', documentUrl: 'https://example.test/doc.pdf' } });

describe('promoteConfirmed', () => {
  test('unconfirmed claims stay claims', () => {
    const r = promoteConfirmed({ defaultRecords: b.defaultRecords, claimsAwaiting: b.claimsAwaiting ?? [] });
    assert.equal(r.promoted.length, 0); assert.equal(r.claimsAwaiting.length, (b.claimsAwaiting ?? []).length);
  });
  test('a confirmed, otherwise-clean claim becomes an Active row sourced to the company document', () => {
    const clean = (b.claimsAwaiting ?? []).filter((r) => r.points.every((p) => p.periodStatus === 'CONFIRMED' && !p.needsReview && !p.eventOverride && p.growthType !== 'IMPLIED') && r.companyId && r.tickerResolved);
    assert.ok(clean.length > 0, 'the seed has at least one clean claim');
    const confirmed = clean.map((r) => tag(r));
    const rest = (b.claimsAwaiting ?? []).filter((r) => !clean.includes(r));
    const out = promoteConfirmed({ defaultRecords: b.defaultRecords, claimsAwaiting: [...confirmed, ...rest] });
    assert.equal(out.claimsAwaiting.length, rest.length);
    assert.equal(out.defaultRecords.length, b.defaultRecords.length + clean.length);
    const added = out.defaultRecords.slice(b.defaultRecords.length)[0];
    assert.equal(added.points[0].primarySourceRead, true); assert.equal(added.points[0].listBucket, 'ACTIVE'); assert.equal(added.points[0].sourceUrl, 'https://example.test/doc.pdf');
    assert.match(added.points[0].wording, /Company|company/);
    const s = summarize(out.defaultRecords, NOW, 30, b.inactive, b.reviewQueue, out.claimsAwaiting);
    assert.ok(s.highGrowthGroups, 'groups built');
  });
  test('a confirmed claim that is flagged for review or implied is NOT promoted', () => {
    const flagged = (b.claimsAwaiting ?? []).find((r) => r.points.some((p) => p.needsReview || p.growthType === 'IMPLIED'));
    assert.ok(flagged);
    const out = promoteConfirmed({ defaultRecords: [], claimsAwaiting: [tag(flagged)] });
    assert.equal(out.promoted.length, 0);
  });
  test('an AI-contradicted or awaiting tag never promotes', () => {
    const c = (b.claimsAwaiting ?? [])[0];
    assert.equal(promoteConfirmed({ defaultRecords: [], claimsAwaiting: [tag(c, 'AWAITING')] }).promoted.length, 0);
  });
});
