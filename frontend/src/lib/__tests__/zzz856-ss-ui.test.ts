// zzz856 — Special Situations panel from a realistic feed payload (shapes built by the same functions the route uses):
// no empty list items, the "nothing verified yet" banner, verification progress, and the opt-in UNVERIFIED cards.
// Run: npx tsx --test src/lib/__tests__/zzz856-ss-ui.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { buildFeedCountModel } from '../special-sit-qa';
import { summariseHeldBack } from '../special-sit-feed-quality';
import type { AwaitingRow, VerificationSummary } from '../ai-verify-types';
import { SsCountPanel, SsVerifyBanner, UnverifiedSection, ShowUnverifiedToggle, type SsCountFeed } from '../../components/special-situations/SsCountPanel';
import { aiRunPhrase, nothingVerifiedBanner, unverifiedCards, verificationProgressLine } from '../../components/special-situations/ss-counts';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const liTexts = (h: string) => Array.from(h.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)).map((m) => strip(m[1]).trim());

// ── fixture: everything awaiting verification, as on the live page ──
const N_AWAIT = 70;
const awaitingRows: AwaitingRow[] = Array.from({ length: N_AWAIT }, (_, i) => ({
  claimId: `c${i}`, refId: `ev${i}`, kind: 'special_situation' as any, market: (i % 2 ? 'US' : 'IN') as any, company: `Company ${i}`, ticker: i % 3 ? `TK${i}` : null,
  claimText: `Company ${i} announces buyback`, reason: (i < 66 ? 'no_primary' : 'queued') as any,
  reasonText: i < 66 ? 'No primary document (company filing or exchange disclosure) is linked, so the claim cannot be checked.' : 'Not checked yet: queued for the AI verifier to read the primary document.',
  primaryUrl: i < 66 ? null : `https://example.com/f${i}`, sourceUrl: null, checkedAt: null,
}));
const heldItems = [
  ...Array.from({ length: N_AWAIT }, (_, i) => ({ feedQuarantineReason: 'AWAITING_VERIFICATION' as any, name: `Company ${i}` })),
  ...Array.from({ length: 7 }, (_, i) => ({ feedQuarantineReason: 'FUND_REPURCHASE_OFFER' as any, name: `Fund ${i}` })),
  ...Array.from({ length: 3 }, (_, i) => ({ feedQuarantineReason: 'AI_CONTRADICTED' as any, name: `Wrongco ${i}` })),
];
const countModel = buildFeedCountModel({
  rawItemCount: 2400, canonicalEvents: heldItems.length + 12, mergedDuplicates: 12, shown: [],
  heldBack: heldItems, rawCoverage: { 'M&A': 40, Buybacks: 20, 'Spin-offs': 6, Other: 9 },
});
const heldBack = summariseHeldBack(heldItems.map((h) => ({ reason: h.feedQuarantineReason, name: h.name })));
const verification: VerificationSummary = {
  provider: 'anthropic', model: 'm', available: true, unavailableReason: null, mode: 'enforce', primaryVerified: 0, checked: 0, confirmed: 0, contradicted: 3,
  awaiting: N_AWAIT, awaitingByReason: { no_primary: 66, queued: 4 }, lastRunAt: null,
};
const events = awaitingRows.map((r, i) => ({
  event_id: r.refId, quarantine_reason: 'AWAITING_VERIFICATION', category: 'HELD_BACK', tier: 'NOISE', region: r.market,
  tier_before_hold: i % 3 === 0 ? 'WATCHLIST' : i % 3 === 1 ? 'TIER_2' : 'TIER_1', category_before_hold: 'CAP', target_name: r.company,
  primary_filing: { title: r.claimText, link: r.primaryUrl || `https://news.example.com/${i}` },
}));
const feed: SsCountFeed = {
  count_model: countModel, held_back: heldBack, verification, awaitingVerification: awaitingRows, awaitingVerificationCount: N_AWAIT,
  verificationAudit: [], by_tier_before_verification: { TIER_1: 2, TIER_2: 30, WATCHLIST: 40 },
  coverage_diagnostic_raw: { label: 'RAW (pre-filter)', buckets: [{ bucket: 'M&A', count: 40 }] },
};

describe('count panel from a realistic payload', () => {
  test('every list item has text; equations, held-back reasons, awaiting rows and raw coverage all show', () => {
    const h = renderToStaticMarkup(React.createElement(SsCountPanel, { feed, knownCategories: ['MA', 'SPIN', 'TURN', 'CAP'] }));
    const lis = liTexts(h);
    assert.ok(lis.length >= 5 + 3 + 60 + 4, `expected many rows, got ${lis.length}`);
    for (const t of lis) assert.ok(t.length > 3, `empty list item: "${t}"`);
    const t = strip(h);
    assert.match(t, /✓ holds — E1: canonical events 92 = shown 0 \+ held back 80 \+ merged duplicates 12/);
    assert.match(t, /70 Awaiting|70 [A-Za-z]/);
    assert.match(t, /\(e\.g\. Company 0, Company 1, Company 2\)/);                 // up to 3 examples
    assert.match(t, /Company 1 \(TK1\) — Company 1 announces buyback — No primary document/);
    assert.match(t, /and 10 more/);
    assert.match(t, /M&A: 0 shown of 40 raw/);
    assert.match(t, /Verification progress: 0 confirmed by the AI check · 0 confirmed by the filing itself · 0 checked · 70 awaiting \(No company document to read 66 · Not checked yet 4\)/);
  });
  test('raw coverage falls back to coverage_diagnostic_raw when the count model has none', () => {
    const h = renderToStaticMarkup(React.createElement(SsCountPanel, { feed: { ...feed, count_model: { ...countModel, coverage_shown_vs_raw: [] } } }));
    assert.match(strip(h), /M&A: 40 raw/);
    for (const t of liTexts(h)) assert.ok(t.length > 3);
  });
});

describe('nothing verified yet', () => {
  test('banner: counts and AI state, unknown never invented', () => {
    assert.equal(nothingVerifiedBanner(countModel, verification, N_AWAIT),
      'Nothing verified yet. 70 items are waiting for the company-document check (AI check: not run yet, next run unknown). They are hidden until confirmed.');
    assert.equal(aiRunPhrase({ ...verification, lastRunAt: '2026-10-02T09:05:00Z', nextRunAt: '2026-10-02T09:35:00Z' } as any), 'AI check: last run 09:05 UTC, next run ~09:35 UTC');
    assert.equal(aiRunPhrase({ ...verification, lastRunAt: undefined } as any), 'AI check: last run unknown, next run unknown');
    assert.match(aiRunPhrase({ available: false, unavailableReason: 'Monthly cap reached.' }), /unavailable \(Monthly cap reached\)/);
    assert.equal(nothingVerifiedBanner({ ...countModel, shown: 4 }, verification, N_AWAIT), null);
    assert.equal(nothingVerifiedBanner(countModel, { ...verification, awaiting: 0 }, 0), null);
    assert.match(strip(renderToStaticMarkup(React.createElement(SsVerifyBanner, { feed }))), /Nothing verified yet\. 70 items/);
    assert.equal(renderToStaticMarkup(React.createElement(SsVerifyBanner, { feed: { ...feed, count_model: { ...countModel, shown: 1 } } })), '');
  });
  test('progress line prefers an explicit with/without document split when the route sends one', () => {
    assert.match(verificationProgressLine({ ...verification, awaitingWithPrimary: 4, awaitingNoPrimary: 66 } as any)!, /70 awaiting \(with a company document 4 · without 66\)/);
    assert.equal(verificationProgressLine(null), null);
  });
  test('toggle is off by default and labelled', () => {
    const h = renderToStaticMarkup(React.createElement(ShowUnverifiedToggle, { on: false, onChange: () => {}, count: 70 }));
    assert.match(strip(h), /Show unverified items \(labelled\) — 70/);
    assert.doesNotMatch(h, /checked=""/);
  });
});

describe('UNVERIFIED section', () => {
  test('cards sorted by tier before the hold, reason on each card, no tier or decision badges', () => {
    const cards = unverifiedCards(events, awaitingRows);
    assert.equal(cards.length, N_AWAIT);
    assert.deepEqual(cards.slice(0, 2).map((c) => c.tierBefore), ['TIER_1', 'TIER_1']);
    assert.equal(cards[cards.length - 1].tierBefore, 'WATCHLIST');
    assert.match(cards[0].reason, /No primary document/);
    assert.equal(unverifiedCards(events, awaitingRows, 'US').length, N_AWAIT / 2);
    assert.match(unverifiedCards([{ event_id: 'zz', quarantine_reason: 'AWAITING_VERIFICATION' }], [])[0].reason, /reason not sent/);
    assert.equal(unverifiedCards([{ event_id: 'x', quarantine_reason: 'FUND_REPURCHASE_OFFER' }], []).length, 0);
    const h = renderToStaticMarkup(React.createElement(UnverifiedSection, { events, awaiting: awaitingRows }));
    const t = strip(h);
    assert.match(t, /UNVERIFIED — not confirmed by a company document/);
    assert.match(t, /Why unverified: No primary document/);
    assert.match(h, /dashed/);
    assert.doesNotMatch(t, /Tier 1|Tier 2|TIER_|BUY|AVOID|ACCUMULATE/);
    assert.equal((h.match(/data-ss-unverified-card/g) || []).length, 50);
    assert.match(t, /Show 20 more \(20 left\)/);
  });
});
