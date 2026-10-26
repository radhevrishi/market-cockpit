// zzz1179 — theme live pulse: matching, squeeze words, momentum, company proof, crowding; news archive; wiring.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { themePulse, matchTheme, themeTerms, SQUEEZE_RE, type PulseNews } from '../choke-themes/pulse';
import { toArchived } from '../news/archive';
import { MIGRATIONS, migrationsValid } from '../db-migrate';
import { APP_JOBS } from '../app-scheduler';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const theme: any = { name: 'Memory supercycle: HBM, DRAM and NAND', emoji: '🧠', why: 'AI needs memory. Choke points are HBM and NAND supply.', keywords: ['hbm', 'dram', 'nand', 'memory prices'], leaders: [{ name: 'Micron', ticker: 'MU', note: null }], smallMid: [{ name: 'SanDisk', ticker: 'SNDK', note: null }], bear: '', bull: '', evidence: null };
const art = (title: string, daysAgo: number, tickers: string[] = [], over: any = {}): PulseNews => ({ id: title, publishedAt: new Date(NOW - daysAgo * 86_400_000).toISOString(), title, summary: null, source: 'x', url: null, region: 'US', tickers, importance: 0.5, bottleneck: null, sentiment: null, ...over });

test('an article belongs to a theme by its company or two theme terms', () => {
  const terms = themeTerms(theme), tk = new Set(['MU', 'SNDK']);
  assert.ok(matchTheme(art('Micron results', 1, ['MU']), terms, tk).hit);
  assert.ok(matchTheme(art('DRAM and NAND contract prices jump', 1), terms, tk).hit);
  assert.ok(matchTheme(art('Memory prices to rise again', 1), terms, tk).hit, 'a multi-word term alone');
  assert.ok(!matchTheme(art('DRAM mentioned once in a phone review', 1), terms, tk).hit);
});

test('squeeze words, rising news and accelerating companies make a strong, rising theme; a big run counts against it', () => {
  assert.ok(SQUEEZE_RE.test('HBM sold out through 2027') && SQUEEZE_RE.test('NAND lead times stretch') && !SQUEEZE_RE.test('Micron hosts investor day'));
  const news = [art('HBM sold out through 2027', 1, ['MU']), art('DRAM and NAND prices hike as shortage deepens', 2), art('NAND lead times stretch, allocation begins', 3, ['SNDK']), art('Micron record backlog', 4, ['MU']), art('Old DRAM item', 20)];
  const cos = new Map([['MU', { t: 'MU', revQ: 60, revA: 20, opm: 30, p1y: 40 }], ['SNDK', { t: 'SNDK', revQ: 80, revA: 10, opm: 25, p1y: 60 }]]);
  const p = themePulse(theme, 'US', news, cos, [{ ticker: 'SNDK', date: '2026-10-20', headline: 'Capacity sold out', kind: 'CAPACITY', strength: 'TRANSFORMATIONAL' }], NOW);
  assert.equal(p.trend, 'RISING'); assert.equal(p.news7, 4); assert.equal(p.squeeze30, 4);
  assert.ok(p.bottleneck >= 80 && p.proof >= 60, JSON.stringify(p));
  assert.equal(p.label, 'STRONG'); assert.deepEqual(p.accelerating.sort(), ['MU', 'SNDK']);
  const crowded = themePulse(theme, 'US', news, new Map([['MU', { t: 'MU', revQ: 60, revA: 20, opm: 30, p1y: 300 }]]), [], NOW);
  assert.ok(crowded.crowding >= 90 && crowded.strength < p.strength);
});

test('news archive: rows from the feed, table + hourly job', () => {
  const r = toArchived({ id: 'a1', title: 'Micron plans High-NA EUV for DRAM', published_at: '2026-10-26T14:00:00Z', ticker_symbols: ['MU'], importance_score: 0.37, source_name: "Tom's Hardware" })!;
  assert.deepEqual(r.tickers, ['MU']); assert.equal(r.importance, 0.37);
  assert.ok(migrationsValid() && MIGRATIONS.find((m) => m.name === 'news_archive'));
  assert.ok(APP_JOBS.find((j) => j.name === 'news-archive'));
  const panel = readFileSync(new URL('../../components/news/ChokeThemesPanel.tsx', import.meta.url), 'utf8');
  assert.match(panel, /\/api\/v1\/choke-themes\/pulse/); assert.match(panel, /📊 Live strength/);
});

test('zzz1180: J-curve data check — a theme whose companies already ran 3x+ in 5 years is flagged and moved last; prompt judges from scratch', async () => {
  const { cleanChoke, jcurveCheck, CHOKE_SYSTEM } = await import('../choke-themes/core');
  const th = (name: string, tk: string) => ({ name, emoji: '', jcurve: 'INFLECTING', stage: 'EARLY', not_priced_in: '', signals: '', keywords: [], why: 'x', leaders: [{ name: tk, ticker: tk, note: null }], small_mid: [], bear: '', bull: '', evidence: null });
  const reg = (r: string, a: string, b: string) => ({ region: r, themes: [th('Rail EPC', a), th('Memory', b), th('T3', 'Z3'), th('T4', 'Z4')], playbook: { dominant: [], accumulation: '', small_mid: '' } });
  const c = cleanChoke({ regions: [reg('US', 'A', 'B'), reg('IN', 'RVNL', 'NEWCO')], changes: [] })!;
  jcurveCheck(c, { US: new Map(), IN: new Map([['RVNL', 900], ['NEWCO', 40]]) }, { US: new Map(), IN: new Map([['RVNL', 10]]) });
  const india = c.regions[1].themes;
  assert.equal(india[india.length - 1].name, 'Rail EPC'); assert.equal(india[india.length - 1].alreadyRan, true); assert.equal(india[india.length - 1].ran5y, 900);
  assert.equal(india.find((t) => t.name === 'Memory')!.alreadyRan, false);
  assert.match(CHOKE_SYSTEM, /J-CURVE TEST/); assert.match(CHOKE_SYSTEM, /FROM SCRATCH/);
  const run = readFileSync(new URL('../choke-themes/run.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(run, /keep what still holds/); assert.match(run, /ALREADY multiplied/);
});

test('zzz1181: runs start in the background (no 502 on a long request); a theme that ran and is unwinding is flagged', async () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
  for (const f of ['../../app/api/v1/choke-themes/route.ts', '../../app/api/v1/hundred-baggers/route.ts']) assert.match(src(f), /startJob\(KEY/);
  assert.match(src('../../components/news/ChokeThemesPanel.tsx'), /startAndPoll/);
  const { cleanChoke, jcurveCheck } = await import('../choke-themes/core');
  const th = (name: string, tk: string) => ({ name, emoji: '', jcurve: 'INFLECTING', stage: 'EARLY', not_priced_in: '', signals: '', keywords: [], why: 'x', leaders: [{ name: tk, ticker: tk, note: null }], small_mid: [], bear: '', bull: '', evidence: null });
  const reg = (r: string) => ({ region: r, themes: [th('Rail', 'IRCON'), th('B', 'B'), th('C', 'C'), th('D', 'D')], playbook: { dominant: [], accumulation: '', small_mid: '' } });
  const c = cleanChoke({ regions: [reg('US'), reg('IN')], changes: [] })!;
  jcurveCheck(c, { US: new Map(), IN: new Map([['IRCON', 97]]) }, { US: new Map(), IN: new Map([['IRCON', -42]]) });
  const rail = c.regions[1].themes.find((t) => t.name === 'Rail')!;
  assert.equal(rail.unwinding, true); assert.equal(rail.alreadyRan, true);
});
