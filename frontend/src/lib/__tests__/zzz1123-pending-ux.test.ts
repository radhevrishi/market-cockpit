// zzz1123–1126 — Guidance Upgrades as four workspaces; screen compare in plain words; a workflow chip that only repeats a top card is not
// shown twice; a class-share list ticker (MOG-A) finds its data row (MOG.A) and a missing holding says why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GU_WORKSPACES, parseWorkspace, sectionShown } from '../gu-workspace';
import { compareRules, rulesInWords } from '../screener/screen-compare';
import { uniqueWorkflows, WORKFLOWS, aliasListToRows, notInDataReason } from '../screener/pine-view';
import { filterLabel, type Filter } from '../screener/filters';

test('workspaces: every section belongs to one, Everything shows all, bad URL values are ignored', () => {
  assert.deepEqual(GU_WORKSPACES.map((w) => w.id), ['focus', 'changes', 'active', 'review', 'all']);
  assert.equal(parseWorkspace('active'), 'active'); assert.equal(parseWorkspace('nope'), null);
  assert.ok(sectionShown('focus', 'focus') && !sectionShown('focus', 'events'));
  assert.ok(sectionShown('active', 'summary') && sectionShown('active', 'browser'));
  assert.ok(sectionShown('review', 'checks') && sectionShown('review', 'namecheck'));
  for (const s of ['focus', 'events', 'summary', 'browser', 'namecheck', 'checks'] as const) assert.ok(sectionShown('all', s));
  const page = readFileSync(new URL('../../app/(dashboard)/guidance-upgrades/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /role="tablist" aria-label="Guidance workspaces"/);
});

test('compare in plain words: what only one screen has, what changed, how many are the same', () => {
  const a: Filter[] = [{ kind: 'num', key: 'mc', op: 'gt', v: 1000 } as any, { kind: 'num', key: 'rsi', op: 'gt', v: 50 } as any];
  const b: Filter[] = [{ kind: 'num', key: 'mc', op: 'gt', v: 5000 } as any, { kind: 'num', key: 'rsi', op: 'gt', v: 50 } as any, { kind: 'num', key: 'perfYTD', op: 'gt', v: 0 } as any];
  const w = rulesInWords(compareRules(a, b), (f) => filterLabel(f, 'US'));
  assert.match(w.join(' '), /Only B has: .+\./); assert.match(w.join(' '), /Same field, different limit: A “.+” vs B “.+”/); assert.match(w.join(' '), /1 rule is identical/);
  assert.deepEqual(rulesInWords(compareRules(a, a), (f) => filterLabel(f, 'US')), ['The two screens apply the same rules.']);
});

test('a chip that repeats a top card is not shown twice; list-scoped chips stay', () => {
  const u = uniqueWorkflows();
  assert.ok(!u.some((x) => x.id === 'm-bases')); assert.ok(u.some((x) => x.id === 'pf-opps')); assert.ok(u.length < WORKFLOWS.length);
});

test('MOG-A finds MOG.A; an unknown holding says why', () => {
  const l = aliasListToRows(new Set(['MOG-A', 'XPEV', 'AAPL']), [{ t: 'MOG.A' }, { t: 'AAPL' }])!;
  assert.deepEqual(Array.from(l).sort(), ['AAPL', 'MOG.A', 'XPEV']);
  assert.match(notInDataReason('XPEV', 'US'), /ADRs \/ ADS/);
  assert.equal(aliasListToRows(null, []), null);
});
