// zzz841 - Multibagger Radar UI: adapter, thesis ledger store, rendered tab. Synthetic names only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { eventToRadarInput, eventsToRadarInputs, companyFromTitle } from '../multibagger-radar-adapter';
import type { RadarFeedEvent } from '../multibagger-radar-feed-types';
import {
  LEDGER_KEY, LEDGER_CAP, NOT_ESTABLISHED, TAGS_KEY, addFromRadarItem, applyStatus, derivedTag, loadLedger, loadTags, parseLedger,
  removeEntry, saveEntry, saveLedger, setTag, updateStatus, TEXT_FIELDS, type StorageLike,
} from '../multibagger-ledger-store';
import { buildRadar } from '../multibagger-radar';
import { BUCKET_ORDER, BUCKET_LABEL, EVIDENCE_LABEL, type RadarItem } from '../multibagger-radar-types';
import MultibaggerRadar from '../../components/special-situations/MultibaggerRadar';
import { sharedDriversForHoldings } from '../../components/special-situations/HoldingsMonitor';

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ');

function mem(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; }, removeItem: (k) => { delete data[k]; } };
}

function ev(id: string, title: string, over: Partial<RadarFeedEvent> & Record<string, unknown> = {}): RadarFeedEvent {
  return {
    event_id: id, event_type: 'OTHER', category: 'OTHER', target_name: undefined,
    primary_filing: { id, title, link: `https://example.test/${id}`, source: 'Exchange filing', region: 'US', pub_date: '2026-09-28T10:00:00Z', age_hours: 20, category: 'OTHER', tickers: [], description: `${title} description.` },
    filings: [{ title } as any], tier: 'TIER_2', region: 'US', tickers: [], is_fund: false, primary_source: true, age_hours: 20,
    why_tradable: { what_happened: title, what_matters: 'Synthetic.', what_to_watch: 'Synthetic next filing.', what_breaks_thesis: 'Synthetic break.' },
    ...over,
  } as RadarFeedEvent;
}

const EVENTS: RadarFeedEvent[] = [
  ev('e1', 'Zetacorp signs multi-year supply agreement for AI data-centre power systems', { tickers: ['ZETA'], target_name: 'Zetacorp', event_type: 'LARGE_ORDER' }),
  ev('e2', 'Omegatech commissions new capacity, utilisation ramp underway', { tickers: ['OMGA'], target_name: 'Omegatech', event_type: 'CAPACITY_EXPANSION' }),
  ev('e3', 'Kappa Industries announces buyback of shares', { tickers: ['KAPA'], target_name: 'Kappa Industries', event_type: 'BUYBACK_TENDER', region: 'IN' }),
  ev('e4', 'Sigma Fund: declares monthly distribution', { tickers: [], event_type: 'OTHER', is_fund: true }),
  ev('e5', 'Lambda Ltd: board meeting scheduled', { tickers: ['LAMB'], event_type: 'OTHER', region: 'IN' }),
];

describe('zzz841 adapter', () => {
  test('maps a feed event to the radar input contract', () => {
    const inp: any = eventToRadarInput(EVENTS[0]);
    assert.equal(inp.id, 'e1');
    assert.equal(inp.ticker, 'ZETA');
    assert.equal(inp.company, 'Zetacorp');
    assert.equal(inp.title, EVENTS[0].primary_filing.title);
    assert.equal(inp.eventType, 'LARGE_ORDER');
    assert.equal(inp.primarySource, true);
    assert.equal(inp.independentSources, 1);
    assert.equal(inp.url, 'https://example.test/e1');
    assert.equal(inp.ageHours, 20);
    assert.equal(inp.feedTier, 'TIER_2');
    assert.equal(inp.feedFacts.what_watch, undefined);
    assert.equal(inp.feedFacts.what_to_watch, 'Synthetic next filing.');
    assert.equal(inp.sourceLabel, 'Exchange filing');
  });
  test('no ticker -> null; company falls back to ticker, then the headline', () => {
    const a: any = eventToRadarInput(EVENTS[3]);
    assert.equal(a.ticker, null);
    assert.equal(a.company, 'Sigma Fund');
    const b: any = eventToRadarInput(ev('x', 'Nu Corp receives approval', { tickers: ['NUCO'] }));
    assert.equal(b.company, 'NUCO');
    assert.equal(companyFromTitle('Rho Systems - wins order'), 'Rho Systems');
    assert.ok(companyFromTitle('x'.repeat(200)).length <= 60);
  });
  test('independentSources counts filings and never drops below 1; duplicates and blank headlines are skipped', () => {
    const e = ev('m', 'Mu Ltd wins order', { tickers: ['MUL'], filings: [{ title: 'a' }, { title: 'b' }, { title: 'c' }] as any });
    assert.equal((eventToRadarInput(e) as any).independentSources, 3);
    assert.equal((eventToRadarInput(ev('n', 'Nu wins order', { filings: [] })) as any).independentSources, 1);
    const out = eventsToRadarInputs([e, e, ev('blank', '   ')]);
    assert.equal(out.length, 1);
    assert.deepEqual(eventsToRadarInputs(null), []);
  });
  test('the feed catalyst score and any price field are not carried into the input', () => {
    const inp = JSON.stringify(eventToRadarInput({ ...EVENTS[0], catalyst_score: { raw_score: 99 }, price: 123, move_pct: 14 } as any));
    assert.ok(!/raw_score|move_pct|"price"/.test(inp));
  });
});

describe('zzz841 ledger store', () => {
  const radar = buildRadar(eventsToRadarInputs(EVENTS), { holdings: [] });
  const item: RadarItem = radar.items.find((i) => i.ticker === 'ZETA') || radar.items[0];
  const NOW = '2026-09-30T08:00:00Z';

  test('addFromRadarItem pre-fills every field; unknowns say Not established', () => {
    const e = addFromRadarItem(item, NOW);
    for (const f of TEXT_FIELDS) { assert.equal(typeof e[f], 'string'); assert.ok(e[f].length > 0, f); }
    assert.equal(e.dateIdentified, '2026-09-30');
    assert.equal(e.status, 'EARLY');
    assert.equal(e.lastReview, null);
    assert.deepEqual(e.history, []);
    assert.equal(e.fromRadarId, item.id);
    assert.equal(e.managementCommentary, NOT_ESTABLISHED);
    assert.ok(e.evidence.length > 0);
  });
  test('CRUD round-trips through the storage shim', () => {
    const s = mem();
    const e = addFromRadarItem(item, NOW);
    saveEntry(e, s);
    assert.equal(loadLedger(s).length, 1);
    saveEntry({ ...e, thesis: 'edited thesis' }, s);
    assert.equal(loadLedger(s).length, 1);
    assert.equal(loadLedger(s)[0].thesis, 'edited thesis');
    removeEntry(e.id, s);
    assert.equal(loadLedger(s).length, 0);
  });
  test('status change appends history and needs a written reason', () => {
    const s = mem();
    const e = addFromRadarItem(item, NOW);
    saveEntry(e, s);
    const bad = updateStatus(e.id, 'BROKEN', '  ', NOW, s);
    assert.ok(bad.error);
    assert.equal(loadLedger(s)[0].status, 'EARLY');
    const ok = updateStatus(e.id, 'STRENGTHENING', 'Second filing confirms shipments began', '2026-10-05T00:00:00Z', s);
    assert.equal(ok.error, undefined);
    const got = loadLedger(s)[0];
    assert.equal(got.status, 'STRENGTHENING');
    assert.equal(got.lastReview, '2026-10-05');
    assert.deepEqual(got.history, [{ date: '2026-10-05', from: 'EARLY', to: 'STRENGTHENING', reason: 'Second filing confirms shipments began' }]);
    assert.equal(updateStatus('nope', 'INTACT', 'a valid reason', NOW, s).error, 'Entry not found.');
  });
  test('the status API has no price / move parameter', () => {
    assert.equal(applyStatus.length, 4);
    const r = applyStatus(addFromRadarItem(item, NOW), 'WEAKENING', 'Customer delayed qualification', NOW);
    assert.ok(r.ok);
  });
  test('corrupt or hostile storage never throws', () => {
    for (const raw of ['{not json', 'null', '{"a":1}', '[1,"x",null,{"id":"","ticker":"A"}]', '""']) {
      assert.deepEqual(parseLedger(raw), []);
      assert.deepEqual(loadLedger(mem({ [LEDGER_KEY]: raw })), []);
    }
    const throwing: StorageLike = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
    assert.deepEqual(loadLedger(throwing), []);
    assert.equal(saveLedger([], throwing), false);
    assert.deepEqual(loadTags(throwing), {});
    assert.deepEqual(loadLedger(null), []);
    assert.equal(saveLedger([], null), false);
  });
  test('validation on read repairs bad fields and drops bad history', () => {
    const good = addFromRadarItem(item, NOW);
    const raw = JSON.stringify([{ ...good, status: 'MOON', thesis: '', history: [{ from: 'EARLY', to: 'BROKEN', reason: '' }, { date: 'd', from: 'EARLY', to: 'INTACT', reason: 'ok reason' }] }, { ...good }]);
    const out = parseLedger(raw);
    assert.equal(out.length, 1);
    assert.equal(out[0].status, 'EARLY');
    assert.equal(out[0].thesis, NOT_ESTABLISHED);
    assert.equal(out[0].history.length, 1);
  });
  test('size cap keeps the newest entries', () => {
    const list = Array.from({ length: LEDGER_CAP + 25 }, (_, i) => ({ ...addFromRadarItem(item, `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`), id: `T${i}::X`, ticker: `T${i}` }));
    const s = mem();
    saveLedger(list, s);
    assert.equal(loadLedger(s).length, LEDGER_CAP);
  });
  test('owner tags persist, clear, and reject junk', () => {
    const s = mem();
    setTag('abc', 'CORE', s);
    assert.deepEqual(loadTags(s), { ABC: 'CORE' });
    setTag('abc', null, s);
    assert.deepEqual(loadTags(s), {});
    assert.deepEqual(loadTags(mem({ [TAGS_KEY]: '{"X":"THESIS_AT_RISK","Y":"WATCH"}' })), { Y: 'WATCH' });
  });
  test('derived tags come from ledger status and evidence only', () => {
    const ev1 = (status: any) => ({ evidence: { status } } as any);
    assert.equal(derivedTag([{ status: 'BROKEN' }], []), 'THESIS_AT_RISK');
    assert.equal(derivedTag([], [ev1('DISPROVED')]), 'THESIS_AT_RISK');
    assert.equal(derivedTag([{ status: 'STRENGTHENING' }], []), 'CATALYST_CONFIRMED');
    assert.equal(derivedTag([], [ev1('CONFIRMED')]), 'CATALYST_CONFIRMED');
    assert.equal(derivedTag([], [ev1('HYPOTHESIS')]), 'CATALYST_DEVELOPING');
    assert.equal(derivedTag([], []), null);
  });
  test('shared drivers are limited to holdings and need two names', () => {
    const g = [{ driver: 'AI infrastructure', tickers: ['AAA', 'BBB.NS', 'CCC'], note: '' }, { driver: 'Defence', tickers: ['AAA', 'DDD'], note: '' }, { driver: 'Grid', tickers: ['AAA', 'CCC'], note: '' }];
    const out = sharedDriversForHoldings(g, ['aaa', 'BBB', 'DDD']);
    assert.equal(out.length, 2);
    assert.deepEqual(out.find((x) => x.driver === 'AI infrastructure')!.tickers, ['AAA', 'BBB.NS']);
  });
});

describe('zzz841 rendered tab', () => {
  const render = (events: RadarFeedEvent[], props: Record<string, unknown> = {}) =>
    renderToStaticMarkup(React.createElement(MultibaggerRadar as any, { events, holdings: [], region: 'ALL', ...props }));

  test('every bucket is its own section, in order, with a plain meaning and a count', () => {
    const h = render(EVENTS);
    const pos = BUCKET_ORDER.map((b) => { const i = h.indexOf(`data-radar-bucket="${b}"`); assert.ok(i >= 0, b); return i; });
    assert.deepEqual([...pos].sort((a, b) => a - b), pos);
    const t = strip(h);
    for (const b of BUCKET_ORDER) assert.ok(t.toUpperCase().includes(BUCKET_LABEL[b].toUpperCase()), b);
    assert.match(t, /Ranked by research value - price never used/);
    assert.match(t, /Not investment advice/);
    assert.match(t, /Built from filings and headlines in the feed/);
    assert.match(t, /Thesis ledger/);
    assert.match(t, /catalyst monitor/);
  });
  test('cards show the spec fields', () => {
    const t = strip(render(EVENTS));
    for (const f of ['Catalyst type', 'Why now', 'Evidence', 'Earnings link', 'Duration', 'Next proof', 'Portfolio status', 'Research priority', 'Mechanism', 'Break conditions', 'Governance', 'WHEN, not WHY', 'Add to thesis ledger']) {
      assert.ok(t.toLowerCase().includes(f.toLowerCase()), f);
    }
    assert.ok(!/governance\s+clear/i.test(t) || /not checked/i.test(t));
  });
  test('evidence chips: a hypothesis never renders like a confirmed', () => {
    const h = render(EVENTS);
    assert.notEqual(EVIDENCE_LABEL.HYPOTHESIS, EVIDENCE_LABEL.CONFIRMED);
    const labels = ['Confirmed', 'Strong', 'Developing', 'Hypothesis', 'Disproved'];
    assert.equal(new Set(labels.map((l) => EVIDENCE_LABEL[l.toUpperCase() as keyof typeof EVIDENCE_LABEL])).size, 5);
    assert.ok(/(Confirmed|Strong|Developing|Hypothesis)/.test(strip(h)));
  });
  test('clean text: no undefined / NaN / null, no trade words, no 0-100 score', () => {
    const t = strip(render(EVENTS));
    assert.ok(!/undefined|NaN|\bnull\b/.test(t), 'bad literal');
    assert.ok(!/\b(BUY|SELL)\b/.test(t));
    assert.ok(!/target price|fair value|price target/i.test(t));
    assert.ok(!/\b\d{1,3}\s*\/\s*100\b|\bscore\b/i.test(t));
  });
  test('empty, loading and error states', () => {
    const e = strip(render([]));
    assert.match(e, /All Situations/);
    assert.ok(render([]).includes('href="/special-situations?tab=all"'));
    assert.match(strip(render([], { isLoading: true })), /Loading the feed/);
    assert.match(strip(render([], { error: new Error('x') })), /could not be loaded/);
  });
  test('region prop filters events', () => {
    const t = strip(render(EVENTS, { region: 'IN' }));
    assert.ok(!t.includes('Zetacorp'));
    assert.ok(t.includes('Kappa Industries'));
  });
  test('price is never an input: price / move / score fields on the events change nothing', () => {
    const base = render(EVENTS);
    const noisy = EVENTS.map((e, i) => ({ ...e, price: 100 + i, move_pct: i % 2 ? 25 : -25, volume_spike: 9, analyst_target: 999, catalyst_score: { raw_score: 90 - i * 20, decay_score: 90 - i * 20, components: [] } })) as any;
    assert.equal(render(noisy), base);
    const a = buildRadar(eventsToRadarInputs(EVENTS), { holdings: [] }).items.map((i) => i.id);
    const b = buildRadar(eventsToRadarInputs([...noisy].reverse()), { holdings: [] }).items.map((i) => i.id);
    assert.deepEqual(new Set(a), new Set(b));
  });
});
