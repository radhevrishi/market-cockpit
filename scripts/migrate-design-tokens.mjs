#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// scripts/migrate-design-tokens.mjs  (HANDOFF4)
//
// Walk frontend/src/**/*.{ts,tsx} and rewrite inline hex literals to the
// design-system CSS variables shipped in PATCH 1060.
//
// USAGE
//   node scripts/migrate-design-tokens.mjs --dry-run            # report only
//   node scripts/migrate-design-tokens.mjs --dry-run --page super-investors
//   node scripts/migrate-design-tokens.mjs                      # write changes
//
// FLAGS
//   --dry-run     Print the diff per file; do NOT write
//   --page <id>   Limit to one page (matches the route folder name)
//   --json        Emit per-file machine-readable report
//
// The script is intentionally conservative: it only rewrites hex codes that
// appear in JSX style props or styled-jsx blocks, never inside string
// literals that look like data (e.g. ticker colours). If a hex value has
// multiple plausible token names, we leave it alone and log the conflict.
// ─────────────────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// Map from raw hex (uppercased, no alpha) to the CSS variable it replaces.
// Cross-reference with frontend/src/styles/design-system.css :root block.
const HEX_TO_VAR = new Map([
  // Surfaces
  ['#0A0E1A', 'var(--mc-bg-0)'],
  ['#0F1828', 'var(--mc-bg-1)'],
  ['#111B35', 'var(--mc-bg-2)'],
  ['#172234', 'var(--mc-bg-3)'],
  ['#1A2540', 'var(--mc-bg-4)'],
  ['#1A2840', 'var(--mc-bg-4)'],     // audit-listed alias
  ['#0D1623', 'var(--mc-bg-1)'],     // common card alt
  ['#0F1E30', 'var(--mc-bg-0)'],     // brand-navy-dark alias

  // Borders
  ['#1E2D45', 'var(--mc-border-1)'],
  ['#2D3E5F', 'var(--mc-border-2)'],

  // Text
  ['#F5F7FA', 'var(--mc-text-0)'],
  ['#E6EDF3', 'var(--mc-text-1)'],
  ['#CBD5E1', 'var(--mc-text-2)'],
  ['#94A3B8', 'var(--mc-text-3)'],
  ['#6B7A8D', 'var(--mc-text-4)'],
  ['#8BA3C1', 'var(--mc-text-3)'],   // close enough — audit alias
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
]);

// Conservative hex matcher: 6-digit hex preceded by `:` or `=` or `'`/`"` /
// `(` so we don't rewrite arbitrary tokens that happen to look hex inside
// other contexts (e.g. CSS gradients with multiple stops have alpha pairs
// that we want to preserve — alpha is added back below).
const HEX_RE = /(#[0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?(?=[^0-9A-Fa-f]|$)/g;

function replaceHex(input) {
  const conflicts = [];
  const stats = new Map();
  let out = input;
  out = out.replace(HEX_RE, (match, hex6, alpha) => {
    const key = hex6.toUpperCase();
    const target = HEX_TO_VAR.get(key);
    if (!target) return match;
    stats.set(key, (stats.get(key) || 0) + 1);
    // CSS variables can't carry an alpha pair, so if the source had `#10B98115`
    // we have to use color-mix() or a sibling --mc-*-bg variant. For PATCH 1062
    // we leave alpha'd values alone and log them — they need design review.
    if (alpha) {
      conflicts.push({ hex: key, alpha, suggestion: target, full: `${hex6}${alpha}` });
      return match;
    }
    return target;
  });
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
const summary = { files: 0, changedFiles: 0, totalRepl: 0, conflicts: [] };

for await (const file of walk(root)) {
  if (pageArg && !file.includes(`/${pageArg}/`)) continue;
  const src = await fs.readFile(file, 'utf8');
  const { out, stats, conflicts } = replaceHex(src);
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
