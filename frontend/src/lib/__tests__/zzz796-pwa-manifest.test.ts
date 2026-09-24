// zzz796 — installable app: manifest, icons, shortcuts, login cookie.
// Run: npx tsx --test src/lib/__tests__/zzz796-pwa-manifest.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_COOKIE_MAX_AGE_S } from '../site-auth';

const ROOT = join(__dirname, '..', '..', '..');
const PUB = join(ROOT, 'public');
const APP = join(ROOT, 'src', 'app');

function pngSize(file: string): { w: number; h: number } {
  const b = readFileSync(file);
  assert.equal(b.subarray(1, 4).toString('ascii'), 'PNG', `${file} is a PNG`);
  assert.equal(b.subarray(12, 16).toString('ascii'), 'IHDR');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

const manifest = JSON.parse(readFileSync(join(PUB, 'manifest.json'), 'utf8'));

describe('manifest', () => {
  test('identity and display', () => {
    assert.equal(manifest.name, 'Market Cockpit');
    assert.equal(manifest.short_name, 'Cockpit');
    assert.equal(manifest.start_url, '/?source=pwa');
    assert.equal(manifest.id, '/');
    assert.equal(manifest.scope, '/');
    assert.equal(manifest.display, 'standalone');
    assert.match(manifest.theme_color, /^#[0-9A-Fa-f]{6}$/);
    assert.match(manifest.background_color, /^#[0-9A-Fa-f]{6}$/);
  });

  test('icons exist at their declared pixel sizes, any + maskable at 192 and 512', () => {
    for (const icon of manifest.icons) {
      const f = join(PUB, icon.src);
      assert.ok(existsSync(f), icon.src);
      const [w, h] = icon.sizes.split('x').map(Number);
      assert.deepEqual(pngSize(f), { w, h }, icon.src);
      assert.equal(icon.type, 'image/png');
    }
    for (const purpose of ['any', 'maskable']) {
      for (const size of ['192x192', '512x512']) {
        assert.ok(manifest.icons.some((i: any) => i.purpose === purpose && i.sizes === size), `${purpose} ${size}`);
      }
    }
  });

  test('maskable icons have a solid, full-bleed background (safe padding, no transparent corners)', () => {
    // A transparent corner would show as a black/white blob inside Android's mask.
    for (const src of ['/icon-maskable-192.png', '/icon-maskable-512.png']) {
      const b = readFileSync(join(PUB, src));
      const colourType = b[25];
      assert.ok(colourType === 2, `${src} is RGB with no alpha channel (colour type ${colourType})`);
    }
  });

  test('apple-touch-icon is 180x180 and linked from the layout', () => {
    assert.deepEqual(pngSize(join(PUB, 'apple-touch-icon.png')), { w: 180, h: 180 });
    const layout = readFileSync(join(APP, 'layout.tsx'), 'utf8');
    assert.match(layout, /rel="apple-touch-icon"[^>]*href="\/apple-touch-icon\.png"/);
    assert.match(layout, /rel="manifest" href="\/manifest\.json"/);
    assert.match(layout, /<PwaRegister /);
  });

  test('shortcuts: the main favourite pages, each a real page with a 96px icon', () => {
    const urls: string[] = manifest.shortcuts.map((s: any) => s.url.split('?')[0]);
    for (const want of ['/', '/portfolio', '/us-portfolio-book', '/portfolio-catalysts', '/us-portfolio-catalysts', '/ai-gainers', '/earnings-opportunities']) {
      assert.ok(urls.includes(want), `shortcut ${want}`);
    }
    for (const s of manifest.shortcuts) {
      assert.ok(s.name && s.short_name, 'named');
      const path = s.url.split('?')[0];
      const page = path === '/' ? join(APP, '(dashboard)', 'page.tsx') : join(APP, '(dashboard)', ...path.slice(1).split('/'), 'page.tsx');
      assert.ok(existsSync(page), `${s.url} has a page at ${page}`);
      assert.ok(s.url.startsWith('/'), 'same-origin, inside scope');
      for (const icon of s.icons) assert.deepEqual(pngSize(join(PUB, icon.src)), { w: 96, h: 96 }, icon.src);
    }
  });

  test('every shortcut is also in the sidebar, so it matches what the owner stars', () => {
    const nav = readFileSync(join(APP, '(dashboard)', 'DashboardClient.tsx'), 'utf8');
    for (const s of manifest.shortcuts) {
      const path = s.url.split('?')[0];
      assert.ok(nav.includes(`href: '${path}'`), `${path} in NAV_GROUPS`);
    }
  });

  test('offline page exists and says what to do', () => {
    const html = readFileSync(join(PUB, 'offline.html'), 'utf8');
    assert.match(html, /You&rsquo;re offline &mdash; reconnect to load live data/);
    assert.match(html, /location\.reload\(\)/);
  });
});

describe('login cookie survives in the installed app', () => {
  test('180 days, HttpOnly, SameSite=Lax, Secure in production', () => {
    assert.ok(SITE_COOKIE_MAX_AGE_S >= 180 * 24 * 3600);
    const route = readFileSync(join(APP, 'api', 'auth', 'login', 'route.ts'), 'utf8');
    assert.match(route, /httpOnly: true/);
    assert.match(route, /sameSite: 'lax'/);
    assert.match(route, /secure: process\.env\.NODE_ENV === 'production'/);
    assert.match(route, /maxAge: SITE_COOKIE_MAX_AGE_S/);
  });

  test('Sign out clears the cookie (calls the logout route)', () => {
    const nav = readFileSync(join(APP, '(dashboard)', 'DashboardClient.tsx'), 'utf8');
    assert.match(nav, /fetch\('\/api\/auth\/logout', \{ method: 'POST' \}\)/);
  });
});
