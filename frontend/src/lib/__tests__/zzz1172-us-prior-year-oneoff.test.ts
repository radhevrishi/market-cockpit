// zzz1172 — OSBC Q3 2026: GAAP EPS $0.18 → $0.56 (+211%) off a year-ago one-off; adjusted $0.53 → $0.55 (+4%), consensus missed.
// Graded on core growth, not the optical +211%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gradeUsRow } from '../us-earnings-core';

const base = (over: any = {}) => ({ ticker: 'X', is_financial: true, consensus_beat_pct: -5, ...over,
  fundamentals: { revenue: 97.1e6, revenue_prev: 95.9e6, net_income: 28.9e6, net_income_prev: 9.87e6, eps: 0.56, eps_prev: 0.18, ...(over.fundamentals || {}) } });

test('a year-ago one-off: graded on core EPS, not STRONG; GAAP figures still reported', () => {
  const r: any = gradeUsRow(base({ adj_eps: 0.55, adj_eps_prev: 0.53 }) as any);
  assert.ok(!['STRONG', 'BLOCKBUSTER'].includes(r.tier), `got ${r.tier}`);
  assert.ok(r.caveat_tags.some((t: string) => /prior-year one-off/.test(t)));
  assert.equal(Math.round(r.eps_yoy_pct), 211);
});

test('no year-ago one-off (GAAP ≈ adjusted last year): unchanged', () => {
  const r: any = gradeUsRow(base({ adj_eps: 0.56, adj_eps_prev: 0.19 }) as any);
  assert.ok(!r.caveat_tags.some((t: string) => /prior-year one-off/.test(t)));
});
