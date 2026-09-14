// ═══════════════════════════════════════════════════════════════════════════
// US EARNINGS ENGINE — REGRESSION SUITE
//
// Every case below is a REAL filing that once produced a wrong number on a
// card, with the answer the filing actually supports. They are the memory of
// this engine: each one cost a round of "this is wrong, fix it", and without a
// runnable record of them a later fix quietly reintroduces an earlier bug —
// which has already happened twice.
//
//   npx tsx scripts/us-earnings-regression.ts
//
// It reads live from SEC EDGAR (a few hundred requests behind the politeness
// gate, so it takes a couple of minutes) and exits non-zero on any failure.
// ADD A CASE EVERY TIME A DEFECT IS FIXED. The comment on each case is the
// defect it guards against.
// ═══════════════════════════════════════════════════════════════════════════

import { submissions, tickerToCik } from '../src/lib/us-edgar';
import { releaseDocument } from '../src/lib/us-guidance';
import { adjustedEpsFromReleaseHtml } from '../src/lib/us-pr-adjusted';
import { oneOffsFromReleaseHtml, epsExOneOffs, absoluteOneOffsFromReleaseHtml } from '../src/lib/us-one-offs';

interface Case {
  ticker: string;
  /** GAAP diluted EPS for the quarter, as the engine resolves it from XBRL. */
  gaap: number;
  /** Period end of the quarter being graded. */
  qEnd: string;
  /** Expected adjusted EPS from the release — null means "the release states
   *  none for this quarter, and inventing one is the bug". */
  adj: number | null;
  /** Expected core EPS after removing the one-offs the release quantifies —
   *  null means no applicable one-off. */
  core: number | null;
  /** The largest BENEFIT the release quantifies in dollars and never per share,
   *  in $m, or null when there is none. `undefined` means the case does not
   *  check it. */
  absBenefitMusd?: number | null;
  why: string;
}

const CASES: Case[] = [
  { ticker: 'BURL', gaap: 2.88, qEnd: '2026-08-01', adj: 2.96, core: 2.37,
    why: 'a one-off INSIDE the company\'s own adjusted figure ($0.59 of tariff refunds) — the original defect' },
  { ticker: 'AAP', gaap: 0.90, qEnd: '2026-07-18', adj: 1.03, core: 0.72,
    why: '"contributed $0.31 to adjusted EPS" — a tie-verb that is not "includes"' },
  { ticker: 'TGT', gaap: 4.11, qEnd: '2026-08-01', adj: 4.11, core: 2.46,
    why: 'the item is disclosed AFTER "compared with", which the prior-year trim used to discard' },
  { ticker: 'ANF', gaap: 4.17, qEnd: '2026-08-02', adj: 4.17, core: 2.42,
    why: 'the disclosure never says "adjusted" — but GAAP and adjusted are the same figure here' },
  { ticker: 'CRM', gaap: 4.29, qEnd: '2026-07-31', adj: 5.90, core: 3.37,
    why: 'a footnote naming BOTH bases: the non-GAAP effect ($2.53), not the GAAP one ($2.43), and 170 characters from its sign word' },
  { ticker: 'WDAY', gaap: 2.57, qEnd: '2026-07-31', adj: 2.75, core: null,
    why: 'the $1.52 tax benefit sits in the GAAP line; subtracting it from non-GAAP turned a +5% beat into a −53% miss' },
  { ticker: 'BBW', gaap: 0.70, qEnd: '2026-08-01', adj: 0.70, core: null,
    why: 'the stated ex-item figure ($1.73) is the 26-week column — an item cannot exceed the quarter it sits inside' },
  { ticker: 'EL', gaap: -0.32, qEnd: '2026-06-30', adj: null, core: null,
    why: '"increased to $2.51" is the FULL YEAR, in a paragraph whose only period marker is "in fiscal 2026"' },
  { ticker: 'MZTI', gaap: 1.77, qEnd: '2026-06-30', adj: 1.46, core: null,
    why: 'a row labelled "Diluted EPS Change ($)" is a delta, not a level — it produced a fabricated 91% miss' },
  { ticker: 'SJM', gaap: 3.03, qEnd: '2026-07-31', adj: 3.24, core: 2.40,
    why: 'tariff refunds received, stated per share inside the adjusted figure' },
  { ticker: 'DLTR', gaap: 2.70, qEnd: '2026-08-01', adj: 2.70, core: 1.39,
    why: 'a $1.31 benefit inside a figure where GAAP and adjusted coincide' },
  { ticker: 'A', gaap: 1.28, qEnd: '2026-07-31', adj: 1.62, core: 1.56,
    why: 'footnote markers — "non-GAAP EPS (3) of $1.62" — sat where the sentence shapes expect the verb, so no adjusted EPS was found at all; and the $0.06 per-share benefit must win over the $17M absolute beside it' },
  { ticker: 'GAP', gaap: 1.38, qEnd: '2026-08-01', adj: 0.52, core: null,
    why: 'the adjusted figure ALREADY excludes the recovery: no second subtraction' },
  { ticker: 'BBWI', gaap: 0.58, qEnd: '2026-08-01', adj: 0.62, core: 0.31,
    why: '"Excluding the refund benefit, adjusted EPS would have been $0.31" — the company\'s own ex-item figure' },
  { ticker: 'CRWD', gaap: 0.01, qEnd: '2026-07-31', adj: 0.31, core: null,
    why: 'a clean software quarter — no one-off anywhere, and none may be invented' },
  { ticker: 'OKTA', gaap: 0.65, qEnd: '2026-07-31', adj: 1.05, core: null, why: 'clean quarter, control case' },
  { ticker: 'BOX', gaap: 0.09, qEnd: '2026-07-31', adj: 0.40, core: null, why: 'clean quarter, control case' },
  { ticker: 'ZM', gaap: 5.15, qEnd: '2026-07-31', adj: 1.55, core: null, why: 'huge GAAP/adjusted gap from a tax item already excluded' },
  { ticker: 'WSM', gaap: 2.84, qEnd: '2026-08-03', adj: 2.10, core: null, absBenefitMusd: 167.8,
    why: 'a $167.8m benefit written as "a reduction of cost of goods sold" — the nearest sign word to the amount is "cost", which read a benefit as a charge' },
  { ticker: 'KSS', gaap: 1.28, qEnd: '2026-08-01', adj: 1.28, core: null, absBenefitMusd: 150,
    why: 'adjusted EPS equals GAAP and the $150m of tariff refunds is quantified only in dollars — a 124% "beat" that was mostly the refund' },
  { ticker: 'DLTR', gaap: 2.70, qEnd: '2026-08-01', adj: 2.70, core: 1.39, absBenefitMusd: null,
    why: 'the dollar-only scan must not pick up "in the fourth quarter of fiscal 2024" — a real item, in a quarter reported two years ago' },
];

const near = (a: number | null, b: number | null, tol = 0.02) =>
  (a == null && b == null) || (a != null && b != null && Math.abs(a - b) <= tol);

(async () => {
  let failed = 0;
  for (const c of CASES) {
    let adj: number | null = null;
    let core: number | null = null;
    let absB: number | null = null;
    let err = '';
    try {
      const cik = await tickerToCik(c.ticker);
      const sub: any = await submissions(cik!);
      const f = (sub?.recent || []).find((x: any) =>
        x.form === '8-K' && x.items.some((i: string) => i.startsWith('2.02')));
      if (!f) throw new Error('no earnings 8-K on file');
      const accNoDash = String(f.accession).replace(/-/g, '');
      const doc = await releaseDocument(cik!, f.accession,
        `https://www.sec.gov/Archives/edgar/data/${cik}/${accNoDash}/${f.accession}-index.htm`);
      const a = adjustedEpsFromReleaseHtml(doc.html || '', { gaapEps: c.gaap, periodEndISO: c.qEnd });
      adj = a ? a.value : null;
      const ex = epsExOneOffs(adj, oneOffsFromReleaseHtml(doc.html || ''), c.gaap);
      core = ex ? ex.eps : null;
      const abs = absoluteOneOffsFromReleaseHtml(doc.html || '', c.qEnd).filter((o) => o.amount_usd > 0);
      absB = abs.length ? Math.max(...abs.map((o) => o.amount_usd)) / 1e6 : null;
    } catch (e: any) { err = String(e?.message || e); }

    const okAdj = near(adj, c.adj);
    const okCore = near(core, c.core);
    const okAbs = c.absBenefitMusd === undefined || near(absB, c.absBenefitMusd, 0.2);
    const ok = okAdj && okCore && okAbs && !err;
    if (!ok) failed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.ticker.padEnd(5)} adj ${String(adj).padEnd(6)}(exp ${String(c.adj).padEnd(6)})` +
      ` core ${String(core).padEnd(6)}(exp ${String(c.core).padEnd(6)})` +
      (c.absBenefitMusd === undefined ? '' : ` $one-off ${String(absB).padEnd(6)}(exp ${String(c.absBenefitMusd).padEnd(6)})`) +
      `${err ? '  ERR ' + err : ''}`);
    if (!ok) console.log(`      ↳ guards: ${c.why}`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
  process.exit(failed ? 1 : 0);
})();
