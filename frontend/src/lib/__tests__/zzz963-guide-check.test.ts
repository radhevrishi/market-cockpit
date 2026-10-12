import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideLoweredInText, applyGuideCheck } from '../us-guide-check';

test('zzz963 filing text: lowered outlook sentences found, ordinary "lower costs" ignored', () => {
  assert.ok(guideLoweredInText('Revenue grew 27%. The Company lowered its fiscal 2027 GE program sales outlook to $32 million to $35 million. Margins held.'));
  assert.equal(guideLoweredInText('Revenue grew 27%. The Company lowered its fiscal 2027 GE program sales outlook to $32 million.')!.scope, 'segment');
  assert.ok(guideLoweredInText('We are reducing our full-year revenue guidance to $1.2 billion from $1.3 billion.'));
  assert.ok(guideLoweredInText('Full-year outlook was revised downward due to softer demand in Europe.'));
  assert.equal(guideLoweredInText('We lowered operating costs by 8% and reduced our debt by $40 million. Our guidance is unchanged.'), null);
  assert.equal(guideLoweredInText('We raised our full-year revenue outlook to $2.4 billion.'), null);
  assert.equal(guideLoweredInText('Factors that could cause results to differ include risks that we may lower our guidance.'), null);
});

test('zzz963 a lowered outlook moves only BLOCKBUSTER/STRONG to MIXED', () => {
  const g = { checked_at: '', lowered: true, scope: 'segment' as const, what: 'GE program sales outlook cut to $32–35M from $34–38M', quote: '', source: 'ai-web' as const, url: 'https://x', usd: 0.02 };
  const strong: any = { ticker: 'PKE', tier: 'STRONG', caveat_tags: [] };
  assert.equal(applyGuideCheck(strong, g), true);
  assert.equal(strong.tier, 'MIXED');
  assert.ok(strong.caveat_tags.some((t: string) => t.startsWith('guidance lowered')));
  const mixed: any = { ticker: 'X', tier: 'MIXED', caveat_tags: [] };
  assert.equal(applyGuideCheck(mixed, g), false);
  assert.equal(mixed.tier, 'MIXED');
  const fine: any = { ticker: 'Y', tier: 'BLOCKBUSTER', caveat_tags: [] };
  assert.equal(applyGuideCheck(fine, { ...g, lowered: false }), false);
  assert.equal(fine.tier, 'BLOCKBUSTER');
  const cutTag: any = { ticker: 'Z', tier: 'BLOCKBUSTER', caveat_tags: ['guidance cut'] };
  assert.equal(applyGuideCheck(cutTag, null), true);
  assert.equal(cutTag.tier, 'MIXED');
});

import { regradeWithWorkingCapital } from '../us-guide-check';
test('zzz962b a working-capital quarter swaps the no-cash caveat before regrading', () => {
  const r = regradeWithWorkingCapital({ ticker: 'PENG', tier: 'MIXED', caveat_tags: ['profit without operating cash', 'prelim · 10-Q pending'] });
  assert.ok(!r.caveat_tags.includes('profit without operating cash'));
  assert.equal(r.wc_rechecked, true);
});
