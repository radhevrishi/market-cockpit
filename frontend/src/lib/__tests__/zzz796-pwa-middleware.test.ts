// zzz796 — the phone must be able to fetch the app files before logging in,
// while every page and private API stays behind the owner login.
// Run: npx tsx --test src/lib/__tests__/zzz796-pwa-middleware.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PUBLIC_PAGE_PATHS } from '../site-auth';

const SRC = readFileSync(join(__dirname, '..', '..', 'middleware.ts'), 'utf8');

// Pull the matcher string literal out of the source and unescape it the way
// the TypeScript compiler would ('\\.' in source → '\.' at runtime).
function matcher(): RegExp {
  const m = SRC.match(/matcher:\s*\[\s*'([^']+)'/);
  assert.ok(m, 'matcher found');
  const pattern = m![1].replace(/\\\\/g, '\\');
  return new RegExp(`^${pattern}$`);
}

describe('middleware matcher', () => {
  const re = matcher();
  const gated = (p: string) => re.test(p); // true → middleware runs → login required

  test('app files skip the login gate', () => {
    for (const p of ['/manifest.json', '/sw.js', '/offline.html', '/icon-192.png', '/icon-512.png',
      '/icon-maskable-192.png', '/icon-maskable-512.png', '/apple-touch-icon.png', '/icons/shortcut-home.png',
      '/_next/static/chunks/main.js', '/favicon.ico']) {
      assert.equal(gated(p), false, p);
    }
  });

  test('pages and APIs still go through the gate', () => {
    for (const p of ['/', '/portfolio', '/us-portfolio-book', '/settings', '/api/v1/book/state', '/api/portfolio',
      '/buy-strategy-planner.html', '/catalyst-scorecard.html', '/offline.html/x', '/sw.jsx', '/offline']) {
      assert.equal(gated(p), true, p);
    }
  });

  test('login stays the only public page', () => {
    assert.deepEqual(PUBLIC_PAGE_PATHS, ['/login']);
  });
});
