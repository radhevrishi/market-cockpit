// zzz1264 — a company whose quarter was graded on an earlier day is not a new card "reported today" (AEQUS: 27 Oct → 11 Nov).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shownEarlierIndex, moveShownEarlier, earlierDayFor, daysBefore, SHOWN_EARLIER_LOOKBACK_DAYS } from '../india-shown-earlier';
import { clearGradedSessionMemo } from '../graded-session-index';
import { gradedKeyCandidates } from '../graded-cache-key';
import { US_SESSION_LOOKBACK, priorSessions } from '../us-session-dedupe';

const key = (d: string) => gradedKeyCandidates(d)[0];
const card = (ticker: string, quarter: string, fig = true) => ({ ticker, company: `${ticker} Ltd`, quarter, ...(fig ? { sales_yoy_pct: 12, net_profit_yoy_pct: 20 } : {}) });
const now = Date.parse('2026-11-11T18:00:00Z');
const deps = (store: Record<string, any>) => ({ now: () => now, regrade: (p: any) => p, mget: async (keys: string[]) => keys.map((k) => store[k] ?? null) });

test('the whole season is checked, weekends included, earliest day with figures keeps the card', async () => {
  assert.equal(daysBefore('2026-11-11').length, SHOWN_EARLIER_LOOKBACK_DAYS);
  assert.equal(daysBefore('2026-11-11')[0], '2026-11-10');
  clearGradedSessionMemo();
  const store = {
    [key('2026-10-27')]: { by_tier: { MIXED: [card('AEQUS', 'Q2 FY27')] } },
    [key('2026-10-17')]: { by_tier: { STRONG: [card('KROSS', 'Q2 FY27')] } },                    // a Saturday
    [key('2026-11-10')]: { by_tier: { MIXED: [card('HINDCOPPER', 'Q2 FY27', false), card('AEQUS', 'Q2 FY27', false)] } },
    [key('2026-08-10')]: { by_tier: { MIXED: [card('GLOTTIS', 'Q1 FY27')] } },
  };
  const idx = await shownEarlierIndex('2026-11-11', deps(store));
  assert.equal(idx.withFigures.get('AEQUS|Q2 FY27'), '2026-10-27');
  assert.equal(idx.withFigures.get('KROSS|Q2 FY27'), '2026-10-17');
  assert.equal(idx.withFigures.has('HINDCOPPER|Q2 FY27'), false);
  assert.equal(idx.any.get('HINDCOPPER|Q2 FY27'), '2026-11-10');

  const day = { by_tier: { BLOCKBUSTER: [], STRONG: [card('TGVSL', 'Q2 FY27')], MIXED: [card('AEQUS', 'Q2 FY27', false), card('HINDCOPPER', 'Q2 FY27'), card('GLOTTIS', 'Q2 FY27')], AVOID: [] }, _other_day_cards: [{ ticker: 'AMBIKCO', _first_shown: '2026-11-07' }] };
  const out: any = moveShownEarlier(day, idx);
  assert.deepEqual(out.by_tier.MIXED.map((c: any) => c.ticker), ['HINDCOPPER', 'GLOTTIS']);   // figures today beat a figure-less earlier card; another quarter is another card
  assert.deepEqual(out._other_day_cards.map((c: any) => `${c.ticker}@${c._first_shown}`), ['AMBIKCO@2026-11-07', 'AEQUS@2026-10-27']);
  assert.match(out._dropped[0].reason, /^already shown on 2026-10-27 \(same Q2 FY27 results\)/);
  assert.equal(day.by_tier.MIXED.length, 3);                                                  // the input is untouched
  // a figure-less card today, a figure-less card earlier: the earlier day keeps it
  assert.equal(earlierDayFor(card('HINDCOPPER', 'Q2 FY27', false), idx), '2026-11-10');
  // nothing to move → the same object back
  const same = { by_tier: { STRONG: [card('TGVSL', 'Q2 FY27')] } };
  assert.equal(moveShownEarlier(same, idx), same);
  clearGradedSessionMemo();
});

test('USA: the look-back covers a results season', () => {
  assert.equal(US_SESSION_LOOKBACK, 40);
  const p = priorSessions('2026-11-11');
  assert.equal(p.length, 40); assert.equal(p[0], '2026-11-10'); assert.ok(p[39] < '2026-09-20');
});
