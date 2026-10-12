import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashStatementWorkingCapitalBuild, releaseAttributesCashToWorkingCapital } from '../us-pr-financials';

const PENG = 'Cash flows from operating activities Net income $ 95,009 $ 46,183 $ 10,550 Adjustments to reconcile net income to cash Depreciation 12,299 12,307 13,206 Stock-based compensation expense 6,620 9,996 7,814 Inducement expense related to the conversion of the 2029 and 2030 Notes 33,248 — — Deferred income taxes, net (62,981) 291 (15,234) Changes in operating assets and liabilities: Accounts receivable (91,995) (333,660) (15,400) Inventories (250,467) (175,958) (70,834) Other assets (8,935) 12,708 (6,088) Accounts payable and accrued expenses and other liabilities 101,801 357,038 (2,894) Net cash provided by (used for) operating activities from continuing operations (163,136) (74,788) (70,432) Cash flows from investing activities';

test('zzz962 working-capital build read from the release cash-flow statement (Penguin Solutions)', () => {
  const r = cashStatementWorkingCapitalBuild(PENG)!;
  assert.equal(r.ni, 95009);
  assert.equal(r.cfo, -163136);
  assert.equal(r.wc, -91995 - 250467 - 8935 + 101801);
  assert.ok(r.preWcCfo > 0.5 * r.ni);
  assert.equal(r.explained, true);
  assert.equal(releaseAttributesCashToWorkingCapital(`<p>${PENG}</p>`), true);
});

test('zzz962 profit that never turned into cash, even before working capital → not explained', () => {
  const bad = PENG.replace('Accounts receivable (91,995)', 'Accounts receivable (1,995)').replace('Inventories (250,467)', 'Inventories (467)').replace('(163,136)', '(163,136)');
  const r = cashStatementWorkingCapitalBuild(bad)!;
  assert.equal(r.explained, false);
});
