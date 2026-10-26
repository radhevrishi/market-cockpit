// zzz1166 — Transformational Gainers: which gainer events are kept, their theme, the multibagger-chance read, the 60-day board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformationalFrom, themeOf, multibaggerOf, buildBoard, inflectionOf, OTHER_THEME, type TgItem } from '../transformational/core';
import { MIGRATIONS, migrationsValid } from '../db-migrate';
import { APP_JOBS, sessionDatesBack } from '../app-scheduler';
import { MB_TOOL } from '../transformational/ai';
import { isStrictSchema, toStrictSchema } from '../ai-schemas';

const inItem = (over: any = {}) => ({
  ticker: 'GRWRHITECH', company: 'Garware Hi-Tech Films', market: 'IN', eventClass: 'CONFIRMED_MATERIAL', direction: 'positive',
  headline: 'Q2 FY27 result — operating margin 21% → 24%', whatChanged: null, marketCap: 9000, returns: { w1: -1, m1: 10, m3: 3 }, move1d: 5.6,
  move: { pct: 5.6, window: '1D' }, flags: { dilution: false }, persistence: 'QUARTER',
  earnings: { revenueYoY: 22, patYoY: 42, marginNow: 24, marginPrior: 21, cfoToPat: 0.81, guidance: 'RAISED', stale: false },
  inCard: { catalysts: [
    { id: 'capacity_commissioned', label: 'Capacity commissioned / production started', direction: 'positive', source: 'FILING', date: '2026-10-22', sentence: 'TPU line commissioning remains on track for Q3 FY27', url: 'https://x/1', ageDays: 3 },
    { id: 'record_results', label: 'Record revenue / profit', direction: 'positive', source: 'FILING', date: '2026-10-22', sentence: 'Record Q2', url: null, ageDays: 3 },
  ] },
  ...over,
});

test('an India result with capacity commissioning and margin +3 points is kept (official, inflection)', () => {
  const [x] = transformationalFrom([inItem()], 'IN', '2026-10-23');
  assert.ok(x);
  assert.equal(x.kind, 'CAPACITY'); assert.equal(x.evidence, 'official');
  assert.ok(['TRANSFORMATIONAL', 'INFLECTION'].includes(x.strength));
  assert.equal(x.id, 'IN:GRWRHITECH:2026-10-22:CAPACITY');
  assert.ok(x.signals.some((s) => /inflection/i.test(s)));
});

test('never kept: negative, price commentary, no catalyst, a plain good quarter, routine paperwork', () => {
  assert.equal(transformationalFrom([inItem({ direction: 'negative' })], 'IN', '2026-10-23').length, 0);
  assert.equal(transformationalFrom([inItem({ priceCommentaryOnly: true })], 'IN', '2026-10-23').length, 0);
  assert.equal(transformationalFrom([inItem({ eventClass: 'NO_CATALYST' })], 'IN', '2026-10-23').length, 0);
  const plain = inItem({ earnings: { revenueYoY: 12, patYoY: 18, marginNow: 14, marginPrior: 13.5, cfoToPat: 1, guidance: 'NOT_STATED', stale: false },
    inCard: { catalysts: [{ id: 'record_results', label: 'Record', direction: 'positive', source: 'FILING', date: '2026-10-22', sentence: 'x', ageDays: 2 }, { id: 'margin_expansion', label: 'Margin', direction: 'positive', source: 'FILING', date: '2026-10-22', sentence: 'x', ageDays: 2 }] } });
  assert.equal(transformationalFrom([plain], 'IN', '2026-10-23').length, 0, 'record + margin lines of one modest quarter are not transformational');
  const routine = inItem({ earnings: null, inCard: { catalysts: [{ id: 'order_win', label: 'Order', direction: 'positive', source: 'FILING', routine: true, sentence: 'x' }] } });
  assert.equal(transformationalFrom([routine], 'IN', '2026-10-23').length, 0);
});

test('a US order from an SEC filing is kept; a press-only one is kept as press (verify)', () => {
  const us = { ticker: 'TTMI', company: 'TTM Technologies', market: 'US', eventClass: 'CONFIRMED_MATERIAL', direction: 'positive', headline: 'Q3 results',
    marketCap: 6_500_000_000, returns: { w1: -14, m1: -36, m3: -43 }, flags: {}, persistence: 'QUARTER', usCard: {
      source: { tier: 'SEC' }, material: { label: 'HIGH' },
      earnings: { revenueGrowthPct: 59.9, profitGrowthPct: 59.8, margin: { cur: 13.5, prev: 9.6 }, guidance: 'NEW' },
      catalysts: [{ id: 'backlog', label: 'Backlog / bookings growth', direction: 'positive', source: 'SEC', date: '2026-10-22', sentence: 'A&D program backlog was $2.0 billion; data center demand driven by AI', url: 'https://sec/1' }] } };
  const [x] = transformationalFrom([us], 'US', '2026-10-23');
  assert.equal(x.kind, 'ORDERS'); assert.equal(x.strength, 'TRANSFORMATIONAL'); assert.equal(x.marketCap, 6500);
  assert.equal(x.theme, 'AI / data-centre infrastructure');
  const press = { ...us, usCard: { ...us.usCard, source: { tier: 'PRESS' }, earnings: null, catalysts: [{ ...us.usCard.catalysts[0], source: 'PRESS' }] } };
  const [p] = transformationalFrom([press], 'US', '2026-10-23');
  assert.equal(p.evidence, 'press'); assert.equal(p.strength, 'NOTABLE');
});

test('themes from the company\'s own words; nothing matched = Other', () => {
  assert.equal(themeOf(['Order for power transformers from PGCIL']).theme, 'Power grid / transformers / T&D');
  assert.equal(themeOf(['HRSG piping order for a combined cycle plant']).theme, 'Power generation & gas turbines');
  assert.equal(themeOf(['International Gemological Institute grading']).theme, OTHER_THEME);
});

test('multibagger chance: small + transformational + growth + structural theme is HIGH; large, press-only, ran a lot, dilution are marked down', () => {
  const good = multibaggerOf({ market: 'IN', marketCap: 1500, strength: 'TRANSFORMATIONAL', facts: { revenueYoY: 45, patYoY: 80, marginNow: 20, marginPrior: 15, cfoToPat: 1.1, guidance: 'RAISED' }, durationYears: true, theme: 'Defence & aerospace', evidence: 'official', dilution: false, returns: { w1: 5, m1: 10, m3: 20 }, kind: 'ORDERS' });
  assert.equal(good.label, 'HIGH'); assert.ok(good.plus.length >= 5);
  const bad = multibaggerOf({ market: 'IN', marketCap: 200_000, strength: 'NOTABLE', facts: { revenueYoY: 5, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: 0.3, guidance: null }, durationYears: false, theme: OTHER_THEME, evidence: 'press', dilution: true, returns: { w1: 1, m1: 1, m3: 140 }, kind: 'STRATEGIC' });
  assert.equal(bad.label, 'UNLIKELY'); assert.ok(bad.minus.some((m) => /dilution/.test(m)) && bad.minus.some((m) => /already up/.test(m)));
});

test('earnings inflection thresholds', () => {
  assert.equal(inflectionOf({ revenueYoY: 55, patYoY: null, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null }), 'revenue +55%');
  assert.ok(inflectionOf({ revenueYoY: 26, patYoY: 41, marginNow: null, marginPrior: null, cfoToPat: null, guidance: null }));
  assert.equal(inflectionOf({ revenueYoY: 20, patYoY: 30, marginNow: 12, marginPrior: 11, cfoToPat: null, guidance: null }), null);
});

test('the board: 60 days, newest first, themes counted, new themes and new companies of this week', () => {
  const mk = (t: string, d: string, theme: string): TgItem => ({ ...transformationalFrom([inItem({ ticker: t })], 'IN', d)[0], sessionDate: d, theme });
  const items = [mk('AAA', '2026-08-01', 'Defence & aerospace'), mk('BBB', '2026-10-01', 'Defence & aerospace'), mk('CCC', '2026-10-24', 'Railways & metro'), mk('OLD', '2026-07-01', 'Textiles')];
  const b = buildBoard(items, '2026-10-26', 60);
  assert.deepEqual(b.items.map((x) => x.ticker), ['CCC', 'BBB']);
  assert.equal(b.themes.find((t) => t.theme === 'Railways & metro')?.isNew, true);
  assert.equal(b.themes.find((t) => t.theme === 'Defence & aerospace')?.isNew, false);
  assert.deepEqual(b.newCompanies, ['IN:CCC']);
});

test('wiring: migration, archive hook, daily job, AI tool strict, nav + favourites, card badge, protected API', () => {
  assert.ok(migrationsValid()); assert.ok(MIGRATIONS.find((m) => m.name === 'transformational_event'));
  const job = APP_JOBS.find((j) => j.name === 'transformational-archive');
  assert.ok(job); assert.equal(sessionDatesBack(new Date('2026-10-26T12:00:00Z')).length, 11);
  assert.ok(isStrictSchema(toStrictSchema(MB_TOOL.input_schema as any) as any));
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(src('../../app/api/v1/ai-gainers/research/route.ts'), /archiveView\(view, market, date/);
  assert.match(src('../../app/(dashboard)/DashboardClient.tsx'), /\/transformational-gainers/);
  assert.match(src('../../app/(dashboard)/page.tsx'), /'\/transformational-gainers', label: '🧬 Transformational Gainers'/);
  assert.match(src('../../components/ai-gainers/ResearchCard.tsx'), /<TgCardBadge it=\{it\} \/>/);
  assert.match(src('../site-auth.ts'), /'\/api\/v1\/transformational'/);
});

test('the archive reads the view\'s real lists (queue / watch / portfolio / context …), once per ticker', async () => {
  const { viewItems } = await import('../transformational/archive');
  const it = (t: string) => ({ ticker: t });
  const v = { top3: [it('A')], queue: [it('A'), it('B')], watch: [it('C')], portfolio: [it('B')], context: [it('D')], noCatalyst: [it('E')] };
  assert.deepEqual(viewItems(v).map((x) => x.ticker), ['A', 'B', 'C', 'D']);
});
