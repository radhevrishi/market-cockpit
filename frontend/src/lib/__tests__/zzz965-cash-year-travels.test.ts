import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { indiaCashView } from '../india-grade';

// MANINDS read '— not in source' on its cash tile while enrich had CFO/PAT 2.78x for FY26: the rows the page grades
// live (and the server regrade) dropped `cash_fy`, and a ratio without its year is ignored on purpose (zzz821).
test('zzz965 the cash year travels with the ratio wherever a row is rebuilt', () => {
  for (const f of ['../india-regrade.ts', '../../app/(dashboard)/earnings-opportunities/helpers.ts', '../../app/(dashboard)/earnings-opportunities/page.tsx']) {
    const src = readFileSync(join(__dirname, f), 'utf8');
    assert.match(src, /cash_fy:/, f);
  }
  const v = indiaCashView({ symbol: 'MANINDS', ocf_annual_cr: 472, pat_annual_cr: 170, ocf_to_pat_ratio: 2.78, cash_fy: 'Mar 2026', cash_basis: 'FY26 full year' });
  assert.equal(v.ratio, 2.78);
  assert.equal(indiaCashView({ symbol: 'MANINDS', ocf_annual_cr: 472, pat_annual_cr: 170, ocf_to_pat_ratio: 2.78 }).ratio, null);   // why the year must travel
});
