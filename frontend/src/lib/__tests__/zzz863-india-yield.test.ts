// zzz863 — India yield (fair queue slots, every India results/call/presentation filing queued), honest counts, per-market lists, display rounding.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { incompleteNote } from '../../components/guidance-upgrades/gu-ui';
import { queueInputsFromFilings } from '../guidance-upgrades-sources';
import { enqueue, emptyQueue, selectDue } from '../guidance-upgrades-queue';
import { marketViewsOf } from '../guidance-universe-service';
import { fmtRangeBound } from '../guidance-upgrades-format';
import { resolveClaims } from '../guidance-claims';
import { buildUniverse } from '../guidance-universe';
import { getSeedRows } from '../guidance-universe-service';

const NOW = new Date('2026-10-02T09:00:00Z');

describe('queue', () => {
  const fil = (market: 'IN' | 'US', i: number, subject: string): any => ({ market, ticker: `T${market}${i}`, company: `Co ${market} ${i}`, subject, date: '2026-10-01', url: `https://x.test/${market}/${i}`, exchange: market === 'IN' ? 'NSE' : 'SEC EDGAR' });
  test('every India results / presentation / call filing is queued; unrelated India subjects are not', () => {
    const q = queueInputsFromFilings([fil('IN', 1, 'Financial Results for the quarter'), fil('IN', 2, 'Investor Presentation'), fil('IN', 3, 'Earnings Call Transcript'), fil('IN', 4, 'Change in Registered Office'), fil('IN', 5, 'Trading Window')]);
    assert.equal(q.length, 3);
  });
  test('selectDue gives India half of the slots even when 100 US documents are older and higher priority', () => {
    let st = emptyQueue(new Date('2026-09-01T00:00:00Z'));
    st = enqueue(st, Array.from({ length: 100 }, (_, i) => ({ market: 'US' as const, ticker: `U${i}`, company: `US ${i}`, sourceUrl: `https://u.test/${i}`, subject: 'Form 8-K earnings release', eventDate: '2026-09-01', priority: 'P0' as const })), new Date('2026-09-01T00:00:00Z')).queue;
    st = enqueue(st, Array.from({ length: 40 }, (_, i) => ({ market: 'IN' as const, ticker: `I${i}`, company: `IN ${i}`, sourceUrl: `https://i.test/${i}`, subject: 'Investor Presentation', eventDate: '2026-10-01', priority: 'P2' as const })), NOW).queue;
    const due = selectDue(st, NOW, 30);
    assert.equal(due.length, 30);
    assert.equal(due.filter((x) => x.market === 'IN').length, 15);
  });
  test('when one market has nothing waiting the other uses all the slots', () => {
    let st = emptyQueue(NOW);
    st = enqueue(st, Array.from({ length: 50 }, (_, i) => ({ market: 'IN' as const, ticker: `I${i}`, company: `IN ${i}`, sourceUrl: `https://i.test/${i}`, subject: 'Investor Presentation', eventDate: '2026-10-01', priority: 'P1' as const })), NOW).queue;
    assert.equal(selectDue(st, NOW, 30).length, 30);
  });
});

describe('honest numbers and lists', () => {
  test('the incomplete note states the real count and the India split (never "0" beside a tile showing more)', () => {
    const t = incompleteNote({ processed: 605, verifiedUpgrades: 180 }, { IN: { processed: 7, verifiedUpgrades: 1 }, US: { processed: 598, verifiedUpgrades: 179 } });
    assert.match(t, /^180 verified upgrades detected so far \(India 1, USA 179\)/);
    assert.match(t, /India is under-read/);
    assert.doesNotMatch(t, /0 verified upgrades DETECTED/);
  });
  test('marketViewsOf counts each market whatever filter the page applies', () => {
    const b = buildUniverse([], null, getSeedRows().rows, NOW, {});
    const mv = marketViewsOf(b);
    assert.equal(mv.IN.active + mv.IN.review + mv.IN.claims + mv.IN.history > 0, true, 'the researched India rows appear somewhere');
    assert.equal(mv.IN.claims, (b.claimsAwaiting ?? []).filter((r) => r.record.market === 'IN').length);
  });
  test('range bounds keep the digits that separate low from high', () => {
    assert.equal(fmtRangeBound(1.69, 'B'), '1.69B');
    assert.equal(fmtRangeBound(1.71, 'B'), '1.71B');
    assert.equal(fmtRangeBound(1234), '1,234');
    assert.equal(fmtRangeBound(null), fmtRangeBound(undefined));
  });
  test('a claim whose company has verified guidance for another metric says so instead of "no document yet"', () => {
    const b = buildUniverse([], null, getSeedRows().rows, NOW, {});
    const row = (b.claimsAwaiting ?? [])[0]; assert.ok(row);
    const tk = (row.tickers[0] || row.record.ticker || '').toUpperCase();
    const mk = row.record.market;
    const plain = resolveClaims([row], {});
    const withOther = resolveClaims([row], { verifiedCompanies: [`${mk}|${tk}`] });
    assert.match(plain[0].reason, /No company document/);
    assert.match(withOther[0].reason, /verified guidance for another metric/);
  });
});
