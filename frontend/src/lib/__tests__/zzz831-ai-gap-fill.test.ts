import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aiReadPlan, aiReadStatus } from '../thesis/ai-read';

const aiLedger = (t = '2026-09-22') => ({ latest_period: 'Q1 FY27', periods: { 'Q1 FY27': { updated_at: t, extracted_at: t, mode: 'full' } }, runs: [] }) as any;
const row = (symbol: string, missing: string[], ledger: any = aiLedger()) => ({ symbol, market: 'IN', ledger, assessment: { coverage: { missingCore: missing } } }) as any;

describe('zzz831 — names with missing core details are offered an AI fill', () => {
  it('counts gaps and puts a gap name in the bulk list even if AI already read it', () => {
    const rows = [row('AAA', ['Capacity utilisation']), row('BBB', [])];
    assert.equal(aiReadStatus(rows[0]).gaps, 1);
    const plan = aiReadPlan(rows);
    assert.deepEqual(plan.withGaps, ['AAA']);
    assert.ok(plan.all.includes('AAA'));
    assert.equal(aiReadStatus(rows[1]).gaps, 0);
    assert.ok(!plan.withGaps.includes('BBB'));
    assert.equal(plan.modeOf.AAA, 'force');
    assert.ok(plan.withGapsLabel.includes('(1)'));
  });
});
