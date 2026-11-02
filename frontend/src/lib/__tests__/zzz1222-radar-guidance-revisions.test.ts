import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectCaution } from '../transformation-analyzer';

test('maintained guidance in a DIFFERENT sentence cannot erase a genuine cut', () => {
 const text = 'Our FY27 revenue guidance was reduced due to weak demand. FY28 guidance is maintained.';
 const c = detectCaution(text);
 assert.ok(c.flags.includes('guidance reduced'));
 assert.equal(c.level, 2);
});
test('simple reaffirmation is not treated as a reduction', () => {
 assert.ok(!detectCaution('Management reaffirmed full-year guidance, with no change to the outlook.').flags.includes('guidance reduced'));
});
test('explicit denial is not a reduction', () => {
 assert.ok(!detectCaution('We have not lowered our revenue guidance.').flags.includes('guidance reduced'));
});
test('downward outlook revision without other negatives receives a caution flag', () => {
 assert.ok(detectCaution('The company revised outlook downward for FY27.').flags.includes('guidance reduced'));
});
