// zzz920 — share rows are not growth; the company-wide growth row beats a segment row; growth on a product line is a part.
// Run: npx tsx --test src/lib/__tests__/zzz920-guidance-parts.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { scopeIssueOf } from '../guidance-horizon';
import { rateRowOf } from '../ai-guidance-extract';
import { itemsFromExtracted } from '../guidance-universe';
import { actualsFromDocs } from '../guidance-extract-reader';
import type { ExtractedGuidance, GuidanceExtractResult } from '../guidance-docs-types';

const NOW = new Date('2026-10-06T17:00:00Z');
const xrow = (o: Partial<ExtractedGuidance> & { metric: any; period: string; quote: string }): ExtractedGuidance => ({
  metricLabel: '', periodKind: 'ANNUAL', basis: 'UNSTATED', currency: null, unit: '%', low: null, high: null, growthPctLow: null, growthPctHigh: null, status: 'NEW',
  prior: null, priorActual: null, speaker: null, confidence: 0.8, ...o,
} as ExtractedGuidance);
const xres = (t: string, company: string, rows: ExtractedGuidance[]): GuidanceExtractResult => ({
  docId: `d${t}`, market: 'IN', ticker: t, company, docUrl: 'https://x/y.pdf', docKind: 'TRANSCRIPT', filedAt: '2026-08-13T00:00:00.000Z',
  extractedAt: '2026-10-05T00:00:00Z', model: 'm', status: 'ok', rows, dropped: 0,
} as any);

describe('zzz920 parts and shares', () => {
  test('SBCL share-of-revenue quotes stay shares; a real growth sentence still becomes growth', () => {
    const share = rateRowOf({ metric: 'REVENUE', unit: '%', low: 44, high: 45, growth_pct_low: null, growth_pct_high: null, quote: 'around 44-45% of revenue coming from Bimetal' } as any);
    assert.equal(share.growth_pct_low, null);
    const g = rateRowOf({ metric: 'REVENUE', unit: '%', low: 20, high: 30, growth_pct_low: null, growth_pct_high: null, quote: 'we expect revenue growth of 20 to 30% next year' } as any);
    assert.equal(g.growth_pct_low, 20);
  });
  test('AEQUS: the consolidated 45-50 row is shown, not the aerospace 25-30 row', () => {
    const r = xres('AEQUS', 'Aequs Ltd', [
      xrow({ metric: 'REVENUE_GROWTH', period: 'FY27', low: 25, high: 30, growthPctLow: 25, growthPctHigh: 30, quote: 'we are looking to grow aerospace revenue 25% to 30% in FY27' }),
      xrow({ metric: 'REVENUE_GROWTH', period: 'FY27', low: 45, high: 50, growthPctLow: 45, growthPctHigh: 50, quote: 'on a consolidated basis we expect revenue growth of 45% to 50% in FY27' }),
    ]);
    const it = itemsFromExtracted([r], actualsFromDocs([r]), NOW);
    assert.equal(it.length, 1);
    const s = JSON.stringify(it[0]);
    assert.ok(s.includes('45'), s.slice(0, 400));
  });
  test('Fredun: growth on a product line is a part; bottom-line growth is not', () => {
    assert.ok(scopeIssueOf('we expect 30-35% growth on the GX line', { metric: 'REVENUE_GROWTH', market: 'IN', company: 'Fredun Pharmaceuticals Ltd' }));
    assert.equal(scopeIssueOf('we expect 30-35% growth on the bottom line', { metric: 'REVENUE_GROWTH', market: 'IN', company: 'Fredun Pharmaceuticals Ltd' }), null);
  });
});
