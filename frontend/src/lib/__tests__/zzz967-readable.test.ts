import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readableOn, contrast } from '../readable-color';

test('zzz967 legend numbers reach 4.5:1 without changing a colour that already reads', () => {
  const y = readableOn('rgb(255,214,0)', '#FFFFFF');
  assert.ok(contrast('rgb(255,214,0)', '#FFFFFF')! < 2);
  assert.ok(contrast(y, '#FFFFFF')! >= 4.5);
  assert.equal(readableOn('#1E3A8A', '#FFFFFF'), '#1E3A8A');
  assert.ok(contrast(readableOn('#1E3A8A', '#0B0F19'), '#0B0F19')! >= 4.5);
});
