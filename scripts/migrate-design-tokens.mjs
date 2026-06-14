#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// scripts/migrate-design-tokens.fixed.mjs
//
// Hardened version of migrate-design-tokens.mjs. Fixes two bugs in the
// original:
//
//   BUG #1 — original walked .css files and corrupted the source-of-truth
//            design-system.css by making every var self-referential
//            (--mc-bg-0: var(--mc-bg-0)).
//
//   BUG #2 — original rewrote hex literals inside data tables (lib/yahoo.ts
//            SECTOR_ETFS_INDIA, lib/turnaround.ts, etc) whose `.color` field
//            is later consumed via `${x.color}XX` template-literal patterns
//            in 436 places across the frontend. After rewrite those become
//            `var(--mc-bullish)25` — broken CSS.
//
// FIXES
//   1. EXCLUDE source-of-truth files (design-system.css, design-tokens.ts,
//      theme.ts).
//   2. For .ts/.tsx files: only rewrite hex literals inside JSX
//      `style={{ ... }}` blocks (brace-walked) and inside styled-jsx
//      `<style jsx>{`...`}</style>` template literals. Hex literals in
//      data tables are left alone.
//   3. For .css files: rewrite freely (design-system.css already excluded).
//
// USAGE
//   node scripts/migrate-design-tokens.fixed.mjs --dry-run
//   node scripts/migrate-design-tokens.fixed.mjs --dry-run --page super-investors
//   node scripts/migrate-design-tokens.fixed.mjs
//
// ─────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const HEX_TO_VAR = new Map([
  // Surfaces
  ['#0A0E1A', 'var(--mc-bg-0)'],
  ['#0F1828', 'var(--mc-bg-1)'],
  ['#111B35', 'var(--mc-bg-2)'],
  ['#172234', 'var(--mc-bg-3)'],
  ['#1A2540', 'var(--mc-bg-4)'],
  ['#1A2840', 'var(--mc-bg-4)'],
  ['#0D1623', 'var(--mc-bg-1)'],
  ['#0F1E30', 'var(--mc-bg-0)'],
  // Borders
  ['#1E2D45', 'var(--mc-border-1)'],
  ['#2D3E5F', 'var(--mc-border-2)'],
  // Text
  ['#F5F7FA', 'var(--mc-text-0)'],
  ['#E6EDF3', 'var(--mc-text-1)'],
  ['#CBD5E1', 'var(--mc-text-2)'],
  ['#94A3B8', 'var(--mc-text-3)'],
  ['#6B7A8D', 'var(--mc-text-4)'],
  ['#8BA3C1', 'var(--mc-text-3)'],
  ['#7AA2D8', 'var(--mc-text-3)'],
  ['#4A5B6C', 'var(--mc-text-4)'],
  ['#475569', 'var(--mc-text-4)'],
  // Semantic / state
  ['#10B981', 'var(--mc-bullish)'],
  ['#2EA043', 'var(--mc-bullish-2)'],
  ['#EF4444', 'var(--mc-bearish)'],
  ['#DC2626', 'var(--mc-bearish-2)'],
  ['#F59E0B', 'var(--mc-warn)'],
  ['#3B82F6', 'var(--mc-info)'],
  ['#0F7ABF', 'var(--mc-accent)'],
  ['#1E8FD4', 'var(--mc-accent-light)'],
  ['#0A5A99', 'var(--mc-accent-dark)'],
  ['#22D3EE', 'var(--mc-cyan)'],
  ['#FF9933', 'var(--mc-saffron)'],
  ['#5EEAD4', 'var(--mc-state-warm)'],
  ['#A78BFA', 'var(--mc-state-persistent)'],

  // PATCH 1081b — actual dark-theme palette used across the codebase. Mapped to
  // closest existing --mc-* var (see frontend/src/styles/design-system.css).
  ['#0A1422', 'var(--mc-bg-0)'],         // dark navy page bg
  ['#0D1B2E', 'var(--mc-bg-1)'],         // card alt
  ['#1A2B3C', 'var(--mc-bg-2)'],         // panel header
  ['#1E293B', 'var(--mc-bg-3)'],         // table header
  ['#2A3B4C', 'var(--mc-border-2)'],     // strong border
  ['#C9D4E0', 'var(--mc-text-2)'],       // secondary text
  ['#8A95A3', 'var(--mc-text-3)'],       // muted text
  ['#64748B', 'var(--mc-text-4)'],       // dimmest text
  ['#FBBF24', 'var(--mc-warn)'],         // amber accent (alias)
  ['#8B5CF6', 'var(--mc-state-persistent)'],  // violet (alias)
  ['#5B6A82', 'var(--mc-text-4)'],
  ['#8899AA', 'var(--mc-text-3)'],
  ['#7d8590', 'var(--mc-text-3)'],
  ['#484f58', 'var(--mc-text-4)'],
  ['#1c232c', 'var(--mc-bg-2)'],
  ['#161B22', 'var(--mc-bg-1)'],
  ['#0d1117', 'var(--mc-bg-0)'],
  ['#22C55E', 'var(--mc-bullish)'],
  ['#16A34A', 'var(--mc-bullish-2)'],
  ['#F97316', 'var(--mc-warn)'],
  ['#FB923C', 'var(--mc-warn)'],
  ['#9CA3AF', 'var(--mc-text-3)'],
  ['#6B7280', 'var(--mc-text-4)'],
]);

const HEX_RE = /(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?(?=[^0-9A-Fa-f]|$)/g;

function rewriteRange(src, conflicts, stats) {
  return src.replace(HEX_RE, (match, hex6, alpha) => {
    const key = hex6.toUpperCase();
    const target = HEX_TO_VAR.get(key);
    if (!target) return match;
    if (alpha) {
      // PATCH 1081d — alpha-channel migration via color-mix(). Modern browsers
      // (Chrome 111+, Safari 16.4+, Firefox 113+) support this. Converts the
      // hex+alpha pair to color-mix(in srgb, var(--mc-...) NN%, transparent).
      const a255 = parseInt(alpha, 16);
      const pct = Math.round((a255 / 255) * 100);
      stats.set(key, (stats.get(key) || 0) + 1);
      return `color-mix(in srgb, ${target} ${pct}%, transparent)`;
    }
    stats.set(key, (stats.get(key) || 0) + 1);
    return target;
  });
}

// Find every `style={{ ... }}` region by brace-walking and every
// styled-jsx tagged template by scanning for `<style jsx>{` and matching
// `</style>`. Returns an array of [start, end] ranges (end exclusive).
function findRewritableRanges(src) {
  const ranges = [];
  // style={{ ... }}
  let i = 0;
  while (i < src.length) {
    const idx = src.indexOf('style={{', i);
    if (idx === -1) break;
    let depth = 2; // we've consumed `{{`
    let j = idx + 'style={{'.length;
    while (j < src.length && depth > 0) {
      const ch = src[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    ranges.push([idx, j]);
    i = j;
  }
  // <style jsx>{ ... }</style>  and  <style jsx global>{ ... }</style>
  const styleOpen = /<style[^>]*>\{`/g;
  let m;
  while ((m = styleOpen.exec(src)) !== null) {
    const start = m.index;
    const end = src.indexOf('`}</style>', m.index);
    if (end !== -1) ranges.push([start, end]);
  }
  return ranges;
}

function rewriteJsxFile(src) {
  const ranges = findRewritableRanges(src);
  if (ranges.length === 0) return { out: src, stats: new Map(), conflicts: [] };
  // Sort + merge overlapping
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    } else merged.push([...r]);
  }
  const stats = new Map();
  const conflicts = [];
  let out = '';
  let cursor = 0;
  for (const [s, e] of merged) {
    out += src.slice(cursor, s);
    out += rewriteRange(src.slice(s, e), conflicts, stats);
    cursor = e;
  }
  out += src.slice(cursor);
  return { out, stats, conflicts };
}

function rewriteCssFile(src) {
  const stats = new Map();
  const conflicts = [];
  const out = rewriteRange(src, conflicts, stats);
  return { out, stats, conflicts };
}

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const pageArg = (() => {
  const i = process.argv.indexOf('--page');
  return i > 0 ? process.argv[i + 1] : null;
})();
const jsonOut = args.has('--json');

async function* walk(dir) {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === '.next') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx|css)$/.test(ent.name)) {
      yield full;
    }
  }
}

const root = path.resolve(process.cwd(), 'frontend/src');

// EXCLUDE source-of-truth files (BUG #1 + BUG #2).
const EXCLUDE = new Set([
  path.resolve(root, 'styles/design-system.css'),
  path.resolve(root, 'lib/design-tokens.ts'),
  path.resolve(root, 'lib/theme.ts'),
]);

const summary = { files: 0, changedFiles: 0, totalRepl: 0, conflicts: [] };

for await (const file of walk(root)) {
  if (EXCLUDE.has(file)) continue;
  if (pageArg && !file.includes(`/${pageArg}/`)) continue;
  const src = await fs.readFile(file, 'utf8');
  const isCss = file.endsWith('.css');
  const { out, stats, conflicts } = isCss ? rewriteCssFile(src) : rewriteJsxFile(src);
  summary.files++;
  if (out === src) continue;
  summary.changedFiles++;
  const total = [...stats.values()].reduce((a, b) => a + b, 0);
  summary.totalRepl += total;
  for (const c of conflicts) summary.conflicts.push({ file, ...c });
  if (dryRun) {
    console.log(`\n— ${path.relative(process.cwd(), file)} (${total} replacements)`);
    for (const [hex, n] of stats) console.log(`    ${hex} → ${HEX_TO_VAR.get(hex)}  (${n}x)`);
  } else {
    await fs.writeFile(file, out, 'utf8');
    console.log(`✓ ${path.relative(process.cwd(), file)} (${total} replacements)`);
  }
}

if (jsonOut) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('');
  console.log(`Scanned: ${summary.files}`);
  console.log(`Modified: ${summary.changedFiles} ${dryRun ? '(dry-run)' : ''}`);
  console.log(`Total hex replacements: ${summary.totalRepl}`);
  if (summary.conflicts.length) {
    console.log(`Alpha-channel conflicts (need design review): ${summary.conflicts.length}`);
    console.log('  Run with --json to inspect the full list.');
  }
}
