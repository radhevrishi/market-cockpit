// ═══════════════════════════════════════════════════════════════════════════
// THE FIRST TESTS THIS REPOSITORY HAS EVER HAD.                     (zzz728)
//
// The audit found zero project-owned tests across 1,238 tracked files. Every
// wrong answer shipped on 21 September — four of them, all silent — would have
// been caught by one of the cases below, and every one was instead found by
// curling the deployed endpoint and reading the numbers by hand.
//
// NO NEW DEPENDENCY. Node 22's built-in `node:test` runner plus the `tsx`
// already in the project. Adding vitest would have meant a dependency, a lock
// change and a config file for a capability the runtime already has.
//
//   npm run test            (added to package.json)
//   npx tsx --test 'src/lib/__tests__/*.test.ts'
//
// FIXTURES ARE REAL, CAPTURED DOCUMENTS, not hand-written approximations:
//   · screener-gainers.html       the owner's live gainers screen
//   · screener-company-kmew.html  a real company page with 25 documents
//   · bench-rows.json             13 real graded rows from the server bench
//
// A hand-written fixture tests the parser against the author's belief about
// the source. That belief is exactly what was wrong in the CSV-column bug, so
// these are the bytes the sources actually served.
// ═══════════════════════════════════════════════════════════════════════════

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parsePage } from '../ai-gainers/screener-gainers';
import { parseCompanyDocs, pickDocument, screenerSymbol } from '../earnings/screener-documents';
import { quoteIsInDocument, normaliseForQuoteMatch } from '../ai-gainers/announcement-reader';
import { extractVariables } from '../thesis/variables';
import { assessThesis } from '../thesis/status';
import { classifyGradedRow, classifyWithFiling } from '../earnings/pattern-abfg';
import { sourceTierOf, researchPriority, type GainerEvent } from '../ai-gainers/events';
import {
  symbolsFromStoredValue, mergeUniverse, originCounts, benchPassingPreset,
} from '../thesis/universe';
import {
  candidatesFromFilings, classifyExchangeDoc, rankCandidates, selectForReading, resolveDiscovery,
} from '../thesis/evidence-discovery';
import { findPassages, validateEvents, judgeEventQuality, valueFitsVariable, betterReading } from '../thesis/evidence-extract';
import { scaledNumber, deltaOf as ledgerDeltaOf, sameUnit as ledgerSameUnit } from '../thesis/evidence-ledger';
import {
  reportingPeriodFromDate, periodOrdinal, reportingPeriodForDocuments, factsFromEvents, documentId,
  emptyLedger, mergePeriod, recordAttempt, recordSeen, recordStatus, whatChanged, freshnessOf,
  latestSummary, ledgerView, batchProgress, sameUnit, type CompanyLedger,
} from '../thesis/evidence-ledger';
import { varsFromEvents, isDenial, levelText, said } from '../thesis/variables';
import { reportedInWindow, planRecentReads, isResultsFiling } from '../thesis/recent-reporters';
import { parseCompanyId, parseTopRatios, parseAnnouncements, parseChart } from '../ai-gainers/screener-company';
import {
  classifyAnnouncement, buildFinding, returnsFromSeries, bandPrint, pricedInOf, scoreCatalyst, parseStatedValue, coverage,
} from '../ai-gainers/catalyst-research';

const fx = (n: string) => readFileSync(join(__dirname, 'fixtures', n), 'utf8');
const benchRows: any[] = JSON.parse(fx('bench-rows.json'));
const row = (t: string) => benchRows.find((r) => r.ticker === t);

// ═══════════════════════════════════════════════════════════════════════════
describe('gainers screen parser', () => {
  const html = fx('screener-gainers.html');

  test('reads every row with a non-zero move', () => {
    const { rows, error } = parsePage(html);
    assert.equal(error, null);
    assert.ok(rows.length >= 20, `expected a full page, got ${rows.length}`);
    // THE REGRESSION THIS LOCKS: the US side of this pipeline shipped with a
    // guessed column key and every gainer read exactly 0%. It parsed cleanly
    // and was wrong — the failure mode a type system cannot catch.
    const zeros = rows.filter((r) => r.movePct === 0 || r.movePct === null);
    assert.equal(zeros.length, 0, `${zeros.length} rows have no move — the column key is wrong`);
  });

  test('takes the ticker from the link, not the truncated display name', () => {
    const { rows } = parsePage(html);
    const first = rows[0];
    // screener prints "Sr.Rayala.Hypo"; only the href carries SRHHYPOLTD, and
    // the display name would match nothing on the bench.
    assert.match(first.ticker, /^[A-Z0-9&-]+$/);
    assert.ok(!first.ticker.includes('.'), 'ticker looks like a display name');
  });

  test('fails LOUDLY when the move column is absent', () => {
    // The owner can rename or remove a column on his own screen at any time.
    //
    // Note on the fixture surgery: the header text is fragmented across an
    // <a> inside the <th>, so a naive replace of the rendered string "1day
    // return %" changes nothing in the raw HTML — the first version of this
    // test did exactly that and passed 25 rows through, which is how the test
    // found a flaw in itself rather than in the parser. Replacing the token
    // is what actually removes the column from what the parser sees.
    const stripped = html.replace(/1day/gi, 'Widget');
    const { rows, error } = parsePage(stripped);
    assert.equal(rows.length, 0);
    assert.match(String(error), /no "1day return" column/);
  });

  test('reports a page with no table as an error, not as zero gainers', () => {
    const { error } = parsePage('<html><body>maintenance</body></html>');
    assert.match(String(error), /no results table/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('company document resolver', () => {
  const html = fx('screener-company-kmew.html');

  test('finds concall transcripts with their periods', () => {
    const { docs, error } = parseCompanyDocs(html);
    assert.equal(error, null);
    const transcripts = docs.filter((d) => d.kind === 'transcript');
    assert.ok(transcripts.length >= 5, `expected a concall history, got ${transcripts.length}`);
    assert.ok(transcripts.every((d) => d.period), 'a transcript with no period could be read as this quarter');
  });

  test('never offers an audio recording as a readable document', () => {
    const { docs } = parseCompanyDocs(html);
    // The page lists .mp3 and YouTube links beside each transcript. This
    // pipeline has no transcription step, so offering one produces a failure
    // two layers downstream with a misleading error.
    assert.equal(docs.filter((d) => /\.(mp3|wav|m4a)|youtu/i.test(d.url)).length, 0);
  });

  test('picks the transcript nearest the quarter being read', () => {
    const { docs } = parseCompanyDocs(html);
    const pick = pickDocument(docs, '2026-08-14');
    assert.equal(pick?.kind, 'transcript');
    assert.equal(pick?.period, 'Sep 2026');
  });

  test('NSE series suffixes are dropped before asking screener.in', () => {
    // MTARTECH-BE and IFBAGRO-BE in the book both 404'd: screener keys the
    // page on the bare symbol.
    assert.equal(screenerSymbol('MTARTECH-BE'), 'MTARTECH');
    assert.equal(screenerSymbol('ifbagro-be'), 'IFBAGRO');
    assert.equal(screenerSymbol('M&M'), 'M&M');
    assert.equal(screenerSymbol('BAJAJ-AUTO'), 'BAJAJ-AUTO', 'a real hyphenated symbol is untouched');
  });

  test('an empty page reports why, and returns no documents', () => {
    const { docs, error } = parseCompanyDocs('<html></html>');
    assert.equal(docs.length, 0);
    assert.match(String(error), /no readable documents/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('quote validation — the hallucination firewall', () => {
  const doc = 'The Board approved a capital expenditure of Rs. 420 crore for the '
    + 'expansion of the Unit-III facility, which is expected to be commissioned by Q2 FY28.';

  test('accepts a verbatim quote', () => {
    assert.ok(quoteIsInDocument(doc, 'The Board approved a capital expenditure of Rs. 420 crore'));
  });

  test('REJECTS a fabricated quote', () => {
    // A model asked for a quote will produce something quote-shaped whether or
    // not it read one. This is the single most important assertion in the file.
    assert.equal(quoteIsInDocument(doc, 'The Board approved a capital expenditure of Rs. 900 crore for Unit-IV'), false);
  });

  test('accepts curly quotes and en-dashes from a PDF text layer', () => {
    const pdfish = doc.replace('Rs. 420 crore', 'Rs. 420 crore').replace(/-/g, '–');
    assert.ok(quoteIsInDocument(pdfish, 'The Board approved a capital expenditure of Rs. 420 crore'));
  });

  test('survives hyphenation across a line break', () => {
    const hyphenated = 'The Board approved a capital expen-\nditure of Rs. 420 crore for the expansion.';
    assert.ok(quoteIsInDocument(hyphenated, 'The Board approved a capital expenditure of Rs. 420 crore'));
  });

  test('rejects a quote too short to mean anything', () => {
    assert.equal(quoteIsInDocument(doc, 'The Board'), false);
  });

  test('normalisation is idempotent', () => {
    const once = normaliseForQuoteMatch(doc);
    assert.equal(normaliseForQuoteMatch(once), once);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('structural variables', () => {
  test('reads the YoY margin bridge from opm_pct and opm_prev_pct', () => {
    // THE REGRESSION THIS LOCKS: the extractor looked only for `opm_change_pp`,
    // which the bench does not carry, so twelve holdings reported "operating
    // margin not disclosed" while both numbers sat in the same row.
    const vars = extractVariables(row('KMEW'), null);
    const m = vars.find((v) => v.key === 'margin');
    assert.ok(m, 'margin variable missing');
    assert.equal(m!.before, '41.0%');
    assert.equal(m!.after, '64.0%');
    assert.equal(m!.delta, '+23.0pp');
    assert.equal(m!.verdict, 'improving');
  });

  test('a negative cash ratio against a LOSS is not counted as deterioration', () => {
    // Same sign-inversion that made the profit-leak flag fire on Raymond at
    // PAT -99%. Negative cash against positive profit is the warning; positive
    // cash against a loss is the company funding itself through a bad quarter.
    const loss = { ...row('KMEW'), cfo_to_pat_ratio: -3.2, pat_curr_cr: -50 };
    const v = extractVariables(loss, null).find((x) => x.key === 'cash_conversion');
    assert.equal(v!.verdict, 'flat');
    assert.match(v!.evidence, /loss-making/);
  });

  test('a negative cash ratio with an unknown profit sign is STATED (shown, not judged), never a guess', () => {
    const unknown = { ...row('KMEW'), cfo_to_pat_ratio: -21.3, pat_curr_cr: null };
    const v = extractVariables(unknown, null).find((x) => x.key === 'cash_conversion');
    assert.equal(v!.verdict, 'stated');
    assert.equal(v!.after, '-21.30×');
  });

  test('operating leverage is not computed off a trivial revenue base', () => {
    const flat = { ...row('KMEW'), sales_yoy_pct: 0.4, eps_yoy_pct: 80 };
    const v = extractVariables(flat, null).find((x) => x.key === 'operating_leverage');
    assert.equal(v!.verdict, 'unknown');
  });

  test('an undisclosed variable produces NO variable at all — never a flat one', () => {
    const vars = extractVariables(row('KMEW'), null);
    assert.equal(vars.find((v) => v.key === 'utilisation'), undefined);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('thesis status ladder', () => {
  const assess = (ticker: string, opts: any = {}) => {
    const g = row(ticker);
    const vars = extractVariables(g, opts.summary ?? null);
    return assessThesis({
      pattern: classifyGradedRow(g)?.pattern ?? null,
      variables: vars,
      promiseGap: opts.promiseGap ?? null,
      evidenceReviewed: opts.evidenceReviewed ?? false,
    });
  };

  test('GREEN is unreachable before a document has been read', () => {
    // A good number is the OUTPUT of a thesis, never proof the mechanism is
    // intact. AETHER reached STRENGTHENING on revenue and cash alone.
    for (const t of ['KMEW', 'MINDACORP', 'HAPPYFORGE', 'VIYASH', 'MARKSANS']) {
      assert.notEqual(assess(t).status, 'STRENGTHENING', `${t} went green with nothing read`);
    }
  });

  test('deterioration still surfaces without full coverage — the rule is asymmetric', () => {
    // Damage visible in the filed numbers is not undone by reading more.
    assert.equal(assess('SOTL').status, 'WEAKENING');
    assert.equal(assess('MOREPENLAB').status, 'WEAKENING');
  });

  test('BROKEN requires a NAMED invalidation condition, not arithmetic', () => {
    const a = assess('SOTL');
    assert.notEqual(a.status, 'BROKEN');
    assert.match(a.because, /No stated thesis-break condition has been met|condition/);
  });

  test('when BROKEN does fire it quotes the condition it met', () => {
    const g = { ...row('SOTL'), cfo_to_pat_ratio: 0.1, sales_yoy_pct: -20, eps_yoy_pct: -40 };
    const a = assessThesis({
      pattern: null, variables: extractVariables(g, null),
      promiseGap: null, evidenceReviewed: true,
    });
    if (a.status === 'BROKEN') assert.match(a.because, /Thesis-break condition met/);
  });

  test('AHEAD/BEHIND PLAN is unreachable without plan AND actual', () => {
    // Strong growth must never become "ahead of plan".
    const a = assess('KMEW', { promiseGap: { gap: true, detail: 'x', direction: 'ahead' } });
    assert.ok(!a.status.includes('EXPECTATION_GAP'));
  });

  test('the evidence matrix denominator is thesis-specific, not a fixed 3', () => {
    const a = assess('KMEW'), b = assess('MINDACORP');
    assert.ok(a.coverage.criticalTotal > 3);
    assert.notEqual(a.coverage.criticalTotal, b.coverage.criticalTotal);
    const c = a.coverage;
    assert.equal(c.criticalConfirmed + c.criticalPending + c.criticalContradicted, c.criticalTotal);
  });

  test('every status carries a reason', () => {
    for (const r of benchRows) {
      const a = assess(r.ticker);
      assert.ok(a.because.length > 20, `${r.ticker} has no stated reason`);
      assert.ok(a.action.length > 0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('A/B/F/G classifier', () => {
  test('B is unreachable from a graded row alone', () => {
    // No graded row carries order-book growth, so B was dead code for months.
    assert.notEqual(classifyGradedRow(row('KMEW'))?.pattern, 'B');
  });

  test('B becomes reachable once a filing supplies order-book growth', () => {
    const p = classifyWithFiling(
      { sales_yoy_pct: 30, eps_yoy_pct: 35, cfo_to_pat_ratio: 1.2, d1_pct: 1 },
      { order_book: { growth: '+80%' } },
    );
    assert.equal(p?.pattern, 'B');
  });

  test('order-book growth is never inferred from revenue', () => {
    const p = classifyWithFiling({ sales_yoy_pct: 30, eps_yoy_pct: 35 }, { order_book: {} });
    assert.notEqual(p?.pattern, 'B');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('gainers scoring safeguards', () => {
  const ev = (over: Partial<GainerEvent> = {}): GainerEvent => ({
    eventId: 'x', clusterId: '', market: 'IN', ticker: 'T', company: null,
    eventTime: new Date().toISOString(), detectedAt: new Date().toISOString(),
    catalyst: 'quarterly_result', informationStatus: 'new_information',
    attribution: 'company_specific', priceChangePct: 5, volumeRatio: null,
    sectorRelativePct: null, sources: [], claims: [],
    materiality: 'medium', structuralDuration: 'medium', ...over,
  });

  test('an unknown host is TIER 3, never TIER 2', () => {
    assert.equal(sourceTierOf('https://some-blog.example/post'), 3);
    assert.equal(sourceTierOf('https://www.nseindia.com/corporate-filings'), 1);
  });

  test('a tier-3 source alone scores ZERO evidence', () => {
    const p = researchPriority({ event: ev({ sources: [{ url: 'https://x.com/a/1', tier: 3 }] }) });
    assert.equal(p.components.find((c) => c.key === 'evidence')!.points, 0);
  });

  test('a BIGGER move never outranks a smaller one on price alone', () => {
    // The spec says this twice and it is the easiest principle to lose.
    const small = researchPriority({ event: ev({ priceChangePct: 2 }) });
    const big = researchPriority({ event: ev({ priceChangePct: 45 }) });
    assert.ok(big.score <= small.score, 'price magnitude is leaking into the score');
  });

  test('a large move with no material catalyst is scored DOWN, not up', () => {
    const p = researchPriority({ event: ev({
      priceChangePct: 40, materiality: 'low', informationStatus: 'confirmation',
    }) });
    assert.equal(p.quadrant, 'momentum_speculative');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// THE UNIVERSE — WHICH COMPANIES THE PAGE IS RESPONSIBLE FOR.       (zzz731)
//
// This is where the missing-names bug lived: one localStorage key was read,
// the other three and the entire server bench were not. Every case below is a
// shape that has actually existed in this store.
// ═══════════════════════════════════════════════════════════════════════════
describe('book universe', () => {
  test('all three stored shapes yield symbols', () => {
    assert.deepEqual(symbolsFromStoredValue('["kmew","sotl"]'), ['KMEW', 'SOTL']);
    assert.deepEqual(symbolsFromStoredValue('[{"symbol":"KMEW.NS"},{"ticker":"sotl"}]'), ['KMEW', 'SOTL']);
    assert.deepEqual(symbolsFromStoredValue('{"KMEW":{"qty":10}}'), ['KMEW']);
  });

  test('unreadable or absent storage yields nothing, never a guess', () => {
    assert.deepEqual(symbolsFromStoredValue(null), []);
    assert.deepEqual(symbolsFromStoredValue('not json'), []);
    assert.deepEqual(symbolsFromStoredValue('42'), []);
  });

  test('a name in the book AND on the bench is ONE row marked both', () => {
    const u = mergeUniverse(['KMEW', 'SOTL'], ['KMEW', 'AVALON']);
    assert.equal(u.size, 3);
    assert.equal(u.get('KMEW'), 'both');
    assert.equal(u.get('SOTL'), 'book');
    assert.equal(u.get('AVALON'), 'bench');
  });

  test('counting never merges the two populations into one number', () => {
    const c = originCounts(['book', 'book', 'bench', 'both']);
    // The held figure must include the both-name: owning it is not cancelled
    // by it also being a candidate.
    assert.deepEqual(c, { book: 3, bench: 2, both: 1, total: 4 });
  });

  test('a bench candidate with NO graded row is excluded, not waved through', () => {
    const g = benchPassingPreset(['NOROW'], {});
    assert.deepEqual(g.passed, []);
    assert.equal(g.failed, 0, 'an unchecked name must not be counted as a preset failure');
    assert.deepEqual(g.unchecked, ['NOROW']);
  });

  test("a row the route returned as source:'none' is unchecked, not passing", () => {
    const g = benchPassingPreset(['X'], { X: { ticker: 'X', source: 'none', market_cap_cr: 9999 } });
    assert.deepEqual(g.passed, []);
    assert.deepEqual(g.unchecked, ['X']);
  });

  test('the preset gate is the SAME preset the alerts use', () => {
    // Built to pass, then broken on one gate at a time. If this test and
    // lib/quality-preset ever disagree, they disagree here and not silently
    // in production — which is exactly how zzz672 went wrong.
    const pass = {
      ticker: 'OK', source: 'graded', market_cap_cr: 5000,
      sales_yoy_pct: 30, eps_yoy_pct: 40, pead_score: 55,
      opm_pct: 14, opm_prev_pct: 12, cfo_to_pat_ratio: 1.1, verdict: 'BUY',
    };
    assert.deepEqual(benchPassingPreset(['OK'], { OK: pass }).passed, ['OK']);

    const tooSmall = { ...pass, market_cap_cr: 900 };
    assert.equal(benchPassingPreset(['OK'], { OK: tooSmall }).passed.length, 0);

    const cashLeak = { ...pass, cfo_to_pat_ratio: 0.2 };
    assert.equal(benchPassingPreset(['OK'], { OK: cashLeak }).passed.length, 0);

    const marginDown = { ...pass, opm_pct: 10, opm_prev_pct: 12 };
    assert.equal(benchPassingPreset(['OK'], { OK: marginDown }).passed.length, 0);
  });

  test('a null field passes the preset — absence is not failure', () => {
    // Deliberate: a filing whose cash-flow line has not been parsed yet must
    // still surface. Only market cap and verdict are allowed to be strict.
    const thin = {
      ticker: 'THIN', source: 'graded', market_cap_cr: 4000,
      sales_yoy_pct: null, eps_yoy_pct: null, cfo_to_pat_ratio: null, pledged_pct: null,
    };
    assert.deepEqual(benchPassingPreset(['THIN'], { THIN: thin }).passed, ['THIN']);
  });

  test('exchange suffixes and case never split one company into two rows', () => {
    const u = mergeUniverse(['kmew.ns', 'KMEW'], ['Kmew.BO']);
    assert.equal(u.size, 1);
    assert.equal(u.get('KMEW'), 'both');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCE DISCOVERY — THE RETRIEVAL LAYER.                         (zzz737)
//
// The owner's complaint was exact: "the retrieval/extraction pipeline is
// failing before those slots get populated". These tests pin the three
// behaviours that were wrong, so they cannot quietly return.
// ═══════════════════════════════════════════════════════════════════════════
describe('evidence discovery', () => {
  const filing = (subject: string, url: string, date = '2026-08-14') =>
    ({ symbol: 'KMEW', subject, attachment_url: url, filing_date: date });

  test('an ORDER WIN is kept, not discarded as "not results"', () => {
    // The old ranker dropped every attachment that was not a results filing.
    // An order win is the single most direct piece of demand evidence a
    // company files, and it was being thrown away before anything read it.
    const got = candidatesFromFilings([
      filing('Bagging/Receiving of orders/contracts', 'https://x/order-loa.pdf'),
    ], 'KMEW');
    assert.equal(got.length, 1);
    assert.equal(got[0].kind, 'announcement');
  });

  test('commissioning and capacity announcements are kept too', () => {
    const got = candidatesFromFilings([
      filing('Commencement of commercial production at the new plant', 'https://x/commission.pdf'),
      filing('Capacity expansion update', 'https://x/capex.pdf'),
    ], 'KMEW');
    assert.equal(got.length, 2);
    assert.ok(got.every((c) => c.kind === 'announcement'));
  });

  test('genuine noise is still dropped', () => {
    const got = candidatesFromFilings([
      filing('Newspaper publication of financial results', 'https://x/newspaper.pdf'),
      filing('Trading window closure', 'https://x/tw.pdf'),
      filing('Voting results of the AGM', 'https://x/voting.pdf'),
    ], 'KMEW');
    assert.deepEqual(got, []);
  });

  test('the FILENAME is read, not only the subject', () => {
    // zzz705's lesson: the exchange subject is frequently generic while the
    // filename carries the truth. A generic subject with a voting-results
    // filename must still be dropped.
    const got = candidatesFromFilings([
      filing('Announcement under Regulation 30', 'https://x/DTTS_Voting_Results_signed.pdf'),
    ], 'KMEW');
    assert.deepEqual(got, []);
  });

  test('another company\'s filings are never picked up', () => {
    const got = candidatesFromFilings([
      { symbol: 'SOTL', subject: 'Financial Results', attachment_url: 'https://x/other.pdf', filing_date: '2026-08-14' },
    ], 'KMEW');
    assert.deepEqual(got, []);
  });

  test('a transcript outranks the results PDF', () => {
    // Deliberate, and the reason the structural block was empty: a results
    // PDF states financials and rarely mentions utilisation or order intake.
    const ranked = rankCandidates([
      { url: 'r', kind: 'results', tier: 1, source: 'x', period: null, dateIso: '2026-08-14', label: 'Results' },
      { url: 't', kind: 'transcript', tier: 2, source: 'y', period: null, dateIso: '2026-08-14', label: 'Concall' },
    ], '2026-08-14');
    assert.equal(ranked[0].kind, 'transcript');
  });

  test('selection takes one of each kind before a second of any', () => {
    // Three presentations answer the same questions three times; a
    // transcript plus a presentation plus the results answer three sets.
    const cands: any[] = [
      { url: 'p1', kind: 'investor_presentation', tier: 1, source: 's', period: null, dateIso: '2026-08-01', label: 'PPT 1' },
      { url: 'p2', kind: 'investor_presentation', tier: 1, source: 's', period: null, dateIso: '2026-05-01', label: 'PPT 2' },
      { url: 't1', kind: 'transcript', tier: 2, source: 's', period: null, dateIso: '2026-08-01', label: 'Concall' },
    ];
    const picked = selectForReading(rankCandidates(cands, '2026-08-01'), 2);
    assert.deepEqual(picked.map((p) => p.kind), ['transcript', 'investor_presentation']);
  });

  test('the cap is honoured, and fills with repeats rather than under-reading', () => {
    const cands: any[] = [
      { url: 'a', kind: 'transcript', tier: 2, source: 's', period: null, dateIso: '2026-08-01', label: 'A' },
      { url: 'b', kind: 'transcript', tier: 2, source: 's', period: null, dateIso: '2026-05-01', label: 'B' },
      { url: 'c', kind: 'transcript', tier: 2, source: 's', period: null, dateIso: '2026-02-01', label: 'C' },
    ];
    assert.equal(selectForReading(cands, 3).length, 3);
    assert.equal(selectForReading(cands, 1).length, 1);
  });

  test("'other' documents are never selected for reading", () => {
    // JINDRILL: the only candidate was a shareholders-meeting notice. It was
    // read, cost a model call, and produced 0 passages.
    const cands: any[] = [
      { url: 'o', kind: 'other', tier: 1, source: 's', period: null, dateIso: '2026-08-01', label: 'AGM notice' },
      { url: 't', kind: 'transcript', tier: 2, source: 's', period: null, dateIso: '2026-05-01', label: 'Concall' },
    ];
    assert.deepEqual(selectForReading(cands, 3).map((c) => c.url), ['t']);
    assert.deepEqual(selectForReading([cands[0]], 3), []);
  });

  test('one source erroring with nothing found is RETRIEVAL_FAILED, not SEARCH_EXHAUSTED', () => {
    // The bug zzz738 shipped: the exchange window was read (empty) and
    // screener.in 504'd; the state said "every source was reached".
    const got = resolveDiscovery('E2E', [], [
      { source: 'exchange filing feed', outcome: 'empty', detail: 'rolling window', found: 0 },
      { source: 'screener.in company page', outcome: 'error', detail: 'HTTP 504', found: 0 },
    ]);
    assert.equal(got.state, 'RETRIEVAL_FAILED');
    assert.match(got.summary, /could not be retrieved/);
    assert.match(got.summary, /HTTP 504/);
  });

  test('every source answering with nothing found is SEARCH_EXHAUSTED', () => {
    const got = resolveDiscovery('X', [], [
      { source: 'exchange filing feed', outcome: 'empty', detail: '', found: 0 },
      { source: 'screener.in company page', outcome: 'empty', detail: '', found: 0 },
    ]);
    assert.equal(got.state, 'SEARCH_EXHAUSTED');
    assert.match(got.summary, /absence of disclosure/);
  });

  test("only 'other' documents found is SEARCH_EXHAUSTED and says so", () => {
    const got = resolveDiscovery('JINDRILL', [
      { url: 'o', kind: 'other', tier: 1, source: 's', period: null, dateIso: null, label: 'AGM notice' },
    ], [
      { source: 'exchange filing feed', outcome: 'found', detail: '', found: 1 },
      { source: 'screener.in company page', outcome: 'empty', detail: '', found: 0 },
    ]);
    assert.equal(got.state, 'SEARCH_EXHAUSTED');
    assert.match(got.summary, /none is a transcript/);
    assert.equal(got.candidates.length, 1, 'the notice stays in the trail');
  });

  test('evidence found with one source down is still EVIDENCE_FOUND, flagged partial', () => {
    const got = resolveDiscovery('EXICOM', [
      { url: 't', kind: 'transcript', tier: 2, source: 's', period: null, dateIso: null, label: 'Concall' },
    ], [
      { source: 'exchange filing feed', outcome: 'error', detail: 'feed down', found: 0 },
      { source: 'screener.in company page', outcome: 'found', detail: '', found: 1 },
    ]);
    assert.equal(got.state, 'EVIDENCE_FOUND');
    assert.match(got.summary, /coverage may be partial/);
  });

  test('classification reads intent, not just the word "results"', () => {
    assert.equal(classifyExchangeDoc('Earnings call transcript Q1', 'x.pdf'), 'transcript');
    assert.equal(classifyExchangeDoc('Investor Presentation', 'x.pdf'), 'investor_presentation');
    assert.equal(classifyExchangeDoc('Outcome of Board Meeting', 'x.pdf'), 'results');
    assert.equal(classifyExchangeDoc('Receipt of Letter of Award', 'x.pdf'), 'announcement');
    assert.equal(classifyExchangeDoc('Some notice', 'x.pdf'), 'other');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL EXTRACTION — SEARCH, VALIDATE, LEDGER.                (zzz738)
//
// The fixture is EXICOM's real August 2026 concall. On production the reader
// returned capacity, utilisation and order book EMPTY from this document.
// ═══════════════════════════════════════════════════════════════════════════
describe('structural evidence extraction', () => {
  const transcript = fx('exicom-concall-aug2026.txt');

  test('a chart-axis run is kept but capped at LOW and labelled', () => {
    // E2E's presentation: the utilisation figures were on the slide, but the
    // "sentence" was a run of tick marks. Real numbers, no meaning attached.
    const passages: any[] = [{ family: 'utilisation', text: '61% 75% -10% 10% 30% 50% 70% 90% 0 200 400 600 800 Q1 FY26 Q2 FY26 Q3 FY26', doc: 'ppt' }];
    const { kept } = validateEvents([{
      variable: 'utilisation', value_type: 'ACTUAL', before: '61%', after: '75%', unit: '%', period: 'Q1 FY27',
      direction: 'up', evidence_text: '61% 75% -10% 10% 30% 50% 70% 90% 0 200 400 600 800 Q1 FY26', source: 'ppt', confidence: 'HIGH',
    }], passages);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].confidence, 'LOW');
    assert.equal(kept[0].evidence_quality, 'chart');
    const vars = varsFromEvents(kept);
    assert.equal(vars[0].kind, 'claim', 'a chart read must not be confirmable as a fact');
    assert.match(vars[0].evidence, /Read from a chart/);
  });

  test('passage search finds the utilisation and order-book sentences in the real transcript', () => {
    const p = findPassages(transcript, 'Concall Aug 2026');
    const util = p.filter((x) => x.family === 'utilisation').map((x) => x.text).join(' ');
    const orders = p.filter((x) => x.family === 'orders').map((x) => x.text).join(' ');
    const cap = p.filter((x) => x.family === 'capacity').map((x) => x.text).join(' ');
    assert.match(util, /65%/, 'the DC-charger 65% utilisation sentence must be found');
    assert.match(util, /90% and 100%/, 'the 90-100% utilisation sentence must be found');
    assert.match(orders, /1,000 crores/, 'the INR1,000 crore critical-power order book must be found');
    assert.match(cap, /3x production/, 'the 3x capacity statement must be found');
  });

  test('a sentence with no number is not a passage — tone is not evidence', () => {
    const p = findPassages('Capacity utilisation improved meaningfully during the quarter and we are pleased with the ramp-up trajectory overall.', 'x');
    assert.deepEqual(p, []);
  });

  test('an invented figure is dropped: the number must be in the evidence sentence', () => {
    const passages = [{ family: 'utilisation' as const, doc: 'd', text: 'Overall, capacity utilization, I see on the DC charging to be about 65% because that is heavier machinery.' }];
    const { kept, dropped } = validateEvents([{
      variable: 'utilisation', value_type: 'ACTUAL', before: '52%', after: '65%', unit: '%', period: 'Q1 FY27',
      direction: 'up', confidence: 'HIGH', source: 'd',
      evidence_text: 'Overall, capacity utilization, I see on the DC charging to be about 65% because that is heavier machinery.',
    }], passages);
    assert.equal(kept.length, 0);
    assert.match(dropped[0].reason, /52 does not appear/);
  });

  test('a paraphrased evidence sentence is dropped: it must be verbatim', () => {
    const passages = [{ family: 'utilisation' as const, doc: 'd', text: 'Overall, capacity utilization, I see on the DC charging to be about 65% because that is heavier machinery.' }];
    const { kept, dropped } = validateEvents([{
      variable: 'utilisation', value_type: 'ACTUAL', before: null, after: '65%', unit: '%', period: null,
      direction: 'unknown', confidence: 'HIGH', source: 'd',
      evidence_text: 'DC charging utilisation is around 65% according to management commentary on the call.',
    }], passages);
    assert.equal(kept.length, 0);
    assert.match(dropped[0].reason, /not found in the document/);
  });

  test('a faithful event survives, with curly quotes and a line-break hyphen tolerated', () => {
    const passages = [{ family: 'orders' as const, doc: 'PPT', text: 'Our order book as of today stands at roughly INR1,000 crores in critical power, which gives us long-term visibility.' }];
    const { kept } = validateEvents([{
      variable: 'order_book', value_type: 'ACTUAL', before: null, after: 'INR1,000 crores', unit: 'INR crore', period: 'Aug 2026',
      direction: 'unknown', confidence: 'HIGH', source: 'PPT',
      evidence_text: 'Our order book as of today stands at roughly INR1,000 crores in critical power, which gives us long‑term visibility.',
    }], passages);
    assert.equal(kept.length, 1);
    assert.equal(kept[0].after, 'INR1,000 crores');
  });

  test('a variable outside the schema is refused', () => {
    const passages = [{ family: 'orders' as const, doc: 'd', text: 'Revenue grew 61% to about INR331 crores in the quarter under review.' }];
    const { kept, dropped } = validateEvents([{
      variable: 'revenue_growth', value_type: 'ACTUAL', before: null, after: '61%', unit: '%', period: null,
      direction: 'up', confidence: 'HIGH', source: 'd',
      evidence_text: 'Revenue grew 61% to about INR331 crores in the quarter under review.',
    }], passages);
    assert.equal(kept.length, 0);
    assert.match(dropped[0].reason, /not in schema/);
  });

  test('a TARGET never becomes the actual, and both are shown', () => {
    const events: any[] = [
      { variable: 'utilisation', value_type: 'ACTUAL', before: '72%', after: '84%', unit: '%', period: 'Q1 FY27', direction: 'up', confidence: 'HIGH', source: 'PPT', evidence_text: 'Utilisation increased from 72% to 84% in the quarter.' },
      { variable: 'utilisation', value_type: 'TARGET', before: null, after: '90%', unit: '%', period: 'FY28', direction: 'up', confidence: 'MEDIUM', source: 'Concall', evidence_text: 'We are targeting 90% utilisation by FY28 across the lines.' },
    ];
    const vars = varsFromEvents(events);
    const u = vars.find((v) => v.key === 'utilisation')!;
    assert.equal(u.after, '84%');
    assert.equal(u.delta, '+12pp');
    assert.equal(u.kind, 'fact');
    assert.match(u.evidence, /Target 90%/);
    assert.equal(u.verdict, 'improving');
  });

  test('a target with no actual behind it is a CLAIM, stated and never confirmed', () => {
    const vars = varsFromEvents([
      { variable: 'utilisation', value_type: 'TARGET', before: null, after: '90%', unit: '%', period: 'FY28', direction: 'up', confidence: 'HIGH', source: 'Concall', evidence_text: 'We are targeting 90% utilisation by FY28 across the lines.' },
    ] as any);
    assert.equal(vars[0].kind, 'claim');
    assert.equal(vars[0].verdict, 'stated');
  });

  // ── zzz754: what the live page got wrong on 22 Sept ───────────────────
  test('a management claim never confirms — AZAD "guidance over 25%" is stated, not ▲', () => {
    const vars = varsFromEvents([
      { variable: 'guidance', value_type: 'MANAGEMENT_CLAIM', before: null, after: 'over 25%', unit: '%', period: null, direction: 'up', confidence: 'HIGH', source: 'Concall', evidence_text: 'We continue to expect growth of over 25% for the full year as the new plants ramp up.' },
    ] as any);
    assert.equal(vars[0].verdict, 'stated');
    assert.equal(vars[0].kind, 'claim');
  });

  test('a level with no earlier figure and no move-word is stated — JINDRILL order book is not "flat"', () => {
    const vars = varsFromEvents([
      { variable: 'order_book', value_type: 'ACTUAL', before: null, after: 'INR1,310 crores', unit: 'INR crore', period: null, direction: 'flat', confidence: 'HIGH', source: 'd', evidence_text: 'The order book as of 30 June stands at INR1,310 crores across the four rigs.' },
    ] as any);
    assert.equal(vars[0].verdict, 'stated');
  });

  test('a move named in the sentence is kept — "improved to 80%" is improving', () => {
    const vars = varsFromEvents([
      { variable: 'utilisation', value_type: 'ACTUAL', before: null, after: '80%', unit: '%', period: 'Q1 FY27', direction: 'up', confidence: 'HIGH', source: 'd', evidence_text: 'Capacity utilisation improved to 80% in the quarter across the eight plants.' },
    ] as any);
    assert.equal(vars[0].verdict, 'improving');
  });

  test('more delay is worse — TI "execution delay up" is deteriorating, never ▲', () => {
    const vars = varsFromEvents([
      { variable: 'execution_delay', value_type: 'ACTUAL', before: null, after: '2 quarters', unit: null, period: null, direction: 'up', confidence: 'HIGH', source: 'd', evidence_text: 'The commissioning has been delayed by a further 2 quarters because of the transformer shortage.' },
    ] as any);
    assert.equal(vars[0].verdict, 'deteriorating');
  });

  test('capacity stated in money is a wrong-unit claim — EXICOM "USD100 million" and AZAD "INR150 crores per plant"', () => {
    assert.equal(judgeEventQuality({ variable: 'capacity', before: null, after: 'USD100 million', unit: null, evidence_text: 'Our installed capacity today would be worth about USD100 million of revenue at full utilisation of the lines.' }), 'unit_mismatch');
    assert.equal(judgeEventQuality({ variable: 'capacity', before: null, after: 'INR150 crores to about INR180-odd crores per plant', unit: null, evidence_text: 'Each plant has a revenue capacity of INR150 crores to about INR180-odd crores per plant at full run rate.' }), 'unit_mismatch');
    assert.equal(judgeEventQuality({ variable: 'capacity', before: '42,000', after: '222,000', unit: 'units', evidence_text: 'Installed capacity has gone up from 42,000 units to 222,000 units after the Hyderabad plant.' }), 'sentence');
    assert.equal(judgeEventQuality({ variable: 'capacity_addition', before: null, after: '3,000 MTPA', unit: null, evidence_text: 'The plant has an initial operational capacity of around 3,000 MTPA of esters.' }), 'sentence');
  });

  test('a duration filed as utilisation is a wrong-unit claim — JINDRILL "4 to 6 months"', () => {
    assert.equal(judgeEventQuality({ variable: 'utilisation', before: null, after: '4 to 6 months', unit: null, evidence_text: 'Refurbishment periods of 4 to 6 months mean the rig will not be utilised until the third quarter.' }), 'unit_mismatch');
  });

  test('a denial in a risk field is checked-and-flat, not a deterioration — TI customer loss', () => {
    const vars = extractVariables(null, { customers: { loss: 'No explicit customer losses stated; TSMA transitions in certain states resolved or resolving.' } });
    const v = vars.find((x) => x.key === 'customer_loss');
    assert.equal(v!.verdict, 'flat');
    assert.equal(isDenial('No explicit customer losses stated'), true);
    assert.equal(isDenial('Lost the Vodafone programme in Q1'), false);
  });

  test('a disclosed level from the summary is stated, not absent — utilisation with no prior', () => {
    const vars = extractVariables(null, { utilisation: { current: '65%', prior: 'not stated', expected: 'not stated' } });
    assert.equal(vars.find((x) => x.key === 'utilisation')!.verdict, 'stated');
  });

  test('cross-period deltas need the same unit — MOREPEN "314 kiloliters" vs "200 KLD" is not −36%', () => {
    assert.equal(sameUnit('314 kiloliters', '200 KLD', null, null), false);
    assert.equal(sameUnit('42,000', '222,000', 'units', 'units'), true);
    assert.equal(sameUnit('60%-70%', '80%', '%', null), true);
    assert.equal(sameUnit('9 lakh BP monitors', '18 lakh BP monitors', null, null), true);
  });

  // ── zzz755: the live page on 22 Sept, second pass ─────────────────────
  test('a level-only core variable cannot reach THESIS STRENGTHENING', () => {
    // AETHER's shape: unclassified ledger, core = revenue_growth + cash_conversion.
    const a = assessThesis({ pattern: null, evidenceReviewed: true, variables: [
      { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+27.2%', delta: '+27.2%', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'cash_conversion', label: 'Cash conversion', before: null, after: '2.25×', delta: null, verdict: 'stated', evidence: '', source: 'grader' },
      { key: 'margin', label: 'Operating margin', before: null, after: '+1pp', delta: '+1pp', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'earnings_growth', label: 'Earnings growth', before: null, after: '+33.2%', delta: '+33.2%', verdict: 'improving', evidence: '', source: 'grader' },
    ] as any });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.ok(a.coverage.levelOnlyCore.includes('Cash conversion'));
  });

  test('green is still reachable when every core variable actually moved', () => {
    const a = assessThesis({ pattern: null, evidenceReviewed: true, variables: [
      { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+27.2%', delta: '+27.2%', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'cash_conversion', label: 'Cash conversion', before: null, after: '2.25×', delta: null, verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'margin', label: 'Operating margin', before: null, after: '+3pp', delta: '+3pp', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'earnings_growth', label: 'Earnings growth', before: null, after: '+33.2%', delta: '+33.2%', verdict: 'improving', evidence: '', source: 'grader' },
    ] as any });
    assert.equal(a.status, 'STRENGTHENING');
  });

  test('a mis-filed actual is dropped, not shown as a level — REDINGTON capacity in rupees', () => {
    const vars = varsFromEvents([
      { variable: 'capacity', value_type: 'ACTUAL', before: null, after: '`10,161 crores', unit: null, period: null, direction: 'up', confidence: 'HIGH', source: 'd', evidence_text: 'Revenue for the quarter stood at `10,161 crores across the three geographies we operate in.' },
    ] as any);
    assert.equal(vars.length, 0);
  });

  test('utilisation needs a utilisation sentence — JINDRILL months, DIVGI rupees, VIJAYA hubs', () => {
    const q = (after: string, ev: string) => judgeEventQuality({ variable: 'utilisation', before: null, after, unit: null, evidence_text: ev });
    assert.equal(q('4 to 6 months', 'Refurbishment periods of 4 to 6 months mean the rig cannot be redeployed until Q3.'), 'unit_mismatch');
    assert.equal(q('Rs. 5.7 crores', 'Other income for the quarter was Rs. 5.7 crores against the comparable period.'), 'unit_mismatch');
    assert.equal(q('7 hub centers in Kolkata', 'We now operate 7 hub centers in Kolkata serving the eastern region.'), 'unit_mismatch');
    assert.equal(q('-14%', 'Data centre revenue in Europe declined -14% during the quarter on lower deployments.'), 'unit_mismatch');
    assert.equal(q('13.2%', 'Same-boutique revenue growth was 13.2% for the quarter across the network.'), 'unit_mismatch');
    // Genuine ones survive, including a legitimately low solar CUF.
    assert.equal(q('19.89% CUF', 'The 600 MW solar plant operated at 19.89% CUF during the quarter.'), 'sentence');
    assert.equal(q('65%', 'Capacity utilisation across the Hyderabad lines was 65% for the quarter.'), 'sentence');
    assert.equal(q('almost 100%', 'We are running at almost 100% utilisation on the specialty lines.'), 'sentence');
  });

  test('capacity stated as a bare percentage is mis-filed — GESHIP "About 25-26%"', () => {
    assert.equal(judgeEventQuality({ variable: 'capacity', before: null, after: 'About 25-26%', unit: null, evidence_text: 'Our share of the coastal trade is About 25-26% of the total installed capacity in the country.' }), 'unit_mismatch');
    assert.equal(judgeEventQuality({ variable: 'capacity', before: null, after: '60 million sq. ft.', unit: null, evidence_text: 'Installed capacity now stands at 60 million sq. ft. of laminates per annum.' }), 'sentence');
  });

  test('a forward-only value says so on the board — AARTIPHARM target utilisation', () => {
    const vars = varsFromEvents([
      { variable: 'utilisation', value_type: 'TARGET', before: null, after: '80% plus', unit: '%', period: null, direction: 'up', confidence: 'HIGH', source: 'd', evidence_text: 'We are targeting 80% plus utilisation at Atali once Block 1 stabilises.' },
    ] as any);
    assert.equal(vars[0].after, '80% plus (target)');
  });

  test('the margin delta and the margin verdict come from one number', () => {
    // AETHER: grader says -1pp YoY, the filing bridge says +1pp. The card
    // must never show a red arrow next to a positive figure.
    const v = extractVariables({ opm_pct: 20, opm_prev_pct: 21 }, { margin_bridge: { opm_change_pp: '+1pp' } })
      .find((x) => x.key === 'margin')!;
    assert.equal(v.verdict, 'deteriorating');
    assert.equal(v.delta, '-1.0pp');
    // CUPID / RATEGAIN: "+?pp" is not a number and never reaches the card.
    const junk = extractVariables({ opm_pct: 20, opm_prev_pct: 17 }, { margin_bridge: { opm_change_pp: '+?pp' } })
      .find((x) => x.key === 'margin')!;
    assert.equal(junk.delta, '+3.0pp');
    assert.equal(junk.verdict, 'improving');
  });

  // ── zzz757: "EVIDENCE NOT YET REVIEWED" on 50 cards that HAD been read ──
  const F_VARS = (extra: any[] = []) => ([
    { key: 'earnings_growth', label: 'Earnings growth', before: null, after: '+460.7%', delta: '+460.7%', verdict: 'improving', evidence: '', source: 'grader' },
    { key: 'cash_conversion', label: 'Cash conversion', before: null, after: '3.66×', delta: null, verdict: 'improving', evidence: '', source: 'grader' },
    { key: 'margin_driver', label: 'Margin driver', before: null, after: 'AC-led mix', delta: null, verdict: 'improving', evidence: '', source: 'filing' },
    { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+39.1%', delta: '+39.1%', verdict: 'improving', evidence: '', source: 'grader' },
    ...extra,
  ] as any);

  test('no one-off found in three documents is the forensic test PASSING, not a gap', () => {
    // EMIL / MARKSANS / NEULANDLAB / GNFC shape: F pattern, one_offs core-4,
    // nothing disclosed. Sixteen cards read "Missing: one-offs".
    const a = assessThesis({ pattern: 'F', evidenceReviewed: true, hasGraderRow: true, variables: F_VARS() });
    const oneOffs = a.checked.find((c) => c.key === 'one_offs')!;
    assert.equal(oneOffs.verdict, 'flat');
    assert.equal(oneOffs.absence, null);
    assert.ok(!a.coverage.missingCore.includes('One-offs'));
    assert.match(oneOffs.evidence, /check passing/);
    assert.notEqual(a.status, 'EVIDENCE_INCOMPLETE');
  });

  test('silence only counts as a pass once something was actually read', () => {
    const a = assessThesis({ pattern: 'F', evidenceReviewed: false, hasGraderRow: true, variables: F_VARS() });
    const oneOffs = a.checked.find((c) => c.key === 'one_offs')!;
    assert.equal(oneOffs.verdict, 'unknown');
    assert.equal(a.status, 'EVIDENCE_INCOMPLETE');
  });

  test('a disclosed one-off still contradicts — the pass is absence, not amnesty', () => {
    const a = assessThesis({ pattern: 'F', evidenceReviewed: true, hasGraderRow: true, variables: F_VARS([
      { key: 'one_offs', label: 'One-offs', before: null, after: '1 item', delta: null, verdict: 'deteriorating', evidence: '', source: 'filing' },
    ]) });
    assert.equal(a.checked.find((c) => c.key === 'one_offs')!.verdict, 'deteriorating');
    assert.equal(a.status, 'WEAKENING');
  });

  test('a grader-only variable with no graded row says so — it is not an unread holding', () => {
    // ALKYLAMINE / BETA / CLEANMAX shape: documents read, no screener row, so
    // revenue growth and cash conversion can never arrive from a filing.
    const a = assessThesis({ pattern: null, evidenceReviewed: true, hasGraderRow: false, variables: [
      { key: 'utilisation', label: 'Capacity utilisation', before: null, after: '60-85%', delta: null, verdict: 'stated', evidence: '', source: 'filing' },
    ] as any });
    const rev = a.checked.find((c) => c.key === 'revenue_growth')!;
    assert.equal(rev.absence, 'no_grader_row');
    assert.equal(a.status, 'EVIDENCE_INCOMPLETE');
    assert.match(a.because, /no graded or screener row/);
    assert.match(a.because, /results filing that states them/);
    assert.doesNotMatch(a.because, /not yet been reviewed/);
  });

  test('read, and the company said nothing — that is CONFIRMATION REQUIRED, not "not yet reviewed"', () => {
    // GESHIP / AVALON / REDINGTON shape: A pattern, utilisation never
    // disclosed, everything else good.
    const a = assessThesis({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: [
      { key: 'operating_leverage', label: 'Operating leverage', before: null, after: '2.4×', delta: '2.4×', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'margin', label: 'Operating margin', before: null, after: '+13.0pp', delta: '+13.0pp', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+66.9%', delta: '+66.9%', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'margin_driver', label: 'Margin driver', before: null, after: 'spot freight', delta: null, verdict: 'improving', evidence: '', source: 'filing' },
    ] as any });
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.match(a.because, /disclose nothing about capacity utilisation/);
    assert.equal(a.checked.find((c) => c.key === 'utilisation')!.absence, 'not_disclosed');
  });

  test('"nothing has been read" is never printed over a card that read documents', () => {
    // JAMNAAUTO: header said "3 documents read · 8 facts", body said nothing
    // had been read.
    const a = assessThesis({ pattern: null, evidenceReviewed: true, hasGraderRow: false, variables: [] });
    assert.doesNotMatch(a.because, /Nothing has been read/);
    const unread = assessThesis({ pattern: null, evidenceReviewed: false, hasGraderRow: false, variables: [] });
    assert.match(unread.because, /Nothing has been read/);
  });

  test('a stated chip always carries a value — never an empty ◐', () => {
    const vars = extractVariables(null, { utilisation: { current: '', prior: 'not stated', expected: '80%' } });
    const u = vars.find((x) => x.key === 'utilisation');
    if (u) assert.notEqual(u.verdict, 'stated');
  });

  test('the tally adds up — stated and flat are counted, not dropped', () => {
    const a = assessThesis({ pattern: null, evidenceReviewed: true, variables: [
      { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+8%', delta: '+8%', verdict: 'flat', evidence: '', source: 'grader' },
      { key: 'earnings_growth', label: 'Earnings growth', before: null, after: '-28%', delta: '-28%', verdict: 'deteriorating', evidence: '', source: 'grader' },
      { key: 'order_book', label: 'Order book', before: null, after: 'INR1,310 crores', delta: null, verdict: 'stated', evidence: '', source: 'filing' },
    ] as any });
    for (const t of [a.coverage.output, a.coverage.mechanism, a.coverage.forward]) {
      assert.equal(t.confirmed + t.pending + t.contradicted + t.stated + t.flat, t.total);
    }
    // A stated core variable is disclosed: it must not be listed as missing.
    assert.ok(!a.coverage.missingCore.includes('Order book'));
  });

  test('a delta is never derived when the prior value is missing', () => {
    const vars = varsFromEvents([
      { variable: 'order_book', value_type: 'ACTUAL', before: null, after: 'INR1,000 crores', unit: 'INR crore', period: null, direction: 'unknown', confidence: 'HIGH', source: 'd', evidence_text: 'Our order book as of today stands at roughly INR1,000 crores in critical power.' },
    ] as any);
    assert.equal(vars[0].delta, null);
    assert.equal(vars[0].before, null);
  });

  test('a typed event beats the summary loose field for the same variable', () => {
    const g = row('KMEW');
    const summary = {
      utilisation: { current: '70%', prior: '60%' },
      events: [{ variable: 'utilisation', value_type: 'ACTUAL', before: '72%', after: '84%', unit: '%', period: 'Q1 FY27', direction: 'up', confidence: 'HIGH', source: 'PPT', evidence_text: 'Utilisation increased from 72% to 84% in the quarter.' }],
    };
    const vars = extractVariables(g, summary);
    const u = vars.filter((v) => v.key === 'utilisation');
    assert.equal(u.length, 1, 'one row per variable');
    assert.equal(u[0].after, '84%');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// OUTPUT ≠ MECHANISM, AND A WARNING IS NOT A VERDICT.              (zzz738)
// ═══════════════════════════════════════════════════════════════════════════
describe('status: output is not mechanism', () => {
  const assess = (ticker: string, opts: any = {}) => {
    const g = { ...row(ticker), ...(opts.graded || {}) };
    return assessThesis({
      pattern: opts.pattern === undefined ? (classifyGradedRow(g)?.pattern ?? null) : opts.pattern,
      variables: extractVariables(g, opts.summary ?? null),
      promiseGap: null,
      evidenceReviewed: opts.evidenceReviewed ?? false,
    });
  };

  test('financial outputs alone produce ZERO mechanism confirmations', () => {
    // AARTIPHARM's case: revenue, margin, earnings and cash all up, nothing read.
    const a = assess('HAPPYFORGE');
    assert.ok(a.coverage.output.confirmed >= 2, 'the outputs are confirmed');
    assert.equal(a.coverage.mechanism.confirmed, 0, 'no mechanism variable may read as confirmed from grader data');
  });

  test('an UNCLASSIFIED holding with cash conversion down and nothing read is NOT weakening', () => {
    // EXICOM's case: "THESIS WEAKENING" from cash conversion 0.32× with no
    // document read and no thesis on file. The figure is a financial warning.
    const a = assess('HAPPYFORGE', { pattern: null, graded: { cfo_to_pat_ratio: 0.32 }, evidenceReviewed: false });
    assert.notEqual(a.status, 'WEAKENING');
    assert.notEqual(a.status, 'BROKEN');
    assert.ok(a.financialWarning.some((w) => /cash conversion/i.test(w.label)), 'the warning is still shown');
  });

  test('the same deterioration DOES weaken an F thesis — cash conversion is its forensic test', () => {
    const a = assess('SOTL', { evidenceReviewed: false });
    assert.equal(classifyGradedRow(row('SOTL'))?.pattern, 'F');
    assert.equal(a.status, 'WEAKENING');
    assert.equal(a.financialWarning.length, 0, 'for F it is thesis-critical, so it is not a side warning');
  });

  test('once a document has been read, an unclassified ledger may weaken on the same figure', () => {
    const a = assess('HAPPYFORGE', { pattern: null, graded: { cfo_to_pat_ratio: 0.32 }, evidenceReviewed: true, summary: { positives: [] } });
    assert.ok(a.status === 'WEAKENING' || a.status === 'CONFIRMATION_REQUIRED' || a.status === 'EVIDENCE_INCOMPLETE');
    assert.equal(a.financialWarning.length, 0);
  });

  test('the three tallies partition the thesis-critical set', () => {
    const a = assess('KMEW');
    const sum = a.coverage.output.total + a.coverage.mechanism.total + a.coverage.forward.total;
    assert.equal(sum, a.coverage.criticalTotal);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('evidence ledger — persistence, history, idempotency', () => {
  const now = '2026-09-21T10:00:00.000Z';
  const doc = (url: string, label: string, kind: string, date: string): any =>
    ({ id: documentId(url), url, label, kind, source: 'screener.in company page', period: null, date_iso: date, outcome: 'read', chars: 40000, pages: 20 });
  const ev = (variable: string, value_type: string, before: string | null, after: string, unit: string | null, source: string, direction = 'up', confidence = 'HIGH'): any =>
    ({ variable, value_type, before, after, unit, period: null, direction, evidence_text: `${variable} moved from ${before ?? '-'} to ${after} in the quarter, management said.`, source, confidence });

  // E2E-like Q1 FY27: the exact facts the owner listed as "must persist".
  const q1Docs = [doc('https://x/e2e-q1-ppt.pdf', 'Investor presentation Jul 2026', 'investor_presentation', '2026-07-24'),
    doc('https://x/e2e-q1-concall.pdf', 'Concall transcript Jul 2026', 'transcript', '2026-07-25')];
  const q1Events = [
    ev('utilisation', 'ACTUAL', '61%', '75%', '%', 'Investor presentation Jul 2026'),
    ev('volume', 'MANAGEMENT_CLAIM', null, 'major growth driver', null, 'Concall transcript Jul 2026'),
    ev('capacity_addition', 'ACTUAL', null, '1,024 B200 GPUs', 'GPUs', 'Concall transcript Jul 2026'),
    ev('margin_driver', 'MANAGEMENT_CLAIM', null, 'increased utilisation of the existing fleet', null, 'Concall transcript Jul 2026'),
    ev('one_offs', 'ACTUAL', null, '1 item', null, 'Concall transcript Jul 2026', 'flat'),
    ev('guidance', 'GUIDANCE', null, '1024+ B200 planned', 'GPUs', 'Investor presentation Jul 2026'),
  ];
  const q1Summary = { events: q1Events, utilisation: { prior: '61%', current: '75%' }, headline: 'Q1 FY27' };

  const buildPeriod = (ticker: string, docs: any[], events: any[], summary: any, runId: string) => {
    const rp = reportingPeriodForDocuments(docs);
    const { facts, events: evs } = factsFromEvents(ticker, rp.period, events, docs, now);
    const period: any = {
      reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date,
      documents: docs, documents_found: docs.length, documents_read: docs.length, documents_failed: 0, documents_skipped: 0,
      facts, events: evs, summary, status: null, status_because: null, tallies: null,
      discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: runId, prompt_version: 'v8', model: 'm',
      extracted_at: now, updated_at: now,
    };
    const run: any = { run_id: runId, reporting_period: rp.period, started_at: now, finished_at: now, outcome: 'COMPLETED', error: null,
      documents_found: docs.length, documents_read: docs.length, facts_extracted: facts.length, events_extracted: evs.length, model: 'm', prompt_version: 'v8', raw_extraction_json: { events } };
    return { period, run };
  };

  test('reporting period is the last quarter that ended before the document date', () => {
    assert.equal(reportingPeriodFromDate('2026-07-24')?.period, 'Q1 FY27');
    assert.equal(reportingPeriodFromDate('2026-07-24')?.period_end, '2026-06-30');
    assert.equal(reportingPeriodFromDate('2026-05-20')?.period, 'Q4 FY26');
    assert.equal(reportingPeriodFromDate('2026-11-02')?.period, 'Q2 FY27');
    assert.equal(reportingPeriodFromDate('2027-02-10')?.period, 'Q3 FY27');
    assert.equal(reportingPeriodFromDate(null), null);
    assert.ok(periodOrdinal('Q1 FY27') > periodOrdinal('Q4 FY26'));
  });

  test('§32 — evidence survives destroy/recreate of application state', () => {
    const { period, run } = buildPeriod('E2E', q1Docs, q1Events, q1Summary, 'run1');
    let ledger = mergePeriod(emptyLedger('E2E', 'IN', now), period, run);
    ledger = recordStatus(ledger, 'Q1 FY27', 'THESIS_WEAKENING', 'cash conversion -7.84×',
      { mechanism: { confirmed: 1, pending: 1, contradicted: 0, total: 3 }, output: { confirmed: 2, pending: 0, contradicted: 1, total: 3 }, forward: { confirmed: 0, pending: 1, contradicted: 0, total: 1 } }, now);

    // "Reload": everything React held is gone; only the serialised store remains.
    const reloaded: CompanyLedger = JSON.parse(JSON.stringify(ledger));
    const stored = latestSummary(reloaded);
    assert.ok(stored, 'the latest period must be loadable');
    assert.equal(stored!.period.reporting_period, 'Q1 FY27');
    assert.equal(stored!.period.documents_read, 2);
    const metrics = stored!.period.facts.map((f) => f.metric_name).sort();
    assert.deepEqual(metrics, ['capacity_addition', 'guidance', 'margin_driver', 'one_offs', 'utilisation', 'volume']);
    const ut = stored!.period.facts.find((f) => f.metric_name === 'utilisation')!;
    assert.equal(ut.before_value, '61%'); assert.equal(ut.after_value, '75%'); assert.equal(ut.delta, '+14pp');
    assert.equal(ut.evidence_type, 'mechanism');
    assert.equal(ut.fact_or_management_statement, 'FACT');
    assert.equal(ut.source_name, 'Investor presentation Jul 2026');
    assert.equal(ut.source_date, '2026-07-24');
    assert.equal(ut.source_type, 'investor_presentation');
    assert.ok(ut.source_quote.length > 20, 'verbatim quote persisted');
    assert.equal(stored!.period.status, 'THESIS_WEAKENING');
    assert.equal(stored!.period.tallies!.mechanism.confirmed, 1);
    assert.equal(stored!.period.tallies!.output.contradicted, 1);
    assert.equal(reloaded.status_history.length, 1);
    assert.equal(reloaded.runs[0].raw_extraction_json.events.length, 6, 'raw model output kept for audit');
    // the summary the card renders is the same object that was read
    assert.equal(stored!.summary.utilisation.current, '75%');
    // and the view sent to the page drops the raw output
    assert.equal(ledgerView(reloaded).runs[0].raw_extraction_json, undefined);
    assert.equal(freshnessOf(reloaded).state, 'CURRENT');
  });

  test('§33 — Q2 is added, Q1 is untouched, what-changed is computed from facts', () => {
    const q1 = buildPeriod('CAPX', [doc('https://x/q1.pdf', 'Concall Jul 2026', 'transcript', '2026-07-20')],
      [ev('capacity', 'ACTUAL', null, '100', 'MW', 'Concall Jul 2026', 'flat'), ev('utilisation', 'ACTUAL', null, '70%', '%', 'Concall Jul 2026', 'flat')], {}, 'r1');
    let ledger = mergePeriod(emptyLedger('CAPX', 'IN', now), q1.period, q1.run);
    const q2 = buildPeriod('CAPX', [doc('https://x/q2.pdf', 'Concall Oct 2026', 'transcript', '2026-10-25')],
      [ev('capacity', 'ACTUAL', null, '125', 'MW', 'Concall Oct 2026'), ev('utilisation', 'ACTUAL', null, '82%', '%', 'Concall Oct 2026')], {}, 'r2');
    ledger = mergePeriod(ledger, q2.period, { ...q2.run, finished_at: '2026-10-26T00:00:00.000Z' });
    assert.deepEqual(Object.keys(ledger.periods).sort(), ['Q1 FY27', 'Q2 FY27']);
    assert.equal(ledger.latest_period, 'Q2 FY27');
    assert.equal(ledger.periods['Q1 FY27'].facts.find((f) => f.metric_name === 'capacity')!.value, '100', 'Q1 unchanged');
    assert.equal(ledger.periods['Q2 FY27'].facts.find((f) => f.metric_name === 'capacity')!.value, '125');
    const ch = whatChanged(ledger);
    assert.equal(ch.from, 'Q1 FY27'); assert.equal(ch.to, 'Q2 FY27');
    const cap = ch.lines.find((l) => l.metric === 'capacity')!;
    assert.match(cap.text, /100 → 125 \(\+25%\)/);
    const ut = ch.lines.find((l) => l.metric === 'utilisation')!;
    assert.match(ut.text, /70% → 82% \(\+12pp\)/);
  });

  test('§34 — the same period processed twice creates no duplicates', () => {
    const a = buildPeriod('E2E', q1Docs, q1Events, q1Summary, 'run1');
    let ledger = mergePeriod(emptyLedger('E2E', 'IN', now), a.period, a.run);
    const b = buildPeriod('E2E', q1Docs, q1Events, q1Summary, 'run2');
    const later = '2026-09-22T10:00:00.000Z';
    ledger = mergePeriod(ledger, { ...b.period, extracted_at: later, updated_at: later }, { ...b.run, finished_at: later });
    const p = ledger.periods['Q1 FY27'];
    assert.equal(p.facts.length, 6, 'facts not doubled');
    assert.equal(p.events.length, 6, 'events not doubled');
    assert.equal(p.documents.length, 2);
    assert.equal(p.extracted_at, now, 'first extraction time kept');
    assert.equal(p.updated_at, later, 'update time moved');
    assert.equal(ledger.runs.length, 2, 'both runs logged');
    assert.equal(Object.keys(ledger.periods).length, 1);
  });

  test('a failed attempt is recorded without erasing evidence', () => {
    const { period, run } = buildPeriod('E2E', q1Docs, q1Events, q1Summary, 'run1');
    let ledger = mergePeriod(emptyLedger('E2E', 'IN', now), period, run);
    ledger = recordAttempt(ledger, { run_id: 'run9', reporting_period: null, started_at: '2026-09-25T00:00:00.000Z', finished_at: '2026-09-25T00:00:01.000Z', outcome: 'SOURCE_UNAVAILABLE', error: 'screener.in HTTP 504', documents_found: 0, documents_read: 0, facts_extracted: 0, events_extracted: 0, model: null, prompt_version: null });
    assert.equal(ledger.latest_period, 'Q1 FY27', 'evidence kept');
    assert.equal(freshnessOf(ledger).state, 'SOURCE_UNAVAILABLE');
    assert.match(freshnessOf(ledger).detail, /504/);
    // and a never-read company whose source failed is SOURCE UNAVAILABLE, not NEVER READ
    const bare = recordAttempt(emptyLedger('SOTL', 'IN', now), { run_id: 'r', reporting_period: null, started_at: now, finished_at: now, outcome: 'SOURCE_UNAVAILABLE', error: '32 documents found but none could be read', documents_found: 32, documents_read: 0, facts_extracted: 0, events_extracted: 0, model: null, prompt_version: null });
    assert.equal(freshnessOf(bare).state, 'SOURCE_UNAVAILABLE');
    assert.equal(freshnessOf(null).state, 'NEVER_READ');
  });

  test('a newer document seen at a source flips freshness to NEW EVIDENCE AVAILABLE', () => {
    const { period, run } = buildPeriod('E2E', q1Docs, q1Events, q1Summary, 'run1');
    let ledger = mergePeriod(emptyLedger('E2E', 'IN', now), period, run);
    assert.equal(freshnessOf(ledger).state, 'CURRENT');
    ledger = recordSeen(ledger, '2026-10-28', '2026-10-29T00:00:00.000Z');
    assert.equal(ledger.newest_seen_period, 'Q2 FY27');
    assert.equal(freshnessOf(ledger).state, 'NEW_EVIDENCE_AVAILABLE');
  });

  test('§36 — partial batch progress is derived from the ledgers after a reload', () => {
    const started = '2026-09-21T09:00:00.000Z';
    const mk = (t: string, outcome: any, at: string) => recordAttempt(emptyLedger(t, 'IN', now), { run_id: 'r' + t, reporting_period: null, started_at: at, finished_at: at, outcome, error: outcome === 'FAILED' ? 'model error' : null, documents_found: 0, documents_read: 0, facts_extracted: 0, events_extracted: 0, model: null, prompt_version: null });
    const ledgers: Record<string, any> = {
      A: mk('A', 'COMPLETED', '2026-09-21T09:01:00.000Z'),
      B: mk('B', 'COMPLETED', '2026-09-21T09:02:00.000Z'),
      C: mk('C', 'FAILED', '2026-09-21T09:03:00.000Z'),
      D: mk('D', 'COMPLETED', '2026-09-21T09:04:00.000Z'),
      E: mk('E', 'COMPLETED', '2026-09-20T09:04:00.000Z'),   // an OLD run, before this batch
    };
    const p = batchProgress({ started_at: started, tickers: ['A', 'B', 'C', 'D', 'E'] }, JSON.parse(JSON.stringify(ledgers)));
    assert.equal(p.done, 3); assert.equal(p.failed, 1); assert.equal(p.remaining, 1);
    assert.deepEqual(p.failed_tickers, ['C']); assert.deepEqual(p.remaining_tickers, ['E']);
  });
});


// ═══════════════════════════════════════════════════════════════════════════
describe('catalyst research — the brief\'s method as code', () => {
  const html = fx('screener-company-kmew.html');
  const now = new Date('2026-09-21T18:00:00Z');
  const anns = parseAnnouncements(html, now);
  const series = parseChart(JSON.parse(fx('screener-chart-kmew.json')));
  const ann = (subject: string, summary: string | null, ageDays: number): any => ({ subject, summary, url: `https://x/${ageDays}.pdf`, dateIso: new Date(now.getTime() - ageDays * 86_400_000).toISOString(), ageDays });

  test('company page yields id, market cap, price and dated announcements', () => {
    assert.equal(parseCompanyId(html), '1274846');
    assert.equal(parseTopRatios(html).marketCapCr, 7298);
    assert.equal(parseTopRatios(html).price, 2879);
    assert.equal(anns.length, 5);
    assert.equal(anns[1].dateIso, '2026-09-19T22:41:24+05:30');
    assert.match(anns[1].summary || '', /279\.33 crore/);
  });

  test('the ajax fragment parses the same list', () => {
    const frag = fx('screener-announcements-kmew.html');
    assert.equal(parseAnnouncements(frag, now).length, 5);
  });

  test('an order win is a catalyst with its stated value; AGM paperwork is routine even when the summary names ₹500 Cr', () => {
    const c = anns.map((a) => classifyAnnouncement(a));
    assert.equal(c[1].kind, 'catalyst'); assert.equal(c[1].category, 'order_win'); assert.equal(c[1].valueStated, 279.33); assert.equal(c[1].stage, 'executed');
    assert.equal(c[4].kind, 'routine', 'an AGM notice is an AGM notice');
    assert.equal(c[0].category, 'rating_action'); assert.equal(c[0].valueStated, null, 'a rated facility size is not an event value');
  });

  test('denials, negatives, enabling and scheduled items are told apart', () => {
    assert.equal(classifyAnnouncement(ann('Clarification on spurt in volume', 'The company is not aware of any information that has not been announced', 1)).kind, 'denial');
    assert.equal(classifyAnnouncement(ann('Resignation of Statutory Auditor', null, 2)).kind, 'negative');
    assert.equal(classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Update', 'IiAS recommends voting AGAINST four resolutions including reappointment of MD', 0)).kind, 'negative');
    const en = classifyAnnouncement(ann('Intimation of Board Meeting', 'Board meeting to consider fund raising by way of preferential issue', 3));
    assert.equal(en.kind, 'routine', 'a board-meeting intimation is paperwork until the outcome');
    const sch = classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Updates', 'The 2.2 GW plant is expected to be commissioned by Q3 FY27', 2));
    assert.ok(sch.category === 'capacity_expansion' || sch.category === 'production_ramp'); assert.equal(sch.stage, 'scheduled', 'dated in the future is SCHEDULED, not executed');
    const ex = classifyAnnouncement(ann('Press Release', 'The company has commenced commercial production at its sixth plant', 2));
    assert.equal(ex.category, 'production_ramp'); assert.equal(ex.stage, 'executed');
    const cert = classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Updates', 'Received AS9100D certification for aerospace quality management', 1));
    assert.equal(cert.category, 'product_qualification');
  });

  test('stated values parse in crore, lakh and USD', () => {
    assert.equal(parseStatedValue('order worth ₹1,370 crore', 'IN'), 1370);
    assert.equal(parseStatedValue('Rs. 126 Cr contract', 'IN'), 126);
    assert.equal(parseStatedValue('USD 3.22 million export order', 'IN'), 3.22 * 8.5);
    assert.equal(parseStatedValue('$135 million agreement', 'US'), 135);
    assert.equal(parseStatedValue('nothing here', 'IN'), null);
  });

  test('returns and band prints', () => {
    const r = returnsFromSeries(series);
    assert.equal(r.history, 247);
    assert.ok(r.y1 != null && r.y1 > 100, 'a year of closes yields a 1Y return');
    assert.equal(pricedInOf(r), 60);
    assert.deepEqual(bandPrint(20.0, 5.5, 'IN'), { band: true, level: 20 });
    assert.deepEqual(bandPrint(19.99, 2.1, 'IN'), { band: true, level: 20 });
    assert.deepEqual(bandPrint(4.99, 110, 'IN'), { band: false, level: null }, 'a 5% move on ₹110 Cr is not a band print');
    assert.deepEqual(bandPrint(4.99, 3, 'IN'), { band: true, level: 5 });
    assert.deepEqual(bandPrint(20, 5, 'US'), { band: false, level: null });
  });

  test('the finding picks the highest-scoring filing and prints why', () => {
    const f = buildFinding({ ticker: 'KMEW', company: 'Knowledge Marine', market: 'IN', movePct: 4.1, marketCap: 7298, turnover: 12, announcements: anns, returns: returnsFromSeries(series), holding: false, sources: ['screener.in'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'catalyst'); assert.equal(f.category, 'order_win');
    assert.equal(f.valueStated, 279.33); assert.equal(f.valuePctMcap, 3.83);
    assert.equal(f.verdict, 'PRICED', 'up 23% 3M / 127% 1Y — largely priced');
    assert.ok(f.notes.some((n) => /not model-read/.test(n)));
  });

  test('materiality gate: under 1% of market cap cannot rank above THIN', () => {
    const c = classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Award_of_Order_Receipt_of_Order', 'Order worth ₹33 crore received', 0));
    const s = scoreCatalyst(c, { marketCap: 5000, returns: { m1: -10, m3: -20, m6: -30, y1: -40, history: 247 }, sourceTier: 'primary', verifiedQuote: true });
    assert.equal(s.verdict, 'THIN'); assert.ok(s.net <= 17);
  });

  test('a 100%-priced catalyst scores zero even when primary and fresh', () => {
    const c = classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Acquisition', 'Acquisition of control worth ₹1,500 crore', 1));
    const s = scoreCatalyst(c, { marketCap: 5000, returns: { m1: 109, m3: 150, m6: 200, y1: 300, history: 247 }, sourceTier: 'primary', verifiedQuote: true });
    assert.equal(s.net, 0); assert.equal(s.verdict, 'NONE');
  });

  test('reject-first: a denial after the last catalyst is the finding; a catalyst filed after the denial is not', () => {
    // INDORAMA: denial 11 days ago, the only "catalyst" older still → denied.
    const f = buildFinding({ ticker: 'INDORAMA', company: null, market: 'IN', movePct: 17, marketCap: 2000, turnover: 40, announcements: [ann('Clarification on price movement', 'The movement is market driven; there is no undisclosed price sensitive information', 11), ann('Announcement under Regulation 30 (LODR)-Award_of_Order', 'Order worth ₹40 crore', 15)], returns: { m1: 40, m3: 120, m6: 223, y1: 250, history: 247 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'denied');
    assert.match(f.headline || '', /no undisclosed information/);
    // TEGA: denial on the 18th for the 17th's spike, ₹126 Cr contract filed later on the 18th → the contract is the finding, the denial a note.
    const g = buildFinding({ ticker: 'TEGA', company: null, market: 'IN', movePct: 9.6, marketCap: 15978, turnover: 200, announcements: [ann('Clarification sought for increase in volume by BSE', 'Tega says no undisclosed price-sensitive information is pending', 3), { ...ann('Announcement pursuant to Reg. 30', 'Tega McNally Minerals won a Rs 126 crore domestic contract from Kalpataru Projects', 3), dateIso: new Date(now.getTime() - 3 * 86_400_000 + 3600_000).toISOString() }], returns: { m1: 20, m3: 21, m6: 30, y1: 40, history: 247 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(g.status, 'catalyst'); assert.equal(g.category, 'order_win');
    assert.equal(g.verdict, 'THIN', '₹126 Cr on ₹15,978 Cr is 0.79% of market cap');
    assert.ok(g.notes.some((n) => /denied any undisclosed information/.test(n)));
  });

  test('routine-only, none, listing artifact and source-failed are explicit findings', () => {
    const routine = buildFinding({ ticker: 'A', company: null, market: 'IN', movePct: 8, marketCap: 800, turnover: 2, announcements: [ann('Notice of AGM', null, 5), ann('Announcement under Regulation 30 (LODR)-Newspaper Publication', null, 6)], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(routine.status, 'routine_only'); assert.equal(routine.filingsInWindow, 2);
    const none = buildFinding({ ticker: 'B', company: null, market: 'IN', movePct: 9.4, marketCap: 800, turnover: 2, announcements: [ann('Old order', 'Order worth ₹200 crore', 60)], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(none.status, 'none', 'a 60-day-old filing is outside the window');
    const listing = buildFinding({ ticker: 'GAJA', company: null, market: 'IN', movePct: 14.2, marketCap: 900, turnover: 30, announcements: [], returns: { m1: null, m3: null, m6: null, y1: null, history: 26 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(listing.status, 'listing_artifact'); assert.equal(listing.listingDays, 26);
    const failed = buildFinding({ ticker: 'C', company: null, market: 'IN', movePct: 5, marketCap: null, turnover: null, announcements: [], returns: null, holding: false, sources: [], sourceFailed: true, windowDays: 21, now });
    assert.equal(failed.status, 'source_failed');
    const band = buildFinding({ ticker: 'PROTEAN', company: null, market: 'IN', movePct: 20.0, marketCap: 2401, turnover: 110, announcements: [], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(band.bandPrint, true); assert.equal(band.bandLevel, 20); assert.equal(band.status, 'none');
  });

  test('coverage is a fraction over the universe, not over what was found', () => {
    const f = buildFinding({ ticker: 'A', company: null, market: 'IN', movePct: 5, marketCap: 1, turnover: 1, announcements: [], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    const cov = coverage({ A: f }, ['A', 'B', 'C']);
    assert.equal(cov.researched, 1); assert.equal(cov.total, 3); assert.equal(cov.pct, 33); assert.equal(cov.byStatus.unresearched, 2);
  });
});

describe('zzz746 — extraction unit sanity and inferred values', () => {
  test('a percentage variable with a bare count is a claim, never a fact', () => {
    const passages: any[] = [{ family: 'utilisation', text: 'Our team grew from 160 to 374 people while utilisation stayed high.', doc: 'ar' }];
    const { kept } = validateEvents([{ variable: 'utilisation', value_type: 'ACTUAL', before: '160', after: '374', unit: null, period: 'FY26', direction: 'up', evidence_text: 'Our team grew from 160 to 374 people while utilisation stayed high.', source: 'ar', confidence: 'HIGH' }], passages);
    assert.equal(kept.length, 1); assert.equal(kept[0].evidence_quality, 'unit_mismatch'); assert.equal(kept[0].confidence, 'LOW');
    // zzz755: a value that is not about this variable is no longer rendered
    // as the variable's value at all — it stays in the ledger for audit and
    // the card shows the variable as undisclosed.
    assert.equal(varsFromEvents(kept).length, 0);
  });
  test('an execution delay needs the passage to say delay', () => {
    const passages: any[] = [{ family: 'execution', text: 'We achieved 90% of the planned rollout in the quarter as scheduled.', doc: 't' }];
    const { kept } = validateEvents([{ variable: 'execution_delay', value_type: 'ACTUAL', before: null, after: '90%', unit: '%', period: 'Q1 FY27', direction: 'up', evidence_text: 'We achieved 90% of the planned rollout in the quarter as scheduled.', source: 't', confidence: 'HIGH' }], passages);
    assert.equal(kept[0].evidence_quality, 'unit_mismatch');
  });
  test('an implied or estimated figure is not a stated event value', () => {
    assert.equal(parseStatedValue('wins LoA for 150 MW BESS, implying ₹42.84 crore annual revenue', 'IN'), null);
    assert.equal(parseStatedValue('non-binding MoU, estimating ₹500 crore opportunity', 'IN'), null);
    assert.equal(parseStatedValue('won an order worth ₹279.33 crore', 'IN'), 279.33);
  });
  test('"won a Rs. 5.12 crore" is an order even without the word order nearby', () => {
    const c = classifyAnnouncement({ subject: 'Announcement under Regulation 30 (LODR)-Updates', summary: 'Silver Touch won a Rs. 5.12 crore project from the Gujarat government for IT services', url: 'u', dateIso: '2026-09-11T00:00:00Z', ageDays: 10 });
    assert.equal(c.category, 'order_win'); assert.equal(c.valueStated, 5.12);
  });
});

// ── zzz747: the Anthropic meter ──────────────────────────────────────────
import { costOf, pricingFor, applyCall, mergeLedgers, emptyLedger as emptySpend } from '../anthropic-meter';

describe('anthropic meter (zzz747)', () => {
  test('prices Haiku 4.5 from the usage block, including cache tokens', () => {
    assert.ok(pricingFor('claude-haiku-4-5-20251001'));
    assert.equal(pricingFor('gpt-x'), null);
    const usd = costOf('claude-haiku-4-5-20251001', { input_tokens: 10_000, output_tokens: 1_000 });
    assert.equal(Number(usd.toFixed(6)), 0.015);               // 10k×$1 + 1k×$5 per M
    const cached = costOf('claude-haiku-4-5-20251001', { input_tokens: 0, cache_read_input_tokens: 10_000, output_tokens: 0 });
    assert.equal(Number(cached.toFixed(6)), 0.001);
    assert.equal(costOf('unknown-model', { input_tokens: 5 }), 0);
    assert.equal(costOf('claude-haiku-4-5-20251001', null), 0);
  });
  test('a ledger folds calls per feature and a blocked call costs nothing', () => {
    let l = emptySpend('2026-09');
    l = applyCall(l, 'gainers-read', 0.01, { input_tokens: 6000, output_tokens: 800 }, '2026-09-21T00:00:00Z');
    l = applyCall(l, 'gainers-read', 0.02, { input_tokens: 12000, output_tokens: 800 }, '2026-09-21T00:01:00Z');
    l = applyCall(l, 'ai-desk', 0, null, '2026-09-21T00:02:00Z', true);
    assert.equal(l.calls, 2); assert.equal(l.blocked, 1);
    assert.equal(Number(l.total_usd.toFixed(6)), 0.03);
    assert.equal(l.by_feature['gainers-read'].input_tokens, 18000);
    assert.equal(l.by_feature['ai-desk'].calls, 0); assert.equal(l.by_feature['ai-desk'].blocked, 1);
  });
  test('shards merge into one month total', () => {
    const a = applyCall(emptySpend('2026-09'), 'x', 1, { input_tokens: 1 }, '2026-09-01T00:00:00Z');
    const b = applyCall(emptySpend('2026-09'), 'x', 2, { input_tokens: 1 }, '2026-09-02T00:00:00Z');
    const m = mergeLedgers('2026-09', [a, null, b]);
    assert.equal(m.total_usd, 3); assert.equal(m.calls, 2); assert.equal(m.by_feature.x.usd, 3);
    assert.equal(m.updated_at, '2026-09-02T00:00:00Z');
  });
});

// ── zzz748: upcoming board meetings from two exchanges ───────────────────
import { toNseDate, bseShortToSymbol, normaliseNse, normaliseBse, mergeMeetings } from '../earnings/upcoming-meetings';

describe('upcoming board meetings (zzz748)', () => {
  test('every date shape both exchanges emit normalises to DD-MMM-YYYY', () => {
    assert.equal(toNseDate('12 Oct 2026'), '12-Oct-2026');
    assert.equal(toNseDate('23-Oct-2026'), '23-Oct-2026');
    assert.equal(toNseDate('2026-10-05'), '05-Oct-2026');
    assert.equal(toNseDate('5/10/2026'), '05-Oct-2026');
    assert.equal(toNseDate('September 30, 2026'), null);   // not a shape either exchange uses for meeting_date
    assert.equal(toNseDate(''), null);
  });
  test('BSE short names lose their group suffix, real hyphenated symbols do not', () => {
    assert.equal(bseShortToSymbol('RAMAPPR-B'), 'RAMAPPR');
    assert.equal(bseShortToSymbol('HCLTECH'), 'HCLTECH');
    assert.equal(bseShortToSymbol('BAJAJ-AUTO'), 'BAJAJ-AUTO');
  });
  test('NSE files the same meeting as intimation + results row; both count, AGMs do not', () => {
    const rows = normaliseNse([
      { bm_symbol: 'COFORGE', bm_date: '23-Oct-2026', bm_purpose: 'Board Meeting Intimation', bm_desc: 'to consider and approve the Unaudited Financial results for the Half Yearly ended September 2026', sm_name: 'Coforge Limited' },
      { bm_symbol: 'COFORGE', bm_date: '23-Oct-2026', bm_purpose: 'Financial Results', bm_desc: 'To consider and approve the financial results', sm_name: 'Coforge Limited' },
      { bm_symbol: 'XYZ', bm_date: '30-Sep-2026', bm_purpose: 'AGM', bm_desc: 'Annual General Meeting to adopt financial results', sm_name: 'XYZ' },
      { bm_symbol: 'ABC', bm_date: '30-Sep-2026', bm_purpose: 'Dividend', bm_desc: 'interim dividend', sm_name: 'ABC' },
    ]);
    assert.deepEqual(rows.map((r) => r.bm_symbol), ['COFORGE', 'COFORGE']);
    assert.equal(rows[0].bm_purpose, 'Financial Results');
  });
  test('BSE forthcoming rows become results meetings with the scrip kept, and NSE wins the merge', () => {
    const bse = normaliseBse([{ scrip_Code: '532281', short_name: 'HCLTECH', Long_Name: 'HCL Technologies Ltd', meeting_date: '12 Oct 2026' }, { scrip_Code: '500357', short_name: 'RAMAPPR-B', Long_Name: 'Rama Paper Mills Ltd', meeting_date: '22 Sep 2026' }]);
    assert.equal(bse.length, 2); assert.equal(bse[0].bm_date, '12-Oct-2026'); assert.equal(bse[0].bse_scrip, '532281'); assert.equal(bse[1].bm_symbol, 'RAMAPPR');
    const nse = normaliseNse([{ bm_symbol: 'HCLTECH', bm_date: '12-Oct-2026', bm_purpose: 'Financial Results', bm_desc: '', sm_name: 'HCL Technologies Limited' }]);
    const merged = mergeMeetings(nse, bse);
    assert.equal(merged.length, 2); assert.equal(merged[0].source, 'NSE'); assert.equal(merged[1].bm_symbol, 'RAMAPPR');
  });
});

// ── zzz749: data watch helpers + meter failure accounting ────────────────
import { indiaResultsSeason, upcomingFloor, failureSignature } from '../data-watch';

describe('data watch (zzz749)', () => {
  test('results seasons cover the fortnight before and the month of each quarter print', () => {
    assert.equal(indiaResultsSeason('2026-09-22'), false);
    assert.equal(indiaResultsSeason('2026-09-26'), true);
    assert.equal(indiaResultsSeason('2026-10-20'), true);
    assert.equal(indiaResultsSeason('2026-11-20'), false);
    assert.equal(indiaResultsSeason('2027-01-10'), true);
    assert.equal(indiaResultsSeason('2026-12-28'), true);
    assert.equal(indiaResultsSeason('2026-05-15'), true);
    assert.equal(indiaResultsSeason('2026-08-20'), false);
    assert.equal(upcomingFloor('2026-10-20'), 25); assert.equal(upcomingFloor('2026-09-22'), 3);
  });
  test('the alert signature ignores passing checks and ordering', () => {
    const a = failureSignature([{ id: 'x', name: '', level: 'fail', detail: '', ms: 0 }, { id: 'y', name: '', level: 'ok', detail: '', ms: 0 }, { id: 'z', name: '', level: 'warn', detail: '', ms: 0 }]);
    const b = failureSignature([{ id: 'z', name: '', level: 'warn', detail: '', ms: 0 }, { id: 'x', name: '', level: 'fail', detail: '', ms: 0 }]);
    assert.equal(a, b); assert.equal(a, 'x:fail|z:warn');
  });
  test('the meter records refusals separately from billed calls, keeping the latest error', () => {
    let l = emptySpend('2026-09');
    l = applyCall(l, 'ai-desk', 0, null, '2026-09-21T20:07:00Z', false, { status: 400, message: 'credit balance is too low' });
    l = applyCall(l, 'gainers-read', 0.01, { input_tokens: 100, output_tokens: 10 }, '2026-09-21T21:00:00Z');
    assert.equal(l.failed, 1); assert.equal(l.calls, 1); assert.equal(l.last_error?.feature, 'ai-desk'); assert.equal(l.last_error?.status, 400);
    const m = mergeLedgers('2026-09', [l, applyCall(emptySpend('2026-09'), 'x', 0, null, '2026-09-22T01:00:00Z', false, { status: 0, message: 'timeout' })]);
    assert.equal(m.failed, 2); assert.equal(m.last_error?.at, '2026-09-22T01:00:00Z');
  });
});

// ── zzz750: OpenAI behind the Anthropic shape ────────────────────────────
import { toOpenAIRequest, fromOpenAIResponse } from '../anthropic-meter';

describe('openai translation (zzz750)', () => {
  test('a forced-tool Anthropic request becomes a forced-function Chat Completions request', () => {
    const r = toOpenAIRequest({
      model: 'claude-haiku-4-5-20251001', max_tokens: 1024, system: 'You are careful.', temperature: 0,
      tools: [{ name: 'file_it', description: 'file', input_schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] } }],
      tool_choice: { type: 'tool', name: 'file_it' },
      messages: [{ role: 'user', content: 'KMEW — Order win\n\nbody text' }],
    }, 'gpt-5-mini', 'minimal');
    assert.equal(r.model, 'gpt-5-mini'); assert.equal(r.max_completion_tokens, 1024 * 2 + 4000); assert.equal(r.reasoning_effort, 'minimal');
    assert.equal(r.temperature, undefined);                       // gpt-5 refuses a non-default temperature
    assert.deepEqual(r.messages[0], { role: 'system', content: 'You are careful.' });
    assert.equal(r.messages[1].content, 'KMEW — Order win\n\nbody text');
    assert.equal(r.tools[0].function.name, 'file_it'); assert.equal(r.tools[0].function.parameters.required[0], 'a');
    assert.deepEqual(r.tool_choice, { type: 'function', function: { name: 'file_it' } });
    const r2 = toOpenAIRequest({ model: 'x', max_tokens: 10, temperature: 0, messages: [{ role: 'user', content: 'hi' }] }, 'gpt-4.1-mini');
    assert.equal(r2.temperature, 0); assert.equal(r2.reasoning_effort, undefined); assert.equal(r2.max_completion_tokens, 10);
  });
  test('a tool call comes back as a tool_use block; usage and stop_reason are Anthropic-shaped', () => {
    const a = fromOpenAIResponse({ id: 'c1', model: 'gpt-5-mini', choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls: [{ id: 't1', type: 'function', function: { name: 'file_it', arguments: '{"a":"₹279 Cr"}' } }] } }], usage: { prompt_tokens: 1200, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 200 } } });
    assert.equal(a.content[0].type, 'tool_use'); assert.equal(a.content[0].name, 'file_it'); assert.equal(a.content[0].input.a, '₹279 Cr');
    assert.equal(a.stop_reason, 'tool_use');
    assert.deepEqual(a.usage, { input_tokens: 1000, cache_read_input_tokens: 200, output_tokens: 80 });
    const t = fromOpenAIResponse({ choices: [{ finish_reason: 'length', message: { content: '{"label":"Pos' } }], usage: { prompt_tokens: 5, completion_tokens: 5 } });
    assert.equal(t.content[0].type, 'text'); assert.equal(t.stop_reason, 'max_tokens');
    const bad = fromOpenAIResponse({ choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ id: 'x', type: 'function', function: { name: 'f', arguments: '{not json' } }] } }] });
    assert.equal(bad.content.length, 0);                          // unparseable arguments → no tool_use → caller reports "answered without filing"
  });
  test('gpt-5-mini is priced as gpt-5-mini, not gpt-5', () => {
    assert.equal(pricingFor('gpt-5-mini')?.input, 0.25); assert.equal(pricingFor('gpt-5')?.input, 1.25); assert.equal(pricingFor('gpt-5-nano')?.output, 0.40);
    assert.equal(Number(costOf('gpt-5-mini', { input_tokens: 1000, cache_read_input_tokens: 200, output_tokens: 80 }).toFixed(6)), 0.000415);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
import {
  buildComparisons, extractCause, changeBetween, quantity, historyDepth,
} from '../thesis/comparison';
import { applyComparisons } from '../thesis/variables';

describe('longitudinal comparison — current → previous → change → cause (zzz758)', () => {
  const now = '2026-09-22T10:00:00.000Z';
  const doc = (url: string, label: string, kind: string, date: string): any =>
    ({ id: documentId(url), url, label, kind, source: 'screener.in company page', period: null, date_iso: date, outcome: 'read', chars: 40000, pages: 20 });
  const ev = (variable: string, value_type: string, before: string | null, after: string, unit: string | null, source: string, text?: string, direction = 'up'): any =>
    ({ variable, value_type, before, after, unit, period: null, direction,
      evidence_text: text || `Capacity utilisation stood at ${after} during the quarter, management said on the call.`,
      source, confidence: 'HIGH' });

  const period = (ticker: string, docs: any[], events: any[], runId: string) => {
    const rp = reportingPeriodForDocuments(docs);
    const { facts, events: evs } = factsFromEvents(ticker, rp.period, events, docs, now);
    return {
      period: {
        reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date,
        documents: docs, documents_found: docs.length, documents_read: docs.length, documents_failed: 0, documents_skipped: 0,
        facts, events: evs, summary: { events }, status: null, status_because: null, tallies: null,
        discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: runId, prompt_version: 'v8', model: 'm',
        extracted_at: now, updated_at: now,
      } as any,
      run: { run_id: runId, reporting_period: rp.period, started_at: now, finished_at: now, outcome: 'COMPLETED', error: null,
        documents_found: docs.length, documents_read: docs.length, facts_extracted: facts.length, events_extracted: evs.length,
        model: 'm', prompt_version: 'v8' } as any,
    };
  };

  // AZAD-shaped: utilisation disclosed in Q4 FY26 and again in Q1 FY27.
  const q4Docs = [doc('https://x/azad-q4.pdf', 'Concall transcript May 2026', 'transcript', '2026-05-20')];
  const q1Docs = [doc('https://x/azad-q1.pdf', 'Concall transcript Jul 2026', 'transcript', '2026-07-24')];
  const twoPeriod = () => {
    const a = period('AZAD', q4Docs, [
      ev('utilisation', 'ACTUAL', null, '72%', '%', 'Concall transcript May 2026',
        'Capacity utilisation for the quarter was 72% across the Hyderabad plants.'),
      ev('order_book', 'ACTUAL', null, 'INR 500 crores', 'crores', 'Concall transcript May 2026',
        'The closing order book stood at INR 500 crores as at the end of the quarter.'),
      ev('capacity', 'ACTUAL', null, '1,200 tonnes', 'tonnes', 'Concall transcript May 2026',
        'Installed capacity at the end of the period was 1,200 tonnes per annum.'),
    ], 'r1');
    const b = period('AZAD', q1Docs, [
      ev('utilisation', 'ACTUAL', null, '80%', '%', 'Concall transcript Jul 2026',
        'Capacity utilisation improved to 80% during the quarter due to the commissioning of the new machining line.'),
      ev('order_book', 'ACTUAL', null, 'INR 820 crores', 'crores', 'Concall transcript Jul 2026',
        'The closing order book stood at INR 820 crores, driven by a long-term contract from a European customer.'),
      ev('guidance', 'GUIDANCE', null, '30% revenue growth', '%', 'Concall transcript Jul 2026',
        'We are guiding to 30% revenue growth for the full year.'),
    ], 'r2');
    let l = mergePeriod(emptyLedger('AZAD', 'IN', now), a.period, a.run);
    l = mergePeriod(l, b.period, b.run);
    return l;
  };

  test('a level becomes a direction once a second period exists — 72% → 80% is +8pp, not +11.1%', () => {
    const c = buildComparisons(twoPeriod());
    const u = c.utilisation!;
    assert.equal(u.current!.raw, '80%');
    assert.equal(u.previous!.raw, '72%');
    assert.equal(u.previous_period, 'Q4 FY26');
    assert.equal(u.current_period, 'Q1 FY27');
    assert.equal(u.change, '+8pp', 'percentages move in points, never in percent');
    assert.equal(u.change_relative, '+11.1% relative');
    assert.equal(u.change_type, 'INCREASED');
    assert.equal(u.basis, 'QOQ');
    assert.equal(u.direction, 'up');
  });

  test('§75 — a previous value is never invented when no earlier period holds one', () => {
    const one = (() => { const a = period('AZAD', q1Docs, [
      ev('utilisation', 'ACTUAL', null, '80%', '%', 'Concall transcript Jul 2026',
        'Capacity utilisation across the plants was 80% during the quarter.')], 'r1');
      return mergePeriod(emptyLedger('AZAD', 'IN', now), a.period, a.run); })();
    const u = buildComparisons(one).utilisation!;
    assert.equal(u.previous, null);
    assert.equal(u.previous_period, null);
    assert.equal(u.change, null);
    assert.equal(u.change_type, 'NEW');
    assert.equal(u.basis, 'NONE');
    assert.match(u.line, /NOT DISCLOSED/);
    assert.equal(historyDepth(one).depth, 1);
  });

  test('a figure disclosed earlier and absent now is NOT_DISCLOSED, with the last known value kept', () => {
    const cap = buildComparisons(twoPeriod()).capacity!;
    assert.equal(cap.change_type, 'NOT_DISCLOSED');
    assert.equal(cap.current, null);
    assert.equal(cap.previous!.raw, '1,200 tonnes');
    assert.equal(cap.previous_period, 'Q4 FY26');
    assert.match(cap.line, /stops disclosing/);
  });

  test('different units are never subtracted — two levels, no arrow', () => {
    const a = period('MOREPEN', q4Docs, [ev('capacity', 'ACTUAL', null, '314 kiloliters', 'kiloliters', 'Concall transcript May 2026',
      'Installed capacity was 314 kiloliters at the site.')], 'r1');
    const b = period('MOREPEN', q1Docs, [ev('capacity', 'ACTUAL', null, '200 KLD', 'KLD', 'Concall transcript Jul 2026',
      'Installed capacity now stands at 200 KLD.')], 'r2');
    let l = mergePeriod(emptyLedger('MOREPEN', 'IN', now), a.period, a.run);
    l = mergePeriod(l, b.period, b.run);
    const cap = buildComparisons(l).capacity!;
    assert.equal(cap.change_type, 'NOT_COMPARABLE');
    assert.equal(cap.change, null);
    assert.equal(cap.direction, 'unknown');
    assert.match(cap.line, /different unit/);
  });

  test('§76 — a cause exists only where the document wrote a causal connective', () => {
    const c = buildComparisons(twoPeriod());
    assert.equal(c.utilisation!.cause!.connective, 'due to');
    assert.match(c.utilisation!.cause!.text, /commissioning/);
    assert.equal(c.utilisation!.cause!.persistence, 'STRUCTURAL');
    assert.equal(c.order_book!.cause!.persistence, 'STRUCTURAL');
    // No connective anywhere in the sentence → no cause, and it says so.
    assert.equal(extractCause('Capacity utilisation was 80% during the quarter.', 'x'), null);
  });

  test('a temporary cause is separated from a structural one', () => {
    const t = extractCause('Margin expanded 300 bps due to a favourable forex movement in the quarter.', 'concall');
    assert.equal(t!.persistence, 'TEMPORARY');
    const s = extractCause('Revenue grew 40% driven by the new plant commissioned in April.', 'concall');
    assert.equal(s!.persistence, 'STRUCTURAL');
    const u = extractCause('Volumes rose owing to broad based demand across the book.', 'concall');
    assert.equal(u!.persistence, 'UNCLASSIFIED');
  });

  test('guidance restated unchanged is REITERATED, not a new disclosure', () => {
    const a = period('X', q4Docs, [ev('guidance', 'GUIDANCE', null, '30% revenue growth', '%', 'Concall transcript May 2026',
      'We are guiding to 30% revenue growth.')], 'r1');
    const b = period('X', q1Docs, [ev('guidance', 'GUIDANCE', null, '30% revenue growth', '%', 'Concall transcript Jul 2026',
      'We are guiding to 30% revenue growth.')], 'r2');
    let l = mergePeriod(emptyLedger('X', 'IN', now), a.period, a.run);
    l = mergePeriod(l, b.period, b.run);
    const g = buildComparisons(l).guidance!;
    assert.equal(g.change_type, 'REITERATED');
    assert.equal(g.promised!.period, 'Q4 FY26');
  });

  test('the comparison upgrades the variable row from stated to a judged direction', () => {
    const cmp = buildComparisons(twoPeriod());
    const before: any[] = [{ key: 'utilisation', label: 'Capacity utilisation', kind: 'fact',
      before: null, after: '80%', delta: null, verdict: 'stated', evidence: 'Level only.', source: 'filing' }];
    const [row] = applyComparisons(before as any, cmp);
    assert.equal(row.verdict, 'improving');
    assert.equal(row.before, '72%');
    assert.equal(row.delta, '+8pp');
    assert.match(row.evidence, /Q4 FY26.*Q1 FY27/);
    assert.match(row.evidence, /STRUCTURAL/);
  });

  test('a variable that moves with no stated reason says so rather than guessing one', () => {
    const a = period('Y', q4Docs, [ev('utilisation', 'ACTUAL', null, '60%', '%', 'Concall transcript May 2026',
      'Capacity utilisation was 60% in the quarter.')], 'r1');
    const b = period('Y', q1Docs, [ev('utilisation', 'ACTUAL', null, '68%', '%', 'Concall transcript Jul 2026',
      'Capacity utilisation was 68% in the quarter.')], 'r2');
    let l = mergePeriod(emptyLedger('Y', 'IN', now), a.period, a.run);
    l = mergePeriod(l, b.period, b.run);
    const cmp = buildComparisons(l);
    assert.equal(cmp.utilisation!.cause, null);
    const [row] = applyComparisons([{ key: 'utilisation', label: 'Capacity utilisation', kind: 'fact',
      before: null, after: '68%', delta: null, verdict: 'stated', evidence: '', source: 'filing' }] as any, cmp);
    assert.match(row.evidence, /CAUSE: not disclosed/);
  });

  test('a move inside the noise band is flat, not an improvement', () => {
    const a = period('Z', q4Docs, [ev('utilisation', 'ACTUAL', null, '80%', '%', 'Concall transcript May 2026',
      'Capacity utilisation across the plants was 80% for the quarter.')], 'r1');
    const b = period('Z', q1Docs, [ev('utilisation', 'ACTUAL', null, '80.4%', '%', 'Concall transcript Jul 2026',
      'Capacity utilisation across the plants was 80.4% for the quarter.')], 'r2');
    let l = mergePeriod(emptyLedger('Z', 'IN', now), a.period, a.run);
    l = mergePeriod(l, b.period, b.run);
    const cmp = buildComparisons(l);
    const [row] = applyComparisons([{ key: 'utilisation', label: 'Capacity utilisation', kind: 'fact',
      before: null, after: '80.4%', delta: null, verdict: 'stated', evidence: '', source: 'filing' }] as any, cmp);
    assert.equal(row.verdict, 'flat');
  });

  test('a negative variable inverts: a growing delay is a deterioration', () => {
    const a = period('W', q4Docs, [ev('execution_delay', 'ACTUAL', null, '2 months', 'months', 'Concall transcript May 2026',
      'The project is running 2 months behind schedule.')], 'r1');
    const b = period('W', q1Docs, [ev('execution_delay', 'ACTUAL', null, '6 months', 'months', 'Concall transcript Jul 2026',
      'The project is running 6 months behind schedule.')], 'r2');
    let l = mergePeriod(emptyLedger('W', 'IN', now), a.period, a.run);
    l = mergePeriod(l, b.period, b.run);
    const cmp = buildComparisons(l);
    const [row] = applyComparisons([{ key: 'execution_delay', label: 'Execution delay', kind: 'fact',
      before: null, after: '6 months', delta: null, verdict: 'stated', evidence: '', source: 'filing' }] as any, cmp);
    assert.equal(row.verdict, 'deteriorating');
  });

  test('a four-quarter gap is YoY and a two-quarter gap is SINCE_LAST_DISCLOSURE', () => {
    const d = (url: string, date: string) => [doc(url, `Concall ${date}`, 'transcript', date)];
    const mk = (docs: any[], val: string, run: string) => period('P', docs, [
      ev('utilisation', 'ACTUAL', null, val, '%', `Concall ${docs[0].date_iso}`,
        `Capacity utilisation across the plants was ${val} for the quarter.`)], run);
    const a = mk(d('https://x/1', '2025-07-24'), '50%', 'r1');   // Q1 FY26
    const b = mk(d('https://x/2', '2026-01-20'), '60%', 'r2');   // Q3 FY26
    const c = mk(d('https://x/3', '2026-07-24'), '70%', 'r3');   // Q1 FY27
    let l = mergePeriod(emptyLedger('P', 'IN', now), a.period, a.run);
    l = mergePeriod(l, c.period, c.run);
    assert.equal(buildComparisons(l).utilisation!.basis, 'YOY');
    l = mergePeriod(l, b.period, b.run);
    assert.equal(buildComparisons(l).utilisation!.basis, 'SINCE_LAST_DISCLOSURE');
    assert.equal(buildComparisons(l).utilisation!.previous_period, 'Q3 FY26');
  });

  test('the arithmetic helpers are honest about what they cannot do', () => {
    assert.equal(changeBetween(quantity('72%')!, quantity('80%')!).change, '+8pp');
    assert.equal(changeBetween(quantity('₹500 Cr')!, quantity('₹820 Cr')!).change, '+64%');
    assert.equal(changeBetween(quantity('0')!, quantity('5')!).change, null, 'no percentage off a zero base');
    assert.equal(changeBetween(quantity('strong')!, quantity('stronger')!).direction, 'unknown');
    assert.equal(quantity('80%')!.isPercent, true);
    assert.equal(quantity('₹820 Cr')!.isPercent, false);
    assert.equal(quantity('')?.raw, undefined);
  });

  test('an empty ledger produces no comparisons rather than throwing', () => {
    assert.deepEqual(buildComparisons(null), {});
    assert.deepEqual(buildComparisons(emptyLedger('Q', 'IN', now)), {});
    assert.equal(historyDepth(null).depth, 0);
  });
});

describe('zzz758 — magnitude words, restated figures, amounts in words', () => {
  test('GPPL — 1,000,000 tonnes → 1.6 million tonnes is +60%, not −100%', () => {
    assert.equal(scaledNumber('a little less than 1,000,000 metric tonnes'), 1_000_000);
    assert.equal(scaledNumber('1.6 million metric tonnes'), 1_600_000);
    assert.equal(ledgerDeltaOf('1,000,000 metric tonnes', '1.6 million metric tonnes', null), '+60%');
    assert.ok(ledgerSameUnit('1,000,000 metric tonnes', '1.6 million metric tonnes', null, null),
      'a magnitude word is part of the value, not a different unit');
  });

  test('magnitudes are read on every scale the filings use', () => {
    assert.equal(scaledNumber('₹500 Cr'), 5e9);
    assert.equal(scaledNumber('₹1,20,000/-'), 120000);
    assert.equal(scaledNumber('12 lakh units'), 1.2e6);
    assert.equal(scaledNumber('2 bn'), 2e9);
    assert.equal(scaledNumber('no figure'), null);
  });

  test('CUPID / BHAGCHEM — a figure restated identically is a level, not a +0% move', () => {
    assert.equal(ledgerDeltaOf('480 million units', '480 million units', null), null);
    assert.equal(ledgerDeltaOf('74%', '74%', '%'), null);
    assert.equal(ledgerDeltaOf('74%', '80%', '%'), '+6pp');
  });

  test('UNIVCABLES — an amount spelled out in words is a legal clause, not a balance-sheet figure', () => {
    assert.equal(judgeEventQuality({
      variable: 'working_capital', before: null,
      after: '₹1,20,000/- (Rupees One Lakh Twenty Thousand only)', unit: null,
      evidence_text: 'The board approved working capital of ₹1,20,000/- (Rupees One Lakh Twenty Thousand only) payable to each director for attending meetings.',
    }), 'unit_mismatch');
    // A real working-capital sentence is untouched.
    assert.equal(judgeEventQuality({
      variable: 'working_capital', before: '112 days', after: '96 days', unit: 'days',
      evidence_text: 'Working capital days improved from 112 days to 96 days over the course of the year, management said.',
    }), 'sentence');
  });
});

import { sourceTier, bestEventPerVariable } from '../thesis/evidence-extract';
import { extractVariables as extractVars } from '../thesis/variables';

describe('zzz759 — magnitude-only capacity, source precedence, restated additions', () => {
  const ev = (variable: string, after: string, source: string, text: string, before: string | null = null): any =>
    ({ variable, value_type: 'ACTUAL', before, after, unit: null, period: null, direction: 'up',
      evidence_text: text, source, confidence: 'HIGH' });

  test('HONASA — a capacity stated only as a magnitude names no unit and is refused', () => {
    assert.equal(judgeEventQuality({
      variable: 'capacity', before: null, after: '24,785 Mn', unit: null,
      evidence_text: 'Installed capacity for the year stood at 24,785 Mn as disclosed in the annual report.',
    }), 'unit_mismatch');
    // GESHIP's genuine figure names square feet, so it survives (zzz755 guard held).
    assert.equal(judgeEventQuality({
      variable: 'capacity', before: null, after: '60 million sq. ft.', unit: null,
      evidence_text: 'The company operates an installed capacity of 60 million sq. ft. across its four plants.',
    }), 'sentence');
    // An unlabelled bare count is unlabelled, not mis-filed.
    assert.equal(judgeEventQuality({
      variable: 'capacity', before: null, after: '42,000', unit: null,
      evidence_text: 'Installed capacity at the end of the period was 42,000 across all lines in operation.',
    }), 'sentence');
  });

  test('SPECTRUM — the written document supplies the figure, and the disagreement is shown', () => {
    assert.ok(sourceTier('Financial Results May 2026') < sourceTier('Investor presentation May 2026'));
    assert.ok(sourceTier('Investor presentation May 2026') < sourceTier('Concall transcript May 2026'));
    const vars = varsFromEvents([
      ev('capacity', '3.0 MW', 'Concall transcript May 2026',
        'Management said installed capacity at the site is now 3.0 MW following the latest addition.'),
      ev('capacity', '3.3 MW', 'Investor presentation May 2026',
        'The investor deck states installed capacity of 3.3 MW across the operating portfolio today.'),
    ]);
    const cap = vars.find((v) => v.key === 'capacity')!;
    assert.equal(cap.after, '3.3 MW', 'the deck wins over the spoken figure');
    assert.equal(cap.conflict!.length, 1);
    assert.equal(cap.conflict![0].value, '3.0 MW');
    assert.match(cap.evidence, /SOURCES DISAGREE/);
  });

  test('a comparison still beats a tier — an event carrying both sides wins', () => {
    const slot = bestEventPerVariable([
      ev('utilisation', '80%', 'Investor presentation Jul 2026',
        'Capacity utilisation across the plants stood at 80% for the quarter under review.'),
      ev('utilisation', '80%', 'Concall transcript Jul 2026',
        'Capacity utilisation across the plants rose from 72% to 80% over the quarter, management said.', '72%'),
    ]).get('utilisation')!;
    assert.equal(slot.actual!.before, '72%', 'the row with a comparison is kept');
    assert.equal(slot.conflicts.length, 0, 'different shapes are not a disagreement');
  });

  test('MOREPEN — capacity added is dropped when it merely restates installed capacity', () => {
    const summary = { events: [
      ev('capacity', '200 KLD', 'Concall transcript Jul 2026',
        'The installed capacity at the Baddi facility is 200 KLD after the latest expansion was completed.'),
      ev('capacity_addition', '200 KLD', 'Concall transcript Jul 2026',
        'The installed capacity at the Baddi facility is 200 KLD after the latest expansion was completed.'),
    ] };
    const vars = extractVars(null, summary);
    assert.ok(vars.some((v) => v.key === 'capacity'), 'installed capacity is kept');
    assert.equal(vars.filter((v) => v.key === 'capacity_addition').length, 0,
      'the duplicate addition — which would have scored as growth — is dropped');
    // A genuinely different addition survives.
    const vars2 = extractVars(null, { events: [
      ev('capacity', '200 KLD', 'Concall transcript Jul 2026',
        'The installed capacity at the Baddi facility is 200 KLD after the latest expansion was completed.'),
      ev('capacity_addition', '50 KLD', 'Concall transcript Jul 2026',
        'During the quarter the company added 50 KLD of fresh capacity at the Baddi facility site.'),
    ] });
    assert.equal(vars2.filter((v) => v.key === 'capacity_addition').length, 1);
  });
});

describe('zzz760 — an unreadable document is not a dead end', () => {
  const ev = (variable: string, after: string, text: string): any =>
    ({ variable, value_type: 'ACTUAL', before: null, after, unit: null, period: null,
      direction: 'up', evidence_text: text, source: 'Concall transcript Jul 2026', confidence: 'HIGH' });

  test('VAML — utilisation above nameplate is kept, and says which question to ask', () => {
    const [v] = varsFromEvents([ev('utilisation', '120%',
      'Capacity utilisation across the two plants ran at 120% during the quarter on additional shifts.')]);
    assert.equal(v.after, '120%', 'the figure is not thrown away — above nameplate is real');
    assert.match(v.evidence, /Above 100% of nameplate/);
    assert.match(v.evidence, /mis-read number/);
  });

  test('an ordinary utilisation carries no nameplate note', () => {
    const [v] = varsFromEvents([ev('utilisation', '84%',
      'Capacity utilisation across the two plants stood at 84% during the quarter under review.')]);
    assert.doesNotMatch(v.evidence, /nameplate/);
  });
});

describe('zzz761 — before → now on the board, and targets obey the unit rules', () => {
  const ev = (variable: string, value_type: string, after: string, text: string): any =>
    ({ variable, value_type, before: null, after, unit: null, period: null, direction: 'up',
      evidence_text: text, source: 'Concall transcript Jul 2026', confidence: 'HIGH' });

  test('JINDRILL / VIJAYA — a target that is not a fill rate never stands in for one', () => {
    // A refurbishment period filed as a utilisation GUIDANCE.
    assert.equal(varsFromEvents([ev('utilisation', 'GUIDANCE', '4 to 6 months',
      'Refurbishment periods of 4 to 6 months could delay redeployment of the rigs.')])
      .filter((v) => v.key === 'utilisation').length, 0);
    // A breakeven horizon filed as a utilisation TARGET.
    assert.equal(varsFromEvents([ev('utilisation', 'TARGET', 'breakeven within 1 year',
      'The new centres are expected to reach breakeven within 1 year of opening, management said.')])
      .filter((v) => v.key === 'utilisation').length, 0);
    // A real utilisation target still stands.
    const ok = varsFromEvents([ev('utilisation', 'TARGET', '80%',
      'We are targeting capacity utilisation of 80% across the plants by the end of the year.')]);
    assert.equal(ok[0].after, '80% (target)');
    assert.equal(ok[0].kind, 'claim');
  });

  test('the summary prior is recovered when the event captured only a level', () => {
    const summary = {
      events: [ev('utilisation', 'ACTUAL', '80%',
        'Capacity utilisation across the plants stood at 80% for the quarter under review.')],
      utilisation: { prior: '72%', current: '80%' },
    };
    const v = extractVars(null, summary).find((x) => x.key === 'utilisation')!;
    assert.equal(v.before, '72%', 'the prior the summary already held is not discarded');
    assert.equal(v.after, '80%');
    assert.equal(v.delta, '+8pp');
    assert.equal(v.verdict, 'improving');
    assert.match(v.evidence, /72% → 80%/);
  });

  test('no prior in the summary leaves the level exactly as it was', () => {
    const summary = {
      events: [ev('utilisation', 'ACTUAL', '80%',
        'Capacity utilisation across the plants stood at 80% for the quarter under review.')],
      utilisation: { current: '80%' },
    };
    const v = extractVars(null, summary).find((x) => x.key === 'utilisation')!;
    assert.equal(v.before, null, 'nothing is invented to fill the gap');
    assert.equal(v.verdict, 'stated');
  });
});


describe('zzz762 — the summary rows obey the unit rules; the filing fills what the grader cannot', () => {
  const ev = (variable: string, value_type: string, before: string | null, after: string, text: string, source = 'Concall transcript Jul 2026', confidence = 'HIGH'): any =>
    ({ variable, value_type, before, after, unit: null, period: null, direction: 'up',
      evidence_text: text, source, confidence });

  test('REDINGTON / DEEPAKNTR / SFL — a growth rate or a day-count under utilisation is dropped from the summary path too', () => {
    for (const bad of ['-14%', '>175%', '30 days inventory']) {
      const vars = extractVariables(null, { utilisation: { current: bad } });
      assert.equal(vars.filter((v) => v.key === 'utilisation').length, 0, `summary utilisation "${bad}" must not reach the board`);
    }
    const ok = extractVariables(null, { utilisation: { prior: '72%', current: '80%' } });
    const u = ok.find((v) => v.key === 'utilisation')!;
    assert.equal(u.before, '72%'); assert.equal(u.after, '80%'); assert.equal(u.verdict, 'improving');
  });

  test('an event rejected as unit_mismatch does not let the summary re-push the same value', () => {
    const summary = {
      events: [ev('utilisation', 'ACTUAL', null, '-14%', 'Revenue from the segment declined 14% during the quarter under review, management said.')],
      utilisation: { current: '-14%' },
    };
    assert.equal(extractVariables(null, summary).filter((v) => v.key === 'utilisation').length, 0);
  });

  test('RATEGAIN — a bare percentage is not an answer to "is the capex earning yet"', () => {
    assert.equal(valueFitsVariable({ variable: 'capex_earning', before: null, after: '78.8%', unit: null, evidence_text: 'Capex earning: 78.8%.' }), false);
    assert.equal(valueFitsVariable({ variable: 'capex_earning', before: null, after: 'new line ramping, 60% utilised', unit: null, evidence_text: 'Capex earning: new line ramping.' }), true);
    assert.equal(extractVariables(null, { capex_earning: '78.8%' }).filter((v) => v.key === 'capex_earning').length, 0);
    const good = extractVariables(null, { capex_earning: 'the new plant is ramping and contributed revenue this quarter' });
    assert.equal(good.find((v) => v.key === 'capex_earning')!.verdict, 'improving');
  });

  test('EXICOM — "+1400 Cr" in the growth slot is a level, never a delta', () => {
    const vars = extractVariables(null, { order_book: { growth: '+1400 Cr' } });
    const ob = vars.find((v) => v.key === 'order_book')!;
    assert.equal(ob.after, '1400 Cr');
    assert.equal(ob.delta, null);
    assert.equal(ob.verdict, 'stated');
    const rate = extractVariables(null, { order_book: { closing_value: 'Rs 1,000 crore', growth: '+22%' } })
      .find((v) => v.key === 'order_book')!;
    assert.equal(rate.after, 'Rs 1,000 crore'); assert.equal(rate.delta, '+22%'); assert.equal(rate.verdict, 'improving');
    // A bare rate filed as the book itself is refused on the events path.
    assert.equal(valueFitsVariable({ variable: 'order_book', before: null, after: '+22%', unit: null, evidence_text: 'Order book grew 22% year on year to a record level, management said.' }), false);
  });

  test('UNIMECH / SONACOMS — the board and WHAT CHANGED rank readings identically', () => {
    // Written document beats transcript for the same shape; a before beats a tier.
    const deck = { value_type: 'ACTUAL' as const, before: null, source: 'Investor presentation Jul 2026', confidence: 'MEDIUM' as const };
    const call = { value_type: 'ACTUAL' as const, before: null, source: 'Concall transcript Jul 2026', confidence: 'HIGH' as const };
    assert.ok(betterReading(deck, call) < 0, 'deck wins over transcript even at lower confidence');
    const callWithBefore = { ...call, before: '52%' };
    assert.ok(betterReading(callWithBefore, deck) < 0, 'a before → after move beats a bare level from a better source');
    // Through the ledger: two ACTUAL utilisation readings of one quarter.
    const docs = [
      { id: documentId('https://x/u-ppt.pdf'), url: 'https://x/u-ppt.pdf', label: 'Investor presentation Jul 2026', kind: 'investor_presentation', source: 's', period: null, date_iso: '2026-07-24', outcome: 'read', chars: 40000, pages: 20 },
      { id: documentId('https://x/u-call.pdf'), url: 'https://x/u-call.pdf', label: 'Concall transcript Jul 2026', kind: 'transcript', source: 's', period: null, date_iso: '2026-07-25', outcome: 'read', chars: 40000, pages: 20 },
    ] as any[];
    const events = [
      ev('utilisation', 'ACTUAL', null, '58%', 'Capacity utilisation for the quarter stood at about 58 percent, management said on the call.', 'Concall transcript Jul 2026', 'HIGH'),
      ev('utilisation', 'ACTUAL', null, '52%', 'Capacity utilisation across the plants was 52% for the quarter under review.', 'Investor presentation Jul 2026', 'MEDIUM'),
    ];
    const rp = reportingPeriodForDocuments(docs);
    const now = '2026-07-26T00:00:00.000Z';
    const { facts, events: evs } = factsFromEvents('UNIMECH', rp.period, events, docs, now);
    const period: any = { reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date,
      documents: docs, documents_found: 2, documents_read: 2, documents_failed: 0, documents_skipped: 0,
      facts, events: evs, summary: { events }, status: null, status_because: null, tallies: null,
      discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: 'r', prompt_version: 'v9', model: 'm', extracted_at: now, updated_at: now };
    const run: any = { run_id: 'r', reporting_period: rp.period, started_at: now, finished_at: now, outcome: 'COMPLETED', error: null,
      documents_found: 2, documents_read: 2, facts_extracted: facts.length, events_extracted: evs.length, model: 'm', prompt_version: 'v9', raw_extraction_json: { events } };
    const ledger = mergePeriod(emptyLedger('UNIMECH', 'IN', now), period, run);
    const board = extractVariables(null, { events }).find((v) => v.key === 'utilisation')!;
    const changed = whatChanged(ledger).lines.find((l) => l.metric === 'utilisation')!;
    assert.equal(board.after, '52%');
    assert.match(changed.text, /52%/);
    assert.doesNotMatch(changed.text, /58%/);
  });

  test('the filing headline fills revenue growth, earnings growth and cash conversion when there is no grader row', () => {
    const summary = { headline: {
      period: 'Q1 FY27', basis: 'consolidated', comparison: 'yoy',
      revenue: 'Rs 1,053 crore', revenue_prior: 'Rs 828 crore', revenue_growth: '+27.1%',
      profit: 'Rs 96 crore', profit_prior: 'Rs 80 crore', profit_growth: '',
      ebitda: 'Rs 180 crore', cash_from_operations: '', cash_flow_period: '',
    } };
    const vars = extractVariables(null, summary);
    const rev = vars.find((v) => v.key === 'revenue_growth')!;
    assert.equal(rev.source, 'filing');
    assert.equal(rev.delta, '+27.1%');
    assert.equal(rev.before, 'Rs 828 crore');
    assert.equal(rev.verdict, 'improving');
    assert.match(rev.evidence, /as printed/);
    const eps = vars.find((v) => v.key === 'earnings_growth')!;
    assert.equal(eps.delta, '+20%', 'two printed figures, no printed rate — arithmetic on the two');
    assert.match(eps.evidence, /arithmetic on the two/);
    assert.equal(eps.verdict, 'improving');
    // Cash flow absent in the filing → no cash conversion row, no invention.
    assert.equal(vars.filter((v) => v.key === 'cash_conversion').length, 0);
    // The status no longer blames the grader for a figure the filing supplied.
    const a = assessThesis({ pattern: null, evidenceReviewed: true, hasGraderRow: false, variables: vars as any });
    assert.notEqual(a.checked.find((c) => c.key === 'revenue_growth')!.absence, 'no_grader_row');
  });

  test('the grader row still wins over the headline; a half-year cash figure is a level, not a quarter ratio', () => {
    const graded = { sales_yoy_pct: 31, eps_yoy_pct: 12 };
    const summary = { headline: { period: 'Q1 FY27', basis: 'consolidated', comparison: 'yoy',
      revenue: 'Rs 1,053 crore', revenue_prior: 'Rs 828 crore', revenue_growth: '+27.1%',
      profit: 'Rs 96 crore', profit_prior: '', profit_growth: '',
      ebitda: '', cash_from_operations: 'Rs 140 crore', cash_flow_period: 'H1 FY27' } };
    const vars = extractVariables(graded, summary);
    const rev = vars.find((v) => v.key === 'revenue_growth')!;
    assert.equal(rev.source, 'grader'); assert.equal(rev.delta, '+31%');
    const cc = vars.find((v) => v.key === 'cash_conversion')!;
    assert.equal(cc.verdict, 'stated');
    assert.match(cc.after!, /H1 FY27/);
    assert.match(cc.evidence, /differs from the results period/);
  });

  test('a headline growth off a loss, or across different units, is not computed', () => {
    const loss = extractVariables(null, { headline: { profit: 'Rs 20 crore', profit_prior: 'Rs -15 crore' } });
    assert.equal(loss.filter((v) => v.key === 'earnings_growth').length, 0);
    const units = extractVariables(null, { headline: { revenue: 'USD 12 million', revenue_prior: 'Rs 80 crore' } });
    assert.equal(units.filter((v) => v.key === 'revenue_growth').length, 0);
  });
});


describe('zzz763 — mis-filed charts, loss bases, immaterial one-offs, recent reporters', () => {
  const ev = (variable: string, value_type: string, before: string | null, after: string, text: string, source = 'Concall transcript Aug 2026', unit: string | null = null): any =>
    ({ variable, value_type, before, after, unit, period: null, direction: 'up', evidence_text: text, source, confidence: 'HIGH' });

  test('REDINGTON — a working-capital-days chart filed under utilisation is a unit mismatch, not a chart', () => {
    assert.equal(judgeEventQuality({ variable: 'utilisation', before: '37', after: '32', unit: 'days', evidence_text: 'Q1FY27 Working Capital Days 37 30 32 Q1FY26Q4FY26Q1FY27' }), 'unit_mismatch');
    assert.equal(judgeEventQuality({ variable: 'utilisation', before: '37', after: '32', unit: 'days', evidence_text: 'Working capital days improved to 32 days in Q1 27 from 37 in Q1 26.' }), 'unit_mismatch');
    // E2E's genuine utilisation slide is still a chart.
    assert.equal(judgeEventQuality({ variable: 'utilisation', before: '61%', after: '75%', unit: '%', evidence_text: '61% 75% -10% 10% 30% 50% 70% 90% 0 200 400 600 800 Q1 FY26' }), 'chart');
  });

  test('DEEPAKNTR — ">175% Phenol" axis label is dropped; "170-odd percent utilization" in a sentence survives', () => {
    assert.equal(judgeEventQuality({ variable: 'utilisation', before: null, after: '>175% Phenol and Acetone Production', unit: null, evidence_text: '>175% Phenol and Acetone Production' }), 'unit_mismatch');
    assert.equal(judgeEventQuality({ variable: 'utilisation', before: null, after: '170-odd percent utilization', unit: null, evidence_text: 'Given the disclosures from the annual report, we are already operating at about 170-odd percent utilization of the nameplate.' }), 'sentence');
  });

  test('LUMAXTECH — "operating at 18% margins" is a margin, not a fill rate', () => {
    assert.equal(judgeEventQuality({ variable: 'utilisation', before: null, after: '18%', unit: null, evidence_text: 'We are already operating at 18% margins, which is very good for an auto comp product.' }), 'unit_mismatch');
  });

  test('EXICOM — "15 MWh of orders in hand" is not a volume; "+1400 Cr" is a level printed as "over"', () => {
    assert.equal(judgeEventQuality({ variable: 'volume', before: null, after: '15 MWh', unit: 'MWh', evidence_text: 'Today, we have about 15 megawatt hours of orders in hand, which are worth roughly INR20 crores, management said.' }), 'unit_mismatch');
    assert.equal(levelText('+1400 Cr'), 'over 1400 Cr');
    assert.equal(levelText('+22%'), '+22%');
  });

  test('UNIMECH — a sentence beats a chart whatever the source tier, on the board and in WHAT CHANGED', () => {
    const events = [
      ev('utilisation', 'ACTUAL', null, '52%', '52% 60% 70% FY24 FY25 FY26', 'Annual Report 2026'),
      ev('utilisation', 'ACTUAL', null, 'approximately 58%', 'Capacity utilisation for the quarter was approximately 58 percent across the plants, management said.', 'Concall transcript Aug 2026'),
    ];
    assert.equal(varsFromEvents(events).find((v) => v.key === 'utilisation')!.after, 'approximately 58%');
  });

  test('a placeholder with a suffix is still a placeholder; a period label is not a number; equal numbers are not a move', () => {
    assert.equal(said('Not stated in release'), false);
    assert.equal(said('not disclosed for the quarter'), false);
    assert.equal(said('74%'), true);
    assert.equal(scaledNumber('Q4 FY26'), null);
    assert.equal(scaledNumber('nearly doubling compared with Q4 FY26'), null);
    assert.equal(ledgerDeltaOf('Q4 FY26: 59 days', '59 days by Q4 FY26', null), null);
    assert.equal(ledgerDeltaOf('Test kits 58% (March trailing)', '58%', '%'), null);
    assert.equal(ledgerDeltaOf('a little less than 1,000,000 metric tonnes', '1.6 million metric tonnes', null), '+60%');
  });

  test('working capital in DAYS improves when it falls', () => {
    const down = varsFromEvents([ev('working_capital', 'ACTUAL', '137 days', '84 days', 'Net working capital days came down to 84 days from 137 days a year ago, management said.', 'Concall transcript Aug 2026', 'days')]);
    assert.equal(down[0].verdict, 'improving');
    const up = varsFromEvents([ev('working_capital', 'ACTUAL', '145 days in Q4 FY26', '161 days in Q1 FY27', 'Working capital days rose to 161 days in Q1 FY27 from 145 days in Q4 FY26, management said.', 'Concall transcript Aug 2026', 'days')]);
    assert.equal(up[0].verdict, 'deteriorating');
  });

  test('EXICOM — a growth rate off a loss base and a double-negative cash ratio are shown, not judged; a QoQ margin move is not counted', () => {
    const graded = { source: 'screener', sales_yoy_pct: 61.25, net_profit_yoy_pct: -3.43, opm_pct: -6.61, opm_change_pp_qoq: -6.7, cfo_to_pat_ratio: 0.32 };
    const vars = extractVariables(graded, null);
    const eg = vars.find((v) => v.key === 'earnings_growth')!;
    assert.equal(eg.verdict, 'stated', 'disclosed, shown, not judged'); assert.match(eg.unjudged!, /loss base/);
    const cc = vars.find((v) => v.key === 'cash_conversion')!;
    assert.equal(cc.verdict, 'stated'); assert.ok(cc.unjudged);
    const m = vars.find((v) => v.key === 'margin')!;
    assert.equal(m.verdict, 'stated'); assert.equal(m.delta, '-6.7pp QoQ'); assert.match(m.unjudged!, /sequential/);
    assert.equal(vars.filter((v) => v.key === 'operating_leverage').length, 0, 'no leverage ratio on a loss base');
    const a = assessThesis({ pattern: null, evidenceReviewed: true, hasGraderRow: true, variables: vars as any });
    assert.notEqual(a.status, 'WEAKENING');
    assert.match(a.because, /not read either way/);
  });

  test('LUMAXTECH — PAT growth is quoted before EPS growth; a ₹3 Cr one-off on ₹99 Cr PAT is immaterial', () => {
    const graded = { source: 'graded', sales_yoy_pct: 32.9, net_profit_yoy_pct: 83.3, eps_yoy_pct: 109.0, pat_curr_cr: 99, pat_prev_cr: 54, opm_pct: 14, opm_prev_pct: 12, cfo_to_pat_ratio: 4.65 };
    const summary = { one_offs: [{ item: 'Tooling revenue in Greenfuel', amount: 'around INR 3 crore', direction: 'gain', recurring: 'will_not_recur' }] };
    const vars = extractVariables(graded, summary);
    const eg = vars.find((v) => v.key === 'earnings_growth')!;
    assert.equal(eg.delta, '+83.3%'); assert.equal(eg.before, '54 Cr'); assert.equal(eg.after, '99 Cr');
    const oo = vars.find((v) => v.key === 'one_offs')!;
    assert.equal(oo.verdict, 'flat'); assert.match(oo.evidence, /3% of reported profit/);
    // A material gain still counts.
    const big = extractVariables(graded, { one_offs: [{ item: 'Land sale', amount: 'INR 40 crore', direction: 'gain' }] }).find((v) => v.key === 'one_offs')!;
    assert.equal(big.verdict, 'deteriorating');
    // An unsized gain is shown, not judged.
    const unsized = extractVariables(graded, { one_offs: [{ item: 'Insurance claim', amount: '', direction: 'gain' }] }).find((v) => v.key === 'one_offs')!;
    assert.equal(unsized.verdict, 'stated'); assert.ok(unsized.unjudged);
  });

  test('the margin bridge prints its unit: a bare "-1.43" in opm_change_pp is pp', () => {
    const m = extractVariables(null, { margin_bridge: { opm_change_pp: '-1.43', drivers: [] } }).find((v) => v.key === 'margin')!;
    assert.equal(m.delta, '-1.43pp');
  });

  test('recent reporters — a results filing counts, an intimation does not; read-since-filing is current, read-before is due', () => {
    assert.equal(isResultsFiling('Outcome of Board Meeting - Financial Results for Q2 FY27'), true);
    assert.equal(isResultsFiling('Prior intimation of Board Meeting to consider financial results'), false);
    assert.equal(isResultsFiling('Investor Presentation Q2 FY27'), true);
    const items = [
      { symbol: 'AAA', subject: 'Financial Results for the quarter ended 30 September 2026', filing_date: '2026-10-20T15:00:00' },
      { symbol: 'AAA', subject: 'Intimation of board meeting', filing_date: '2026-10-12' },
      { symbol: 'BBB', subject: 'Investor Presentation', filing_date: '2026-10-18' },
      { symbol: 'CCC', subject: 'Financial Results', filing_date: '2026-09-30' },   // outside the window
      { symbol: 'DDD', subject: 'Financial Results', filing_date: '2026-10-19' },
    ];
    const reported = reportedInWindow(items as any, ['AAA', 'BBB', 'CCC', 'DDD', 'EEE'], '2026-10-11');
    assert.deepEqual(reported.map((r) => [r.ticker, r.reported_at]), [['AAA', '2026-10-20'], ['DDD', '2026-10-19'], ['BBB', '2026-10-18']]);
    const L = (last: string | null, doc: string | null): any => ({ last_evidence_read_at: last, latest_document_date: doc });
    const plan = planRecentReads(reported, {
      AAA: L('2026-10-21T09:00:00Z', '2026-10-20'),   // read after the filing → current
      BBB: L('2026-10-15T09:00:00Z', '2026-08-01'),   // read inside the window but BEFORE the filing → due
      DDD: L(null, null),                              // never read → due
    }, 5, 10, '2026-10-11');
    assert.deepEqual(plan.due.map((d) => d.ticker), ['DDD', 'BBB']);
    assert.deepEqual(plan.current.map((d) => d.ticker), ['AAA']);
    assert.equal(plan.not_reported, 2);
    assert.match(plan.due.find((d) => d.ticker === 'BBB')!.because, /before the 2026-10-18 filing/);
  });
});
