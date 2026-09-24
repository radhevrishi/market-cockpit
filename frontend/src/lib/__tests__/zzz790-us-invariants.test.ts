// zzz790 — static invariants: no price enters the US thesis engine; both US
// pages are in the nav and on the home favourites; the new API prefixes are
// protected like India's; page files carry no named exports; the India
// engine files are imported, never forked.
// Run: npx tsx --test src/lib/__tests__/zzz790-us-invariants.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { isProtectedApi, PROTECTED_API_PREFIXES } from '../site-auth';

const SRC = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');
const engineFiles = [
  ...readdirSync(join(SRC, 'lib', 'us-thesis')).map((f) => `lib/us-thesis/${f}`),
  'app/(dashboard)/us-portfolio-catalysts/page.tsx',
  'components/us-special-focus-panel.tsx',
  'app/api/v1/us-thesis/read/route.ts', 'app/api/v1/us-thesis/facts/route.ts',
  'app/api/v1/us-thesis/evidence/route.ts', 'app/api/v1/us-thesis/special-focus/route.ts', 'app/api/v1/us-thesis/check-all/route.ts',
];
const importsOf = (s: string) => Array.from(s.matchAll(/from\s+'([^']+)'/g)).map((m) => m[1]);

describe('no price in the US thesis engine', () => {
  test('no engine file imports a price / quote / valuation module', () => {
    const PRICE_MOD = /us-prices|\/yahoo|us-book\/valuation|us-book\/quotes|quotes\/route|market\/quotes/;
    for (const f of engineFiles) {
      const bad = importsOf(read(f)).filter((m) => PRICE_MOD.test(m));
      assert.deepEqual(bad, [], `${f} imports ${bad.join(', ')}`);
    }
  });
  test('no engine file calls a quote endpoint or reads a quote field', () => {
    const PRICE_USE = /\/api\/v1\/us-book\/quotes|\/api\/market\/quotes|regularMarketPrice|yahooChart|fetchQuotes|\bavgPrice\b|\bmarketValue\b|\bd1_pct\b/;
    for (const f of engineFiles) {
      if (f.endsWith('adapter.ts')) continue;  // lists the forbidden keys by name (PRICE_KEYS)
      assert.ok(!PRICE_USE.test(read(f)), `${f} references a price`);
    }
  });
  test('the catalysts hook reads the book through its price-free projection only', () => {
    const hook = read('lib/us-thesis/use-us-book.ts');
    assert.match(hook, /\/api\/v1\/us-book\?view=universe/);
    assert.ok(!/fetch\('\/api\/v1\/us-book'[,)]/.test(hook), 'never the full book (it carries cost)');
  });
  test('the engine reuses the shared India engine, it does not fork it', () => {
    const assess = read('lib/us-thesis/assess.ts');
    for (const m of ['@/lib/thesis/status', '@/lib/thesis/variables', '@/lib/thesis/capex-chain', '@/lib/thesis/comparison', '@/lib/earnings/pattern-abfg']) {
      assert.ok(importsOf(assess).includes(m), `assess.ts should import ${m}`);
    }
    const page = read('app/(dashboard)/us-portfolio-catalysts/page.tsx');
    assert.ok(importsOf(page).includes('@/components/thesis-card'));
    const store = read('lib/us-thesis/evidence-store.ts');
    assert.ok(importsOf(store).includes('@/lib/thesis/evidence-ledger'));
    assert.ok(!importsOf(store).includes('@/lib/thesis/evidence-store'), 'the India KV store is not used for US ledgers');
  });
});

describe('navigation and favourites', () => {
  test('both US pages in the sidebar, next to the India ones, labelled India / US', () => {
    const nav = read('app/(dashboard)/DashboardClient.tsx');
    const i = (h: string) => nav.indexOf(`href: '${h}'`);
    for (const h of ['/portfolio', '/us-portfolio-book', '/portfolio-catalysts', '/us-portfolio-catalysts']) assert.ok(i(h) > 0, h);
    assert.match(nav, /label: 'US Portfolio Book'/);
    assert.match(nav, /label: 'US Portfolio Catalysts'/);
    assert.match(nav, /label: 'Portfolio \(India\)'/);
    assert.match(nav, /label: 'Portfolio Catalysts \(India\)'/);
    assert.ok(i('/us-portfolio-book') > i('/portfolio') && i('/us-portfolio-book') < i('/portfolio-catalysts'));
    assert.ok(i('/us-portfolio-catalysts') > i('/portfolio-catalysts') && i('/us-portfolio-catalysts') < i('/exit-radar'));
  });
  test('both on the home favourites, beside their India siblings', () => {
    const home = read('app/(dashboard)/page.tsx');
    const favs = home.slice(home.indexOf('const FAVS'), home.indexOf('const FAV_ORDER_KEY'));
    assert.match(favs, /href: '\/us-portfolio-catalysts'/);
    assert.match(favs, /href: '\/us-portfolio-book'/);
    assert.ok(favs.indexOf("'/us-portfolio-catalysts'") > favs.indexOf("'/portfolio-catalysts'"));
    assert.ok(favs.indexOf("'/us-portfolio-book'") > favs.indexOf("'/portfolio'"));
  });
  test('offered once to the starred sidebar rail', () => {
    const fav = read('lib/nav-favourites.ts');
    assert.match(fav, /'\/us-portfolio-book', '\/us-portfolio-catalysts'\]/);
  });
});

describe('security', () => {
  test('the US APIs carry personal data / paid AI and are protected', () => {
    assert.ok((PROTECTED_API_PREFIXES as readonly string[]).includes('/api/v1/us-book'));
    assert.ok((PROTECTED_API_PREFIXES as readonly string[]).includes('/api/v1/us-thesis'));
    for (const p of ['/api/v1/us-book', '/api/v1/us-book/quotes', '/api/v1/us-thesis/read', '/api/v1/us-thesis/evidence', '/api/v1/us-thesis/special-focus', '/api/v1/us-thesis/facts', '/api/v1/us-thesis/check-all']) {
      assert.equal(isProtectedApi(p), true, p);
    }
    assert.equal(isProtectedApi('/api/v1/us-bookmarks'), false, 'prefix match is path-aligned');
    assert.equal(isProtectedApi('/api/v1/book/state'), true, 'India stays protected');
  });
  test('no secret is logged or returned by the US routes', () => {
    for (const f of ['app/api/v1/us-thesis/read/route.ts', 'app/api/v1/us-book/route.ts', 'app/api/v1/us-book/quotes/route.ts']) {
      const s = read(f);
      assert.ok(!/process\.env\.(ANTHROPIC|OPENAI|KV_|UPSTASH|MC_|CRON)/.test(s), `${f} touches a secret env var`);
    }
  });
});

describe('page files export only a default', () => {
  for (const p of ['app/(dashboard)/us-portfolio-book/page.tsx', 'app/(dashboard)/us-portfolio-catalysts/page.tsx']) {
    test(p, () => {
      const s = read(p);
      assert.match(s, /export default function/);
      const named = s.split('\n').filter((l) => /^export\s+(?!default)/.test(l));
      assert.deepEqual(named, []);
    });
  }
});
