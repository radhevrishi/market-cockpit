// zzz796 — phone layout for the owner's favourite pages (360–430px portrait).
// Layout only: these tests pin the shared CSS contract and the hooks the pages
// use, so a later desktop edit cannot quietly undo the phone fixes.
// Run: npx tsx --test src/lib/__tests__/zzz796-mobile-layout.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const css = read('app/globals.css');
const MARK = 'zzz796 — PHONE LAYOUT';
const section = css.slice(css.lastIndexOf('/*', css.indexOf(MARK)));

/** Top-level blocks of a CSS fragment: [prelude, body]. Comments stripped. */
function blocks(src: string): Array<{ prelude: string; body: string }> {
  const s = src.replace(/\/\*[\s\S]*?\*\//g, '');
  const out: Array<{ prelude: string; body: string }> = [];
  let depth = 0, start = 0, open = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') { if (depth === 0) open = i; depth++; }
    else if (s[i] === '}') {
      depth--;
      if (depth === 0) { out.push({ prelude: s.slice(start, open).trim(), body: s.slice(open + 1, i) }); start = i + 1; }
    }
  }
  assert.equal(depth, 0, 'braces balance');
  return out;
}

describe('globals.css — phone section', () => {
  test('the section exists and its braces balance', () => {
    assert.ok(css.includes(MARK));
    assert.ok(blocks(section).length > 3);
  });

  test('desktop is untouched: everything is inside max-width:767px except the bar variable and the scroll wrapper', () => {
    for (const b of blocks(section)) {
      if (b.prelude.startsWith('@media')) {
        assert.match(b.prelude, /^@media \(max-width: 767px\)$/, `unexpected media query: ${b.prelude}`);
        continue;
      }
      assert.ok([':root', '.mc-table-scroll'].includes(b.prelude), `top-level rule outside the phone query: ${b.prelude}`);
      if (b.prelude === ':root') assert.match(b.body, /--mc-bottom-bar:\s*0px/);
    }
  });

  test('--mc-bottom-bar is 0 on desktop and set on phones; main content clears it and the home indicator', () => {
    assert.match(section, /:root \{ --mc-bottom-bar: 0px; \}/);
    const phone = blocks(section).filter((b) => b.prelude.startsWith('@media')).map((b) => b.body).join('\n');
    assert.match(phone, /:root \{ --mc-bottom-bar: 72px; \}/);
    assert.match(phone, /\.mobile-main-content \{\s*padding-bottom: calc\(var\(--mc-bottom-bar\) \+ env\(safe-area-inset-bottom, 0px\)\);/);
  });

  test('column flex containers never wrap (the 1,100px-wide US book)', () => {
    const wrapAll = css.indexOf('main [style*="display: flex"][style*="gap"],');
    const fix = css.indexOf('main [style*="flex-direction: column"] { flex-wrap: nowrap !important; }');
    assert.ok(wrapAll > 0, 'the P0727 wrap-everything rule is still there (this fix answers it)');
    assert.ok(fix > wrapAll, 'the column fix comes after the P0727 rule so it wins');
  });

  test('tables are tables again (no split thead/tbody), their parent scrolls, cells are readable', () => {
    const phone = blocks(section).filter((b) => b.prelude.startsWith('@media')).map((b) => b.body).join('\n');
    assert.match(phone, /main table thead, main table tbody, main table tfoot \{\s*display: revert;/);
    assert.match(phone, /main :has\(> table\) \{\s*overflow-x: auto;/);
    assert.match(phone, /main table td \{\s*font-size: 14px !important;/);
    assert.match(phone, /main table th \{\s*font-size: 12px !important;/);
  });

  test('base font 14px, captions never below 12px, numbers tabular', () => {
    assert.match(section, /main \{\s*font-size: 14px;/);
    assert.match(section, /--mc-text-xs: 12px;/);
    for (const px of ['9px', '10px', '10.5px', '11px', '11.5px']) {
      assert.ok(section.includes(`main [style*="font-size: ${px}"]`), `tiny inline size ${px} is raised`);
    }
    assert.match(section, /main td, main th, main \[style\*="tabular-nums"\] \{ font-variant-numeric: tabular-nums; \}/);
  });

  test('tap targets are at least 40px', () => {
    assert.match(section, /min-height: 40px !important;/);
  });

  test('shared utilities are defined', () => {
    for (const cls of ['.mc-table-scroll', '.mc-sticky-first', '.mc-sticky-grid', '.mc-on-card', '.mc-stack-mobile', '.mc-grid-2-mobile', '.mc-wrap-mobile', '.mc-sheet-mobile', '.mc-hide-mobile', '.mc-toast-mobile', '.mc-drawer-mobile', '.mc-fav-grid']) {
      assert.ok(section.includes(cls), `${cls} defined`);
    }
    assert.match(section, /\.mc-sheet-mobile \{[\s\S]*?padding-bottom: calc\(16px \+ env\(safe-area-inset-bottom, 0px\)\) !important;/);
  });

  test('light and dark: the phone section uses theme variables, never a hard-coded background', () => {
    const decls = section.replace(/\/\*[\s\S]*?\*\//g, '').match(/background[^;]*;/g) || [];
    for (const d of decls) assert.match(d, /var\(--mc-/, `background uses a theme variable: ${d}`);
  });
});

describe('pages use the shared hooks', () => {
  const cases: Array<[string, string]> = [
    ['app/(dashboard)/page.tsx', 'className="mc-fav-grid"'],
    ['app/(dashboard)/page.tsx', 'className="mc-sheet-mobile"'],
    ['app/(dashboard)/page.tsx', 'className="mc-toast-mobile"'],
    ['app/(dashboard)/portfolio/page.tsx', 'className="mc-sticky-first"'],
    ['app/(dashboard)/portfolio/page.tsx', 'className="mc-grid-2-mobile"'],
    ['app/(dashboard)/portfolio/page.tsx', 'className="mc-stack-mobile"'],
    ['app/(dashboard)/us-portfolio-book/sortable-table.tsx', 'className="mc-sticky-first mc-on-card"'],
    ['app/(dashboard)/portfolio-catalysts/page.tsx', 'className="mc-grid-2-mobile"'],
    ['app/(dashboard)/us-portfolio-catalysts/page.tsx', 'className="mc-grid-2-mobile"'],
    ['app/(dashboard)/ai-gainers/page.tsx', 'className="mc-sticky-first"'],
    ['app/(dashboard)/ai-gainers/page.tsx', 'className="mc-sticky-grid"'],
    ['components/ai-gainers/ResearchTriage.tsx', 'className="mc-sticky-first"'],
    ['components/ai-gainers/EventDrawer.tsx', 'className="mc-drawer-mobile"'],
    ['components/dashboard/theme-rotation/ThemeTable.tsx', 'className="trt-filter-label"'],
  ];
  for (const [file, hook] of cases) {
    test(`${file} carries ${hook}`, () => assert.ok(read(file).includes(hook)));
  }

  test('the portfolio sort headers still sort (layout change did not drop the handler)', () => {
    const p = read('app/(dashboard)/portfolio/page.tsx');
    assert.match(p, /onClick=\{\(\) => !col\.noSort && handleSort\(col\.key\)\}/);
    const t = read('app/(dashboard)/us-portfolio-book/sortable-table.tsx');
    assert.match(t, /onClick=\{\(\) => click\(c\)\}/);
  });

  test('no named exports on the page files touched for layout', () => {
    for (const f of ['app/(dashboard)/page.tsx', 'app/(dashboard)/portfolio/page.tsx', 'app/(dashboard)/portfolio-catalysts/page.tsx',
      'app/(dashboard)/us-portfolio-catalysts/page.tsx', 'app/(dashboard)/ai-gainers/page.tsx']) {
      const named = read(f).split('\n').filter((l) => /^export\s+(?!default\b)/.test(l) && !/^export\s+const\s+(dynamic|revalidate|runtime|metadata|fetchCache|preferredRegion|maxDuration)\b/.test(l));
      assert.deepEqual(named, [], `${f} has named exports: ${named.join(' | ')}`);
    }
  });
});
