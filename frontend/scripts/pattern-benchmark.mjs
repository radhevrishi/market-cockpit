#!/usr/bin/env node
// zzz1045e — runs the chart-pattern benchmark (lib/pattern-benchmark.ts) and prints a table of precision / recall per pattern,
// market and timeframe.
//   cd frontend && node --import tsx scripts/pattern-benchmark.mjs                     → the SYNTHETIC seed set (harness check only)
//   cd frontend && node --import tsx scripts/pattern-benchmark.mjs labels.json [--json] → the owner's labelled examples
// See the header of src/lib/pattern-benchmark.ts for the example format and how to label blind.
import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBenchmark, benchTable, barsFromCloses, synthBars, SEED_EXAMPLES } from '../src/lib/pattern-benchmark.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
const examples = file ? JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8')) : SEED_EXAMPLES;
if (!Array.isArray(examples)) { console.error('The labels file must hold a JSON array of examples.'); process.exit(2); }

const files = new Map();
const readBarsFile = (p) => {
  if (!files.has(p)) files.set(p, JSON.parse(readFileSync(resolve(root, p), 'utf8')));
  return files.get(p);
};
const load = (ex) => {
  const b = ex.bars || {};
  if (b.synthetic) return synthBars(b.synthetic);
  if (Array.isArray(b.ohlcv)) return b.ohlcv;
  if (b.file && b.ticker) {
    const x = readBarsFile(b.file)?.tickers?.[b.ticker];
    if (!x) return null;
    if (Array.isArray(x)) return x;                         // OHLCV: [{ t, o, h, l, c, v }]
    if (Array.isArray(x.c) && Number.isFinite(x.d0)) return barsFromCloses(x);   // closes-only fixture format
  }
  return null;
};
const report = runBenchmark(examples, load);
if (asJson) console.log(JSON.stringify({ cells: report.cells, totals: report.totals, disputed: report.disputed, noBars: report.noBars, synthetic: report.synthetic }, null, 2));
else console.log(benchTable(report));
