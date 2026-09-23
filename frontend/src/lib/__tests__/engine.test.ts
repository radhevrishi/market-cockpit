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
    assert.equal(m.delta, '-1.4pp');
  });

  test('recent reporters — a results filing counts, an intimation does not; read-since-filing is current, read-before is due', () => {
    assert.equal(isResultsFiling('Outcome of Board Meeting - Financial Results for Q2 FY27'), true);
    assert.equal(isResultsFiling('Prior intimation of Board Meeting to consider financial results'), false);
    assert.equal(isResultsFiling('Investor Presentation Q2 FY27'), true);
    // Results off-season: an AGM outcome and a bare deck are not results.
    assert.equal(isResultsFiling('Outcome of Board Meeting'), false);
    assert.equal(isResultsFiling('Outcome of Board Meeting held on 20 September 2026 - Fund raising'), false);
    assert.equal(isResultsFiling('Investor Presentation'), false);
    assert.equal(isResultsFiling('Outcome of Board Meeting - Unaudited results for quarter ended 30 September 2026'), true);
    const items = [
      { symbol: 'AAA', subject: 'Financial Results for the quarter ended 30 September 2026', filing_date: '2026-10-20T15:00:00' },
      { symbol: 'AAA', subject: 'Intimation of board meeting', filing_date: '2026-10-12' },
      { symbol: 'BBB', subject: 'Investor Presentation Q2 FY27', filing_date: '2026-10-18' },
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

// ═══════════════════════════════════════════════════════════════════════════
// zzz764 — live screener.in rows, unit rules, results-only reporters.
import { parseSection, financialsFromHtml, isCurrentPeriod } from '../thesis/screener-financials';

describe('zzz764 screener.in live financials', () => {
  const tbl = (id: string, head: string[], rows: Array<[string, string[]]>) =>
    `<section id="${id}"><table><tr><th></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` +
    rows.map(([l, v]) => `<tr><td>${l} +</td>${v.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('') + `</table></section>`;
  const html =
    tbl('quarters', ['Jun 2025', 'Sep 2025', 'Dec 2025', 'Mar 2026', 'Jun 2026'], [
      ['Sales', ['100', '110', '120', '130', '150']],
      ['OPM %', ['10%', '11%', '12%', '13%', '14%']],
      ['Net Profit', ['-5', '8', '9', '10', '12']],
      ['EPS in Rs', ['2.00', '2.5', '2.6', '2.8', '3.00']],
    ]) +
    tbl('profit-loss', ['Mar 2025', 'Mar 2026'], [['Net Profit', ['20', '40']]]) +
    tbl('cash-flow', ['Mar 2025', 'Mar 2026'], [['Cash from Operating Activity', ['10', '30']]]);

  test('parses section rows with the trailing "+" stripped', () => {
    const t = parseSection(html, 'quarters')!;
    assert.deepEqual(t.headers.slice(-1), ['Jun 2026']);
    assert.deepEqual(t.rows['Sales'], [100, 110, 120, 130, 150]);
  });
  test('year-on-year against the quarter four columns back; loss base → null growth', () => {
    const r = financialsFromHtml('abc', html, 'consolidated', 'u')!;
    assert.equal(r.period, 'Jun 2026');
    assert.equal(r.comparison_period, 'Jun 2025');
    assert.equal(r.sales_yoy_pct, 50);
    assert.equal(r.opm_pct, 14);
    assert.equal(r.opm_prev_pct, 10);
    assert.equal(r.pat_prev_cr, -5);
    assert.equal(r.net_profit_yoy_pct, null);         // never a growth rate off a loss
    assert.equal(r.eps_yoy_pct, 50);
    assert.equal(r.cfo_to_pat_ratio, 0.75);           // same year: 30/40
    assert.equal(r.cfo_year, 'Mar 2026');
  });
  test('no quarterly table → null', () => {
    assert.equal(financialsFromHtml('abc', '<html></html>', 'standalone', 'u'), null);
  });
  test('stale pages are never "this quarter"', () => {
    const now = new Date('2026-09-22T00:00:00Z');
    assert.equal(isCurrentPeriod('Jun 2026', now), true);
    assert.equal(isCurrentPeriod('Dec 2020', now), false);
    assert.equal(isCurrentPeriod(null, now), false);
  });
});

describe('zzz764 results-only recent reporters', () => {
  test('bare AGM / fund-raise board outcomes do not count; results do', () => {
    assert.equal(isResultsFiling('Outcome of Board Meeting'), false);
    assert.equal(isResultsFiling('Outcome of Board Meeting - Fund raising by QIP'), false);
    assert.equal(isResultsFiling('Investor Presentation'), false);
    assert.equal(isResultsFiling('Outcome of Board Meeting - Unaudited results for quarter ended June 30, 2026'), true);
    assert.equal(isResultsFiling('Financial Results'), true);
    assert.equal(isResultsFiling('Intimation of board meeting to consider financial results'), false);
  });
});

describe('zzz764 unit arithmetic', () => {
  test('identical before/after is not a move', () => {
    assert.equal(ledgerDeltaOf('45%', '45%', '%'), null);
  });
  test('scaledNumber does not read digits glued to letters', () => {
    assert.equal(scaledNumber('FY26'), null);
    assert.equal(scaledNumber('₹85 Cr'), 85e7);            // crore applied
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz765 — PRIOR-QUARTER BACKFILL. The previous quarter's documents were
// already listed in the one period on file, unread. Reading them as their own
// period is what gives buildComparisons a "before".
// ═══════════════════════════════════════════════════════════════════════════
import {
  previousPeriod, selectPriorPeriodDocuments, priorBackfillPlan, priorBackfillTickers, isOlderPeriod, ledgerDocuments,
} from '../thesis/prior-period';

describe('zzz765 prior-quarter backfill', () => {
  const now = '2026-09-22T10:00:00.000Z';
  const later = '2026-09-22T11:00:00.000Z';
  const doc = (url: string, label: string, kind: string, date: string, outcome = 'read'): any =>
    ({ id: documentId(url), url, label, kind, source: 'screener.in company page', period: null, date_iso: date, outcome, chars: 40000, pages: 20 });
  const ev = (variable: string, after: string, unit: string | null, source: string, text: string): any =>
    ({ variable, value_type: 'ACTUAL', before: null, after, unit, period: null, direction: 'up', evidence_text: text, source, confidence: 'HIGH' });
  const periodOf = (ticker: string, docs: any[], events: any[], runId: string, at = now) => {
    const rp = reportingPeriodForDocuments(docs);
    const { facts, events: evs } = factsFromEvents(ticker, rp.period, events, docs, at);
    const read = docs.filter((d) => d.outcome === 'read').length;
    return {
      period: {
        reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date,
        documents: docs, documents_found: docs.length, documents_read: read, documents_failed: 0, documents_skipped: docs.length - read,
        facts, events: evs, summary: { events }, status: null, status_because: null, tallies: null,
        discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: runId, prompt_version: 'india-ai-summary-v9', model: 'm',
        extracted_at: at, updated_at: at,
      } as any,
      run: { run_id: runId, reporting_period: rp.period, started_at: at, finished_at: at, outcome: 'COMPLETED', error: null,
        documents_found: docs.length, documents_read: read, facts_extracted: facts.length, events_extracted: evs.length,
        model: 'm', prompt_version: 'india-ai-summary-v9' } as any,
    };
  };

  // E2E-shaped: Q1 FY27 read from the Jul 2026 transcript + presentation; the
  // Apr 2026 (Q4 FY26) transcript and presentation are listed, not_selected.
  const q1Docs = [
    doc('https://x/e2e-tr-jul26.pdf', 'Concall transcript Jul 2026', 'transcript', '2026-07-01'),
    doc('https://x/e2e-ip-jul26.pdf', 'Investor presentation Jul 2026', 'investor_presentation', '2026-07-01'),
    doc('https://x/e2e-tr-apr26.pdf', 'Concall transcript Apr 2026', 'transcript', '2026-04-01', 'not_selected'),
    doc('https://x/e2e-ip-apr26.pdf', 'Investor presentation Apr 2026', 'investor_presentation', '2026-04-01', 'not_selected'),
    doc('https://x/e2e-tr-jan26.pdf', 'Concall transcript Jan 2026', 'transcript', '2026-01-01', 'not_selected'),
    doc('https://x/e2e-ar-26.pdf', 'Annual Report 2026', 'annual_report', '2026-05-01', 'not_selected'),
  ];
  const q1Only = () => {
    const a = periodOf('E2E', q1Docs, [
      ev('utilisation', '80%', '%', 'Concall transcript Jul 2026', 'Capacity utilisation improved to 80% during the quarter on the new data-centre load.'),
    ], 'r1');
    return mergePeriod(emptyLedger('E2E', 'IN', now), a.period, a.run);
  };
  const q4Backfill = (runId: string, at = later) => {
    const q4Docs = selectPriorPeriodDocuments(ledgerDocuments(q1Only()), 'Q4 FY26').map((d) => ({ ...d, outcome: 'read' }));
    return periodOf('E2E', q4Docs, [
      ev('utilisation', '72%', '%', 'Concall transcript Apr 2026', 'Capacity utilisation for the quarter was 72% across the facilities.'),
      ev('order_book', 'INR 500 crores', 'crores', 'Investor presentation Apr 2026', 'The closing order book stood at INR 500 crores as at the end of the quarter.'),
    ], runId, at);
  };

  test('the period before: Q1 FY27 → Q4 FY26, Q3 FY27 → Q2 FY27', () => {
    assert.equal(previousPeriod('Q1 FY27'), 'Q4 FY26');
    assert.equal(previousPeriod('Q3 FY27'), 'Q2 FY27');
    assert.equal(previousPeriod('UNDATED'), null);
    assert.equal(isOlderPeriod('Q4 FY26', 'Q1 FY27'), true);
    assert.equal(isOlderPeriod('Q1 FY27', 'Q1 FY27'), false, 'a period read may never target the current period');
  });

  test('pure selection: only documents that resolve to the prior quarter, transcript → presentation → results', () => {
    const pick = selectPriorPeriodDocuments([
      ...q1Docs,
      { ...doc('https://x/e2e-res-may26.pdf', 'Financial results', 'results', '2026-05-14', 'not_selected') },
      { ...doc('https://x/e2e-tr-apr26.pdf', 'dup', 'transcript', '2026-04-01', 'not_selected') },
    ], 'Q4 FY26');
    assert.deepEqual(pick.map((d) => d.kind), ['transcript', 'investor_presentation', 'results']);
    assert.ok(pick.every((d) => reportingPeriodFromDate(d.date_iso)?.period === 'Q4 FY26'));
    assert.ok(!pick.some((d) => d.kind === 'annual_report'), 'annual reports are not read for a prior quarter');
    // Works on discovery candidates (dateIso) too — the route's pool.
    const cand = selectPriorPeriodDocuments([{ url: 'u1', kind: 'transcript', dateIso: '2026-05-20' }, { url: 'u2', kind: 'transcript', dateIso: '2026-08-02' }], 'Q4 FY26');
    assert.deepEqual(cand.map((c) => c.url), ['u1']);
  });

  test('plan: a one-period ledger with a listed prior-quarter document is counted', () => {
    const plan = priorBackfillPlan(q1Only());
    assert.ok(plan);
    assert.equal(plan!.target, 'Q4 FY26');
    assert.equal(plan!.latest, 'Q1 FY27');
    assert.equal(plan!.candidates[0].label, 'Concall transcript Apr 2026');
  });

  test('Q1 FY27 plus a backfilled Q4 FY26: both periods kept, latest stays Q1 FY27, and a previous value appears', () => {
    const base = q1Only();
    const before = buildComparisons(base).utilisation!;
    assert.equal(before.previous, null, 'one period: no previous');
    const b = q4Backfill('r2');
    assert.equal(b.period.reporting_period, 'Q4 FY26', 'the backfilled documents resolve to the prior quarter by the store rule');
    const l = mergePeriod(base, b.period, b.run);
    assert.deepEqual(Object.keys(l.periods).sort(), ['Q1 FY27', 'Q4 FY26']);
    assert.equal(l.latest_period, 'Q1 FY27');
    assert.equal(l.latest_document_date, '2026-07-01');
    assert.deepEqual(l.periods['Q1 FY27'], base.periods['Q1 FY27'], 'the current period is untouched');
    assert.equal(l.last_evidence_read_at, base.last_evidence_read_at, 'a backfill is not a read of the current evidence');
    const u = buildComparisons(l).utilisation!;
    assert.equal(u.current!.raw, '80%');
    assert.equal(u.previous!.raw, '72%');
    assert.equal(u.previous_period, 'Q4 FY26');
    assert.equal(u.change, '+8pp');
    assert.equal(priorBackfillPlan(l), null, 'once backfilled it is no longer counted');
  });

  test('running the backfill twice adds no duplicate facts or events', () => {
    const b1 = q4Backfill('r2');
    const once = mergePeriod(q1Only(), b1.period, b1.run);
    const b2 = q4Backfill('r3', '2026-09-22T12:00:00.000Z');
    const twice = mergePeriod(once, b2.period, b2.run);
    const p1 = once.periods['Q4 FY26'], p2 = twice.periods['Q4 FY26'];
    assert.equal(p2.facts.length, p1.facts.length);
    assert.equal(p2.events.length, p1.events.length);
    assert.equal(new Set(p2.facts.map((f) => f.id)).size, p2.facts.length);
    assert.equal(new Set(p2.events.map((e) => e.id)).size, p2.events.length);
    assert.equal(new Set(p2.documents.map((d) => d.id)).size, p2.documents.length);
    assert.equal(twice.periods['Q1 FY27'].facts.length, once.periods['Q1 FY27'].facts.length);
    assert.equal(twice.latest_period, 'Q1 FY27');
  });

  test('no prior-quarter document on file → not counted in N; NO_DISCLOSURE is final, SOURCE_UNAVAILABLE retried and not shown as the current period down', () => {
    const noPrior = (() => {
      const a = periodOf('GPPL', [
        doc('https://x/g-tr-aug26.pdf', 'Concall transcript Aug 2026', 'transcript', '2026-08-01'),
        doc('https://x/g-tr-feb26.pdf', 'Concall transcript Feb 2026', 'transcript', '2026-02-01', 'not_selected'),
      ], [ev('utilisation', '80%', '%', 'Concall transcript Aug 2026', 'Capacity utilisation was 80% for the quarter.')], 'g1');
      return mergePeriod(emptyLedger('GPPL', 'IN', now), a.period, a.run);
    })();
    assert.equal(priorBackfillPlan(noPrior), null);
    assert.deepEqual(priorBackfillTickers({ E2E: q1Only(), GPPL: noPrior, NEW: null }), ['E2E']);

    const failedRun = (outcome: any, id: string): any => ({ run_id: id, reporting_period: 'Q4 FY26', started_at: later, finished_at: later, outcome,
      error: outcome === 'SOURCE_UNAVAILABLE' ? 'screener.in company page could not be reached' : null,
      documents_found: 0, documents_read: 0, facts_extracted: 0, events_extracted: 0, model: null, prompt_version: null });
    const nd = recordAttempt(q1Only(), failedRun('NO_DISCLOSURE', 'x1'));
    assert.equal(priorBackfillPlan(nd), null, 'a quarter already found empty is not queued again');
    const su = recordAttempt(q1Only(), failedRun('SOURCE_UNAVAILABLE', 'x2'));
    assert.ok(priorBackfillPlan(su), 'our outage stays eligible for a later click');
    assert.notEqual(freshnessOf(su).state, 'SOURCE_UNAVAILABLE', 'a failed prior-quarter read does not mark the current period unavailable');
    assert.equal(su.latest_period, 'Q1 FY27');
    assert.deepEqual(Object.keys(su.periods), ['Q1 FY27']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz765 — REPORTING-PERIOD INTELLIGENCE, RETRIEVAL ≠ DISCLOSURE, OCR.
//
// CUPID sat at Q4 FY26 on 22 September with Q1 FY27 results filed on 7 Aug;
// IFBAGRO-BE never matched its own exchange filings; AETHER's failed
// presentation was not replaced; MOREPENLAB/SOTL scans were dead ends.
// ═══════════════════════════════════════════════════════════════════════════
import { latestExpectedPeriod, freshnessLine, type PeriodRecord, type EvidenceRun } from '../thesis/evidence-ledger';
import { attemptOutcome, nextBestCandidate, candidatesFromBse } from '../thesis/evidence-discovery';
import { pdfTextQuality, ocrRequestBody, OCR_MAX_TOKENS } from '../thesis/pdf-ocr';
import { feedDateIso, bareSymbol } from '../thesis/filing-dates';
import { parseBseCode } from '../earnings/screener-documents';

describe('zzz765 reporting-period freshness, retrieval failure, OCR', () => {
  const at = '2026-09-22T12:00:00.000Z';
  const period = (p: string, pe: string, docDate: string): PeriodRecord => ({
    reporting_period: p, period_end_date: pe, latest_document_date: docDate,
    documents: [{ id: documentId('https://x/' + p), url: 'https://x/' + p, label: 'Investor presentation', kind: 'investor_presentation', source: 's', period: null, date_iso: docDate, outcome: 'read' }],
    documents_found: 1, documents_read: 1, documents_failed: 0, documents_skipped: 0, facts: [], events: [], summary: { verdict_line: 'x' },
    status: null, status_because: null, tallies: null, discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [],
    run_id: 'r-' + p, prompt_version: 'v', model: null, extracted_at: at, updated_at: at,
  });
  const run = (id: string, finished = at): EvidenceRun => ({
    run_id: id, reporting_period: null, started_at: finished, finished_at: finished, outcome: 'COMPLETED', error: null,
    documents_found: 1, documents_read: 1, facts_extracted: 0, events_extracted: 0, model: null, prompt_version: null,
  });
  const cupid = () => mergePeriod(emptyLedger('CUPID', 'IN', at), period('Q4 FY26', '2026-03-31', '2026-05-01'), run('r1'));

  test('latestExpectedPeriod: 45 days after Q1–Q3, 60 after Q4', () => {
    const cases: Array<[string, string]> = [
      ['2026-09-22', 'Q1 FY27'],   // Jun 30 + 45 = Aug 14 has passed
      ['2026-08-13', 'Q4 FY26'],   // one day short of Q1 being due
      ['2026-08-14', 'Q1 FY27'],
      ['2026-05-29', 'Q3 FY26'],   // Mar 31 + 60 = May 30 not yet
      ['2026-05-30', 'Q4 FY26'],
      ['2026-11-14', 'Q2 FY27'],
      ['2027-01-05', 'Q2 FY27'],   // Q3 not due until Feb 14
      ['2027-02-14', 'Q3 FY27'],
    ];
    for (const [d, want] of cases) assert.equal(latestExpectedPeriod(`${d}T06:00:00Z`).period, want, d);
    assert.equal(latestExpectedPeriod('2026-09-22T00:00:00Z').due_date, '2026-08-14');
  });

  test('Q4 FY26 evidence when Q1 FY27 is expected and nothing newer is seen → STALE_NO_NEWER_FILING', () => {
    const f = freshnessOf(cupid(), '2026-09-22T12:00:00Z');
    assert.equal(f.staleness, 'STALE_NO_NEWER_FILING');
    assert.equal(f.state, 'STALE');
    assert.equal(f.latest_known_period, 'Q4 FY26');
    assert.equal(f.latest_expected_period, 'Q1 FY27');
    assert.equal(f.latest_source_date, '2026-05-01');
    assert.equal(f.new_evidence_available, false);
    const line = freshnessLine(f)!;
    assert.equal(line.label, 'STALE');
    assert.equal(line.text, 'Last evidence: Q4 FY26 · Latest expected: Q1 FY27 · No newer filing found');
  });

  test('a newer document seen at a source → UPDATE_AVAILABLE, not stale', () => {
    const l = recordSeen(cupid(), '2026-08-07', at);
    const f = freshnessOf(l, '2026-09-22T12:00:00Z');
    assert.equal(f.staleness, 'UPDATE_AVAILABLE');
    assert.equal(f.state, 'NEW_EVIDENCE_AVAILABLE');
    assert.equal(f.new_evidence_available, true);
    assert.equal(freshnessLine(f)!.label, '↻ Update available');
  });

  test('the expected period on file → CURRENT; a stale ledger never searched says so', () => {
    const q1 = mergePeriod(emptyLedger('AETHER', 'IN', at), period('Q1 FY27', '2026-06-30', '2026-08-01'), run('r1'));
    assert.equal(freshnessOf(q1, '2026-09-22T12:00:00Z').staleness, 'CURRENT');
    const old = mergePeriod(emptyLedger('X', 'IN', '2026-06-01T00:00:00Z'), period('Q4 FY26', '2026-03-31', '2026-05-01'), run('r0', '2026-06-01T00:00:00.000Z'));
    const f = freshnessOf(old, '2026-09-22T12:00:00Z');
    assert.equal(f.staleness, 'STALE_NO_NEWER_FILING');
    assert.equal(f.checked_since_due, false);
    assert.match(freshnessLine(f)!.text, /not searched since it fell due/);
  });

  test('HTTP 504 from screener.in with nothing else found → SOURCE_UNAVAILABLE, never NO_DISCLOSURE', () => {
    const attempts = [
      { source: 'exchange filing feed', outcome: 'empty' as const, detail: 'rolling window', found: 0 },
      { source: 'screener.in company page', outcome: 'error' as const, detail: 'HTTP 504 — upstream timed out', found: 0 },
      { source: 'BSE corporate announcements', outcome: 'empty' as const, detail: 'none', found: 0 },
    ];
    assert.equal(resolveDiscovery('CUPID', [], attempts).state, 'RETRIEVAL_FAILED');
    assert.equal(attemptOutcome(attempts, []), 'SOURCE_UNAVAILABLE');
    // every source answered, nothing there: that alone is a disclosure fact
    assert.equal(attemptOutcome(attempts.map((a) => ({ ...a, outcome: 'empty' as const })), []), 'NO_DISCLOSURE');
    // a document we could not download or OCR is our failure too
    assert.equal(attemptOutcome([{ outcome: 'found' }], [{ outcome: 'download_failed' }]), 'SOURCE_UNAVAILABLE');
    assert.equal(attemptOutcome([{ outcome: 'found' }], [{ outcome: 'scanned' }]), 'SOURCE_UNAVAILABLE');
    assert.equal(attemptOutcome([{ outcome: 'found' }], [{ outcome: 'too_short' }]), 'NO_DISCLOSURE');
    // and the card reads SOURCE UNAVAILABLE over the evidence it keeps
    const l = recordAttempt(cupid(), { ...run('r9', '2026-09-22T13:00:00.000Z'), outcome: 'SOURCE_UNAVAILABLE', error: 'screener.in HTTP 504', documents_read: 0 });
    const f = freshnessOf(l, '2026-09-22T14:00:00Z');
    assert.equal(f.staleness, 'SOURCE_UNAVAILABLE');
    assert.match(freshnessLine(f)!.text, /not a disclosure gap/);
  });

  test('scanned-PDF detection', () => {
    assert.equal(pdfTextQuality(310, 32), 'scanned', 'MOREPENLAB: 32 pages, ~10 chars a page');
    assert.equal(pdfTextQuality(150, 2), 'scanned');
    assert.equal(pdfTextQuality(700, 1), 'too_short', 'a one-page intimation is not a scan');
    assert.equal(pdfTextQuality(42_000, 24), 'ok');
    assert.equal(pdfTextQuality(80_000, 900), 'ok', 'a truncated long annual report is not a scan');
    const noise = Array.from({ length: 800 }, (_, i) => `x${i}#Q~z@${i % 7}&`).join(' ');
    assert.equal(pdfTextQuality(noise.length, 0, noise), 'scanned', 'raw-byte fallback text is not language');
    const prose = 'Revenue from operations for the quarter ended June 30, 2026 was Rs 61 crore, up 18% on the corresponding quarter. '.repeat(20);
    assert.equal(pdfTextQuality(prose.length, 1, prose), 'ok');
  });

  test('the OCR request is a native base64 PDF document block with capped output', () => {
    const b = ocrRequestBody('claude-haiku-4-5-20251001', 'JVBERi0x', 'Financial results');
    assert.equal(b.max_tokens, OCR_MAX_TOKENS);
    const doc = (b.messages[0].content as any[])[0];
    assert.deepEqual(doc, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERi0x' } });
  });

  test('exchange feed dates and series-suffixed symbols are read', () => {
    assert.equal(feedDateIso('22-Sep-2026 18:47:27'), '2026-09-22');
    assert.equal(feedDateIso('2026-08-07T18:32:07.767'), '2026-08-07');
    assert.equal(feedDateIso('07/08/2026'), '2026-08-07');
    assert.equal(feedDateIso('', 'https://nsearchives.nseindia.com/corporate/CUPID_22092026184721_SE_PR.pdf'), '2026-09-22');
    assert.equal(feedDateIso('garbage'), null);
    assert.equal(bareSymbol('ifbagro-be'), 'IFBAGRO');
    const got = candidatesFromFilings([{ symbol: 'IFBAGRO', subject: 'Financial Results', attachment_url: 'https://x/ifb.pdf', filing_date: '27-Jul-2026 18:07:03' }], 'IFBAGRO-BE');
    assert.equal(got.length, 1);
    assert.equal(got[0].dateIso, '2026-07-27');
    const rep = reportedInWindow([{ symbol: 'IFBAGRO', subject: 'Financial Results', filing_date: '27-Jul-2026 18:07:03' }], ['IFBAGRO-BE'], '2026-07-20');
    assert.deepEqual(rep.map((r) => [r.ticker, r.reported_at]), [['IFBAGRO-BE', '2026-07-27']]);
  });

  test('BSE announcements: the Q1 FY27 results PDF is found, SAST and intimations are not', () => {
    const rows = [
      { NEWSSUB: 'Un-Audited Financial Results (Standalone And Consolidated) For The Quarter Ended June 30, 2026', NEWS_DT: '2026-08-07T18:32:07.767', CATEGORYNAME: 'Result', SUBCATNAME: 'Financial Results', ATTACHMENTNAME: 'e1f389be.pdf', PDFFLAG: 1 },
      { NEWSSUB: 'Board Meeting Intimation for Un-Audited Financial Results', NEWS_DT: '2026-08-04T16:39:34', CATEGORYNAME: 'Board Meeting', ATTACHMENTNAME: 'intim.pdf', PDFFLAG: 1 },
      { NEWSSUB: 'Disclosures under Reg. 29(2) of SEBI (SAST) Regulations, 2011', NEWS_DT: '2026-09-22T10:45:36', CATEGORYNAME: 'Insider Trading / SAST', ATTACHMENTNAME: 'sast.pdf', PDFFLAG: 0 },
      { NEWSSUB: 'Announcement under Regulation 30 (LODR)-Press Release / Media Release', NEWS_DT: '2026-09-22T18:45:54', CATEGORYNAME: 'Company Update', ATTACHMENTNAME: 'pr.pdf', PDFFLAG: 0 },
    ];
    const c = candidatesFromBse(rows);
    assert.deepEqual(c.map((x) => x.url), [
      'https://www.bseindia.com/xml-data/corpfiling/AttachHis/e1f389be.pdf',
      'https://www.bseindia.com/xml-data/corpfiling/AttachLive/pr.pdf',
    ]);
    assert.equal(c[0].kind, 'results');
    assert.equal(c[0].dateIso, '2026-08-07');
    // the statement of results outranks the later press release
    const ranked = rankCandidates(c, '2026-09-22');
    assert.match(ranked[0].label, /Financial Results/);
    // and with no filing-date hint, a 2024 transcript is not "latest evidence"
    const withOld = resolveDiscovery('CUPID', [...c, { url: 't24', kind: 'transcript', tier: 2, source: 's', period: null, dateIso: '2024-01-01', label: 'Concall Jan 2024' }],
      [{ source: 'BSE corporate announcements', outcome: 'found', detail: '', found: 2 }]);
    assert.notEqual(withOld.candidates[0].url, 't24');
    assert.equal(parseBseCode('<a href="https://www.bseindia.com/stock-share-price/cupid-ltd/CUPID/530843/">BSE: 530843</a>'), '530843');
  });

  test('a failed download is replaced by the next-best document of the same period', () => {
    const c = (url: string, kind: any, dateIso: string) => ({ url, kind, tier: 1 as const, source: 's', period: null, dateIso, label: url });
    const ranked = [
      c('t-aug', 'transcript', '2026-08-01'), c('p-aug', 'investor_presentation', '2026-08-01'),
      c('ar-26', 'annual_report', '2026-04-01'), c('p-jul', 'investor_presentation', '2026-07-01'),
      c('p-may', 'investor_presentation', '2026-05-01'),
    ];
    const tried = new Set(['t-aug', 'p-aug', 'ar-26']);
    assert.equal(nextBestCandidate(ranked, ranked[1], tried)!.url, 'p-jul', 'same kind, same quarter (Q1 FY27)');
    tried.add('p-jul');
    assert.equal(nextBestCandidate(ranked, ranked[1], tried), null, 'never a different quarter');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz765 — THE QUARTERLY LEDGER: typed facts, before → after, plan beside
// actual, historical context, capex lifecycle across quarters.
// ═══════════════════════════════════════════════════════════════════════════
import { normalizeEvent, guidanceMove, gapToTarget, historicalAsOf, periodEnd, periodStart, rangeOf } from '../thesis/fact-normalize';
import { capexLifecycle, buildCapexChain } from '../thesis/capex-chain';

describe('zzz765 quarterly thesis ledger', () => {
  const T0 = '2026-09-22T00:00:00Z';
  const D = (url: string, label: string, kind: string, date: string): any =>
    ({ id: documentId(url), url, label, kind, source: 'screener', period: null, date_iso: date, outcome: 'read' });
  const E = (variable: string, value_type: string, before: string | null, after: string, source: string, text: string): any =>
    ({ variable, value_type, before, after, unit: null, period: null, direction: 'unknown', evidence_text: text, source, confidence: 'HIGH' });
  const P = (ticker: string, docs: any[], events: any[], runId: string) => {
    const rp = reportingPeriodForDocuments(docs);
    const { facts, events: evs } = factsFromEvents(ticker, rp.period, events, docs, T0);
    return {
      period: {
        reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date,
        documents: docs, documents_found: docs.length, documents_read: docs.length, documents_failed: 0, documents_skipped: 0,
        facts, events: evs, summary: { events }, status: null, status_because: null, tallies: null,
        discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: runId, prompt_version: 'v9', model: 'm',
        extracted_at: T0, updated_at: T0,
      } as any,
      run: { run_id: runId, reporting_period: rp.period, started_at: T0, finished_at: T0, outcome: 'COMPLETED', error: null,
        documents_found: docs.length, documents_read: docs.length, facts_extracted: facts.length, events_extracted: evs.length,
        model: 'm', prompt_version: 'v9' } as any,
    };
  };
  const q4 = [D('https://x/q4.pdf', 'Concall transcript May 2026', 'transcript', '2026-05-20')];
  const q1 = [D('https://x/q1.pdf', 'Concall transcript Aug 2026', 'transcript', '2026-08-10')];
  const q2 = [D('https://x/q2.pdf', 'Concall transcript Nov 2026', 'transcript', '2026-11-10')];
  const ledgerOf = (...ps: Array<ReturnType<typeof P>>) => ps.reduce((l, p) => mergePeriod(l, p.period, p.run), emptyLedger('ABC', 'IN', T0));

  test('utilisation 72 → 80 across periods is +8pp; 80 → 80 is UNCHANGED (flat), not a new level', () => {
    const up = buildComparisons(ledgerOf(
      P('ABC', q4, [E('utilisation', 'ACTUAL', null, '72%', 'Concall transcript May 2026', 'Capacity utilisation for the quarter was 72%.')], 'a'),
      P('ABC', q1, [E('utilisation', 'ACTUAL', null, '80%', 'Concall transcript Aug 2026', 'Capacity utilisation for the quarter was 80%.')], 'b'),
    )).utilisation!;
    assert.equal(up.change, '+8pp'); assert.equal(up.change_type, 'INCREASED');
    const flat = buildComparisons(ledgerOf(
      P('ABC', q4, [E('utilisation', 'ACTUAL', null, '80%', 'Concall transcript May 2026', 'Capacity utilisation for the quarter was 80%.')], 'a'),
      P('ABC', q1, [E('utilisation', 'ACTUAL', null, '80%', 'Concall transcript Aug 2026', 'Capacity utilisation for the quarter was 80%.')], 'b'),
    )).utilisation!;
    assert.equal(flat.change_type, 'UNCHANGED');
    assert.equal(flat.previous!.raw, '80%');
  });

  test('capacity 100,000 → 125,000 TPA is +25%; order book ₹1,200 → ₹1,560 Cr is +30%', () => {
    const c = buildComparisons(ledgerOf(
      P('ABC', q4, [
        E('capacity', 'ACTUAL', null, '100,000 TPA', 'Concall transcript May 2026', 'At the end of the quarter our installed capacity stood at 100,000 TPA across both plants, management said on the call.'),
        E('order_book', 'ACTUAL', null, '₹1,200 Cr', 'Concall transcript May 2026', 'At the end of the quarter the closing order book stood at ₹1,200 Cr, executable over the next eighteen months, management said.'),
      ], 'a'),
      P('ABC', q1, [
        E('capacity', 'ACTUAL', null, '125,000 TPA', 'Concall transcript Aug 2026', 'At the end of the quarter our installed capacity stood at 125,000 TPA across both plants, management said on the call.'),
        E('order_book', 'ACTUAL', null, '₹1,560 Cr', 'Concall transcript Aug 2026', 'At the end of the quarter the closing order book stood at ₹1,560 Cr, executable over the next eighteen months, management said.'),
      ], 'b'),
    ));
    assert.match(String(c.capacity!.change), /\+25(\.0)?%/);
    assert.match(String(c.order_book!.change), /\+30(\.0)?%/);
  });

  test('a single period never invents a previous value', () => {
    const c = buildComparisons(ledgerOf(P('ABC', q1, [E('utilisation', 'ACTUAL', null, '80%', 'Concall transcript Aug 2026', 'Capacity utilisation for the quarter was 80%.')], 'b'))).utilisation!;
    assert.equal(c.previous, null); assert.equal(c.change, null); assert.equal(c.change_type, 'NEW');
  });

  test('guidance ledger: 20–25% → 25–30% RAISED; same range MAINTAINED; across periods', () => {
    assert.equal(guidanceMove('20–25%', '25–30%'), 'RAISED');
    assert.equal(guidanceMove('20-25%', '20% to 25%'), 'MAINTAINED');
    assert.equal(guidanceMove('25%', '20%'), 'LOWERED');
    assert.equal(guidanceMove('20%', '₹500 Cr'), 'NOT_COMPARABLE');
    const g = buildComparisons(ledgerOf(
      P('ABC', q4, [E('guidance', 'GUIDANCE', null, '20–25%', 'Concall transcript May 2026', 'We guide to revenue growth of 20–25% for the year.')], 'a'),
      P('ABC', q1, [E('guidance', 'GUIDANCE', null, '25–30%', 'Concall transcript Aug 2026', 'We now guide to revenue growth of 25–30% for the year.')], 'b'),
    )).guidance!;
    assert.equal(g.guidance_move, 'RAISED');
    assert.match(g.line, /raised: 20–25% \(Q4 FY26\) → 25–30% \(Q1 FY27\)/);
  });

  test('a target is a TARGET, not an actual; plan rides beside the actual with a pp gap', () => {
    const v = varsFromEvents([
      E('utilisation', 'ACTUAL', null, '74%', 'Concall transcript Aug 2026', 'Capacity utilisation in the quarter was 74%.'),
      E('utilisation', 'TARGET', null, '80%', 'Concall transcript Aug 2026', 'We target 80% utilisation by FY28.'),
    ], 'Q1 FY27').find((x) => x.key === 'utilisation')!;
    assert.equal(v.statement, 'ACTUAL');
    assert.equal(v.after, '74%');
    assert.equal(v.plan!.type, 'TARGET');
    assert.equal(v.plan!.value, '80%');
    assert.equal(v.plan!.gap, '-6pp');
    const only = varsFromEvents([E('utilisation', 'TARGET', null, '80% plus', 'Concall transcript Aug 2026', 'We target utilisation of 80% plus.')], 'Q1 FY27')[0];
    assert.equal(only.statement, 'TARGET');
    assert.equal(only.kind, 'claim');
    assert.equal(gapToTarget('85%', '80%'), '+5pp');
  });

  test('forward wording in the sentence retypes a model "ACTUAL" — and a present marker nearby keeps it', () => {
    const e2e = normalizeEvent(E('capacity_addition', 'ACTUAL', null, '1024', 'Concall transcript Jul 2026',
      "That's the number of GPUs which are live today. So that does not include another 1,024 B200 we are expecting soon."), 'Q1 FY27');
    assert.equal(e2e.value_type, 'GUIDANCE');
    const inn = normalizeEvent(E('utilisation', 'ACTUAL', null, '65% to 70%', 'Concall transcript Aug 2026',
      'INR1,400 crores. that is an optimum revenue that we anticipate at a utilization of 65% to 70%.'), 'Q1 FY27');
    assert.equal(inn.value_type, 'GUIDANCE');
    const exi = normalizeEvent(E('order_book', 'ACTUAL', null, 'INR20 crores', 'Concall transcript Aug 2026',
      'Today, we have about 15 megawatt hours of orders in hand, which are worth roughly INR20 crores and another INR45 crores or 34 megawatt hours in advanced pipeline.'), 'Q1 FY27');
    assert.equal(exi.value_type, 'ACTUAL');
  });

  test('historical context: FY24→FY25 figures on a Q1 FY27 card are context, not this quarter', () => {
    assert.equal(periodEnd('Q1 FY27')!.toISOString().slice(0, 10), '2026-06-30');
    assert.equal(periodStart('Q1 FY27')!.toISOString().slice(0, 10), '2026-04-01');
    const text = 'Because of the above reasons, the inventory moved from INR 440 crores on 31st March 2024 to INR593 crores as on 31st March 2025.';
    assert.equal(historicalAsOf({ before: 'INR 440 crores on 31st March 2024', after: 'INR593 crores as on 31st March 2025', evidence_text: text }, 'Q1 FY27'), 'Mar 2025');
    const vars = varsFromEvents([E('working_capital', 'ACTUAL', 'INR 440 crores on 31st March 2024', 'INR593 crores as on 31st March 2025', 'Annual Report 2026', text)], 'Q1 FY27');
    assert.equal(vars[0].statement, 'HISTORICAL');
    assert.equal(vars[0].verdict, 'stated');
    assert.ok(vars[0].unjudged);
    // The date that belongs to the BEFORE side does not date the current figure.
    assert.equal(historicalAsOf({ before: null, after: '103 boutiques',
      evidence_text: 'Our boutique network grew from 94 boutiques across 30 cities at the end of FY26 to 103 boutiques across 34 cities as on date.' }, 'Q1 FY27'), null);
  });

  test('"unchanged at" is a stated FLAT, not a bare level', () => {
    const v = varsFromEvents([E('order_book', 'ACTUAL', null, '₹1,200 Cr', 'Concall transcript Aug 2026', 'The order book remained unchanged at ₹1,200 Cr.')], 'Q1 FY27')[0];
    assert.equal(v.verdict, 'flat');
    assert.equal(v.delta, 'FLAT');
    assert.equal(v.before, v.after);
  });

  test('an "order book" of revenue potential is labelled and never judged as backlog', () => {
    const v = varsFromEvents([E('order_book', 'ACTUAL', null, 'Rs.950 crores', 'Concall transcript Aug 2026',
      'We expect this diversification to gain momentum, supported by a strong order book representing around Rs.950 crores of peak incremental annual revenue potential over the next two years to three years.')], 'Q1 FY27')[0];
    assert.ok(v.unjudged);
    assert.notEqual(v.statement, 'ACTUAL');
  });

  test('incremental: Q2 adds a layer, Q1 stays, and Q2 compares against Q1', () => {
    const l = ledgerOf(
      P('ABC', q1, [E('utilisation', 'ACTUAL', null, '72%', 'Concall transcript Aug 2026', 'Capacity utilisation for the quarter was 72%.')], 'a'),
      P('ABC', q2, [E('utilisation', 'ACTUAL', null, '80%', 'Concall transcript Nov 2026', 'Capacity utilisation for the quarter was 80%.')], 'b'),
    );
    assert.deepEqual(Object.keys(l.periods).sort(), ['Q1 FY27', 'Q2 FY27']);
    const u = buildComparisons(l).utilisation!;
    assert.equal(u.previous_period, 'Q1 FY27'); assert.equal(u.current_period, 'Q2 FY27'); assert.equal(u.change, '+8pp');
    // Persistence: the stored ledger survives a JSON round trip unchanged.
    const again = JSON.parse(JSON.stringify(l));
    assert.deepEqual(buildComparisons(again).utilisation, u);
  });

  test('capex lifecycle persists across quarters: announced → commissioned → revenue', () => {
    const l = ledgerOf(
      P('ABC', q4, [E('capex', 'GUIDANCE', null, '₹500 Cr', 'Concall transcript May 2026', 'The board approved capex of ₹500 Cr for Plant 2, to be commissioned by December.')], 'a'),
      P('ABC', q1, [E('commissioning', 'ACTUAL', null, 'Plant 2 commissioned', 'Concall transcript Aug 2026', 'Plant 2 was commissioned in July.')], 'b'),
      P('ABC', q2, [E('capex_earning', 'ACTUAL', null, '₹75 Cr', 'Concall transcript Nov 2026', 'Plant 2 contributed revenue of ₹75 Cr in the quarter.')], 'c'),
    );
    const lc = capexLifecycle(l);
    assert.deepEqual(lc.map((e) => [e.period, e.stage]), [['Q4 FY26', 'ANNOUNCED'], ['Q1 FY27', 'COMMISSIONED'], ['Q2 FY27', 'REVENUE_CONTRIBUTION']]);
    const chain = buildCapexChain({}, [], l);
    assert.equal(chain.stage, 'REVENUE_CONTRIBUTION');
    assert.equal(chain.lifecycle!.length, 3, 'earlier quarters are kept, not replaced');
  });
});

describe('zzz765 parsing regressions found on live ledgers', () => {
  test('a currency glued to its amount is still a number (GOLDIAM INR140 → INR225 crores = +60.7%)', () => {
    assert.equal(scaledNumber('INR140 crores'), 140e7);
    assert.equal(scaledNumber('FY26'), null);
    const c = buildComparisons((() => {
      const T0 = '2026-09-22T00:00:00Z';
      const docs: any[] = [{ id: documentId('https://x/g.pdf'), url: 'https://x/g.pdf', label: 'Concall transcript Aug 2026', kind: 'transcript', source: 'screener', period: null, date_iso: '2026-08-10', outcome: 'read' }];
      const ev: any[] = [{ variable: 'order_book', value_type: 'ACTUAL', before: 'INR140 crores', after: 'INR225 crores', unit: null, period: null, direction: 'up', confidence: 'HIGH', source: 'Concall transcript Aug 2026',
        evidence_text: 'As of June end, our order book was INR225 crores. And last year, at the end of June quarter, it was INR140 crores.' }];
      const rp = reportingPeriodForDocuments(docs);
      const { facts, events } = factsFromEvents('GOLDIAM', rp.period, ev, docs, T0);
      return mergePeriod(emptyLedger('GOLDIAM', 'IN', T0), { reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date, documents: docs, documents_found: 1, documents_read: 1, documents_failed: 0, documents_skipped: 0, facts, events, summary: { events: ev }, status: null, status_because: null, tallies: null, discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: 'r', prompt_version: 'v9', model: 'm', extracted_at: T0, updated_at: T0 } as any,
        { run_id: 'r', reporting_period: rp.period, started_at: T0, finished_at: T0, outcome: 'COMPLETED', error: null, documents_found: 1, documents_read: 1, facts_extracted: 1, events_extracted: 1, model: 'm', prompt_version: 'v9' } as any);
    })()).order_book!;
    assert.equal(c.change, '+60.7%');
    assert.equal(c.change_type, 'INCREASED');
  });
  test('"remains strong at" is a level, "remained unchanged at" is a flat', () => {
    const lvl = normalizeEvent({ variable: 'order_book', value_type: 'ACTUAL', before: null, after: 'INR 787 crore', unit: null, period: null, direction: 'unknown', confidence: 'HIGH', source: 's',
      evidence_text: 'The order book remains strong at INR 787 crore for this division, providing solid future visibility.' } as any, 'Q1 FY27');
    assert.ok(!lvl.flat_stated);
    const flat = normalizeEvent({ variable: 'order_book', value_type: 'ACTUAL', before: null, after: 'INR 787 crore', unit: null, period: null, direction: 'unknown', confidence: 'HIGH', source: 's',
      evidence_text: 'The order book remained unchanged at INR 787 crore through the quarter.' } as any, 'Q1 FY27');
    assert.ok(flat.flat_stated);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz765 · round 2 — defects seen on the deployed page (22 Sep 2026).
// ═══════════════════════════════════════════════════════════════════════════
import { rowChangeLines, rowValueText } from '../thesis/variables';
import { financialsFromHtml as fin2 } from '../thesis/screener-financials';
import { readJson, humanError } from '../thesis/safe-json';

describe('zzz765 round 2', () => {
  const EV = (variable: string, value_type: string, before: string | null, after: string, text: string): any =>
    ({ variable, value_type, before, after, unit: null, period: null, direction: 'unknown', evidence_text: text, source: 'Concall transcript Aug 2026', confidence: 'HIGH' });

  test('working-capital days falling is ▲ even when a comparison takes over the row (NEULANDLAB 137 → 84 days)', () => {
    const rows = varsFromEvents([EV('working_capital', 'ACTUAL', '137 days', '84 days',
      'Working capital days of sale at 84 days in Q1FY27 as against 137 days in Q4FY26, mainly on account of decrease in receivables.')], 'Q1 FY27');
    const cmp: any = { working_capital: { key: 'working_capital', label: 'Working capital', current: { raw: '84 days', value: 84, unit: 'day', isPercent: false }, previous: { raw: '137 days', value: 137, unit: 'day', isPercent: false },
      current_period: 'Q1 FY27', previous_period: null, change: '-38.7%', change_relative: null, change_type: 'DECREASED', basis: 'WITHIN_DOCUMENT', direction: 'down', cause: null, forward: null, promised: null, line: '', evidence: '', source: '' } };
    const v = applyComparisons(rows, cmp).find((x) => x.key === 'working_capital')!;
    assert.equal(v.verdict, 'improving');
  });

  test('a "70%-75%" target is a range, not −75 (KIRIINDUS "gap +135pp")', () => {
    assert.deepEqual(rangeOf('70%-75%'), { lo: 70, hi: 75, pct: true });
    assert.equal(gapToTarget('60%', '70%-75%'), '-10pp');
    assert.deepEqual(rangeOf('-5%'), { lo: -5, hi: -5, pct: true });
  });

  test('a plan identical to the actual is not printed twice (ICIL 60% to 65% · plan 60 to 65%)', () => {
    const v = varsFromEvents([
      EV('utilisation', 'ACTUAL', null, '60% to 65%', 'Overall, utilization has remained around 60% to 65% despite the recent addition of our greenfield facility in North Carolina.'),
      EV('utilisation', 'GUIDANCE', null, '60 to 65%', 'So for utility bedding for this year, our endeavor is to be at 60 to 65% utilization.'),
    ], 'Q1 FY27').find((x) => x.key === 'utilisation')!;
    assert.equal(v.plan ?? null, null);
  });

  test('revenue, operating cash flow and planned investment are never one-offs', () => {
    for (const [after, text] of [
      ['` 1109.54 crore', 'The Company has earned Revenue from Operations of ` 1109.54 crore during the year ended on 31 st March, 2026 as against ` 1013.51 crore.'],
      ['`231 Crores', 'Operating cash flows remained positive at `231 Crores, despite 20% revenue growth during the quarter under review.'],
      ['331.53 Cr', 'Planned investment of 331.53 Cr in Baazar Style Retail to accelerate the growth of its consumer FMCG business.'],
    ]) {
      assert.equal(valueFitsVariable({ variable: 'one_offs', before: null, after, unit: null, evidence_text: text }), false, text);
    }
    assert.equal(valueFitsVariable({ variable: 'one_offs', before: null, after: '₹56 Cr', unit: null,
      evidence_text: 'The quarter includes an exceptional item of ₹56 Cr relating to the earn-out expense on the acquisition.' }), true);
  });

  test('"order wins now stand at ₹87 Cr" is present tense, not a plan (UNIMECH)', () => {
    const n = normalizeEvent(EV('order_book', 'ACTUAL', null, 'approximately INR87 crores',
      'In the energy sector, our cumulative nuclear order wins now stand at approximately INR87 crores with execution planned during the next two years.'), 'Q1 FY27');
    assert.equal(n.value_type, 'ACTUAL');
  });

  test('WHAT CHANGED is built from the board rows: typed, one figure per variable', () => {
    const vars = varsFromEvents([
      EV('utilisation', 'ACTUAL', null, '65% to 70%', 'INR1,400 crores. that is an optimum revenue that we anticipate at a utilization of 65% to 70%.'),
      EV('capex', 'ACTUAL', null, 'INR943 million', 'The total capex for Q1 of FY27 was INR943 million, largely towards the new site.'),
    ], 'Q1 FY27');
    const lines = rowChangeLines(vars, 'Q1 FY27');
    assert.ok(lines.some((l) => /Capacity utilisation — guidance: 65% to 70%/.test(l.text)), JSON.stringify(lines));
    assert.ok(lines.some((l) => /Capex: INR943 million/.test(l.text)));
    assert.equal(rowValueText({ key: 'guidance', label: 'Guidance', before: null, after: 'maintained', delta: null, verdict: 'flat', evidence: '', source: 'filing', statement: 'GUIDANCE' } as any), 'guidance MAINTAINED');
  });

  test('capex earning: a future contribution is not ▲ and "no explicit link" is not ▼', () => {
    const e = (t: string) => extractVariables(null, { capex_earning: t }).find((v) => v.key === 'capex_earning')!.verdict;
    assert.equal(e("Jammu and Dammam capex expected to start contributing revenue from Mar '27 as per management."), 'stated');
    assert.equal(e('Management links capex to future revenue but no explicit quantified revenue from each project until commissioning.'), 'stated');
    assert.equal(e('Jammu capex (~INR480+ crore) is already contributing revenue (INR107 crores in Q1).'), 'improving');
    assert.equal(e('Commissioning delayed by two quarters; plant behind schedule.'), 'deteriorating');
  });

  test('screener.in: a consolidated table with no year-ago quarter is reported as such (standalone is tried next)', () => {
    const tbl = (head: string[], rows: Array<[string, string[]]>) =>
      `<section id="quarters"><table><tr><th></th>${head.map((h) => `<th>${h}</th>`).join('')}</tr>` +
      rows.map(([l, v]) => `<tr><td>${l} +</td>${v.map((x) => `<td>${x}</td>`).join('')}</tr>`).join('') + `</table></section>`;
    const r = fin2('E2E', tbl(['Dec 2025', 'Mar 2026', 'Jun 2026'], [['Sales', ['120', '140', '157']], ['Net Profit', ['30', '40', '44']]]), 'consolidated', 'u')!;
    assert.equal(r.comparison_period, null);
    assert.equal(r.sales_yoy_pct, null);
  });

  test('a non-JSON error page becomes a sentence, and "Failed to fetch" says what it means', async () => {
    const j = await readJson(new Response('upstream error', { status: 502 }));
    assert.equal(j.ok, false);
    assert.match(j.error, /did not finish in time.*unchanged/);
    assert.match(humanError(new TypeError('Failed to fetch')), /Could not reach the server/);
    assert.match(humanError(new SyntaxError(`Unexpected token 'u', "upstream error" is not valid JSON`)), /did not finish in time/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz766 — INDIA DAILY GAINERS AUDIT. Every case below is a defect found by
// reading the live board for the 22 Sep 2026 session (screener.in screen +
// the deployed research store), fixed, and locked here.
// ═══════════════════════════════════════════════════════════════════════════
import {
  indiaSession, partitionByCap, isLargeCap, LARGE_CAP_MIN_CR,
} from '../ai-gainers/screener-gainers';
import {
  chooseCandidate, filedAfterClose, indiaSessionCloseIso, refreshFindingMove, type AnnouncementLite,
} from '../ai-gainers/catalyst-research';
import { readJsonResponse, describeFetchError } from '../ai-gainers/client-fetch';

describe('zzz766 gainers India — screen, session and cap band', () => {
  const html = fx('screener-gainers-2026-09-22.html');

  test('the screen parser reads CMP and the company id (price was always null)', () => {
    const { rows, total, error } = parsePage(html);
    assert.equal(error, null);
    assert.equal(total, 98, '"98 results" on the live screen');
    const opt = rows.find((r) => r.ticker === 'OPTIEMUS')!;
    assert.equal(opt.price, 708.9);
    assert.equal(opt.companyId, '2342');
    assert.equal(opt.marketCapCr, 6396.23);
    assert.equal(opt.movePct, 20);
    // BSE-code tickers survive (Hemant Surgical lists only on BSE).
    assert.ok(rows.some((r) => r.ticker === '543916'));
  });

  test('large caps are split out, not researched: MEESHO at ₹1.11 lakh Cr on a small/mid board', () => {
    const { rows } = parsePage(html);
    const { kept, largeCaps } = partitionByCap(rows);
    assert.deepEqual(largeCaps.map((r) => r.ticker), ['MEESHO']);
    assert.equal(kept.length, rows.length - 1);
    assert.ok(kept.some((r) => r.ticker === 'GABRIEL'), '₹26,108 Cr is a small/mid cap, kept');
    assert.equal(LARGE_CAP_MIN_CR, 100_000);
    assert.equal(isLargeCap(null), false, 'unknown cap is kept, never silently dropped');
    assert.equal(isLargeCap(99_999), false);
    assert.equal(isLargeCap(100_000), true);
  });

  test('the session is the last TRADED day, not the IST calendar day', () => {
    // 01:50 IST Wed 23 Sep: the 1-day return is Tuesday's. The research store
    // was keyed 2026-09-23 and would have merged Wednesday's board into it.
    const pre = indiaSession(new Date('2026-09-22T20:20:00Z'));
    assert.equal(pre.date, '2026-09-22'); assert.equal(pre.state, 'pre_open'); assert.equal(pre.isToday, false);
    const open = indiaSession(new Date('2026-09-23T06:00:00Z'));          // 11:30 IST Wed
    assert.equal(open.date, '2026-09-23'); assert.equal(open.state, 'open'); assert.equal(open.isToday, true);
    const closed = indiaSession(new Date('2026-09-23T12:00:00Z'));        // 17:30 IST Wed
    assert.equal(closed.date, '2026-09-23'); assert.equal(closed.state, 'closed');
    const sat = indiaSession(new Date('2026-09-26T06:00:00Z'));           // Saturday
    assert.equal(sat.date, '2026-09-25'); assert.equal(sat.state, 'weekend');
    const monPre = indiaSession(new Date('2026-09-28T02:00:00Z'));        // Mon 07:30 IST
    assert.equal(monPre.date, '2026-09-25', 'Monday before the open is still Friday\'s board');
    const hol = indiaSession(new Date('2026-10-02T06:00:00Z'));           // Gandhi Jayanti (Fri)
    assert.equal(hol.date, '2026-10-01'); assert.equal(hol.state, 'holiday');
    assert.match(pre.label, /last completed session/);
  });
});

describe('zzz766 gainers India — catalyst classification from live filings', () => {
  const now = new Date('2026-09-22T20:20:00Z');
  const A = (subject: string, summary: string | null, dateIso: string, url = `https://www.bseindia.com/x/${encodeURIComponent(subject).slice(0, 20)}.pdf`): AnnouncementLite =>
    ({ subject, summary, url, dateIso, ageDays: null });
  const cls = (a: AnnouncementLite) => classifyAnnouncement(a, 'IN');

  test('capacity enhancement completed is a capacity catalyst, not "unclassifiable" (TRANSRAILL)', () => {
    const c = cls(A('Enhancement Of Conductor Manufacturing Capacity', 'Phase 1 Silvassa conductor expansion completed; capacity rises from 24,000 to 40,800 Km/annum on September 21, 2026.', '2026-09-21T18:14:09+05:30'));
    assert.equal(c.kind, 'catalyst'); assert.equal(c.category, 'capacity_expansion'); assert.equal(c.stage, 'executed');
  });

  test('a product launch with commercial sales is new_product (VILAS)', () => {
    const c = cls(A('Product launch', 'Vilas Transcore launched PCCS and PCAS products and began commercial sales on 15 September 2026.', '2026-09-16T16:32:26+05:30'));
    assert.equal(c.kind, 'catalyst'); assert.equal(c.category, 'new_product');
  });

  test('operational damage is NEGATIVE, never a catalyst and never "unclassified" (REGAAL)', () => {
    const c = cls(A('Announcement Under Regulation 30 (LODR) - Disruption Of Operations', '10 MW turbine damage at 825 TPD Bihar plant; repair by about 30 September 2026.', '2026-09-10T19:31:20+05:30'));
    assert.equal(c.kind, 'negative');
  });

  test('a reply whose subject carries a dotted date is still a denial (ASTEC 18.09.2026)', () => {
    const reply = cls(A('Response To BSE Query Dated 18.09.2026', 'Astec Lifesciences replies to BSE volume inquiry, saying no undisclosed developments exist.', '2026-09-18T15:35:35+05:30'));
    assert.equal(reply.kind, 'denial');
    const ask = cls(A('Clarification sought from Astec Lifesciences Ltd', 'Exchange has sought clarification from Astec Lifesciences Ltd on September 18, 2026, with reference to Movement in Volume.', '2026-09-18T12:18:00+05:30'));
    assert.equal(ask.kind, 'exchange_query', 'the exchange asking is not the company denying');
    const f = buildFinding({ ticker: 'ASTEC', company: null, market: 'IN', movePct: 10.43, marketCap: 1770, turnover: 53, announcements: [
      reply, ask,
      A('Response To BSE E-Mail Seeking Clarification On Price Movement', 'Astec Lifesciences confirms no undisclosed developments behind recent volume increase.', '2026-09-11T10:10:37+05:30'),
    ], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'denied');
    assert.equal(f.sourceDate, '2026-09-18T15:35:35+05:30', 'the latest denial is the finding, not the 11 Sep one');
  });

  test('an NCD placement is debt financing — routine, not a PRICED "catalyst" (GABRIEL)', () => {
    const c = cls(A('Announcement under Regulation 30 (LODR)-Meeting Updates', 'Approved private placement of 1,00,000 NCDs worth up to ₹1,000 crore, maturing September 10, 2029.', '2026-09-10T18:53:22+05:30'));
    assert.equal(c.kind, 'routine'); assert.match(String(c.routineReason), /debt financing/);
    // …while an equity raise is still a fundraising catalyst.
    assert.equal(cls(A('Outcome of board meeting', 'Board approved preferential issue of equity shares aggregating ₹120 crore', '2026-09-10T18:00:00+05:30')).category, 'fundraising');
  });

  test('"acquisition consideration" is not "to consider": allotment executes an earlier deal (GABRIEL)', () => {
    const c = cls(A('Announcement Under Regulation 30 (LODR) Regarding Allotment Of 1,44,04,204 Equity Shares T', 'Board approved allotment of 1.44 crore shares to AIPL on September 11, 2026, for ₹1,881.03 crore acquisition consideration.', '2026-09-11T22:33:49+05:30'));
    assert.equal(c.kind, 'catalyst'); assert.equal(c.category, 'acquisition');
    assert.equal(c.stage, 'executed', '"consideration" matched the enabling rule before');
    assert.equal(c.incremental, false, 'follow-through on an announced deal — materiality capped');
    assert.equal(c.valueStated, 1881.03);
  });

  test('cancelling a roadshow is paperwork', () => {
    assert.equal(cls(A('Announcement Under Regulation 30 (LODR) Regarding Cancellation Of The Non-Deal Roadshow (N', 'Gabriel India cancelled its 15 September 2026 non-deal roadshow due to exigencies.', '2026-09-10T22:37:27+05:30')).kind, 'routine');
  });
});

describe('zzz766 gainers India — a filing after the close cannot explain the move', () => {
  const now = new Date('2026-09-22T20:20:00Z');
  const close = indiaSessionCloseIso('2026-09-22');

  test('session close is 15:30 IST', () => {
    assert.equal(Date.parse(close), Date.parse('2026-09-22T10:00:00Z'));
    assert.equal(filedAfterClose('2026-09-22T18:00:00+05:30', close), true);
    assert.equal(filedAfterClose('2026-09-22T12:44:06+05:30', close), false);
    assert.equal(filedAfterClose(null, close), false);
  });

  test('an evening order win is excluded from the explanation and named in a note', () => {
    const anns: AnnouncementLite[] = [
      { subject: 'Receipt of order', summary: 'Company bagged an order worth ₹300 crore from NTPC', url: 'https://www.bseindia.com/late.pdf', dateIso: '2026-09-22T19:05:00+05:30', ageDays: 0 },
    ];
    const f = buildFinding({ ticker: 'X', company: null, market: 'IN', movePct: 12, marketCap: 1500, turnover: 20, announcements: anns, returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now, sessionCloseIso: close });
    assert.equal(f.status, 'none', 'never invent a catalyst from a filing that post-dates the move');
    assert.match(String(f.headline), /No filing before the session closed/);
    assert.ok(f.notes.some((n) => /after the session closed/.test(n)));
    assert.equal(chooseCandidate(anns, 'IN', { marketCap: 1500, returns: null, windowDays: 21, now, sessionCloseIso: close }), null, 'no model read is spent on it either');
    // Without a session bound (intraday) the same filing is the catalyst.
    const g = buildFinding({ ticker: 'X', company: null, market: 'IN', movePct: 12, marketCap: 1500, turnover: 20, announcements: anns, returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(g.status, 'catalyst');
  });

  test('a re-registered name takes the closing move and its band flag (registered +6%, closed +20%)', () => {
    const f = buildFinding({ ticker: 'NAMOEWASTE', company: null, market: 'IN', movePct: 6, marketCap: 724, turnover: 2.4, announcements: [], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.bandPrint, false);
    const g = refreshFindingMove(f, 20);
    assert.equal(g.movePct, 20); assert.equal(g.bandPrint, true); assert.equal(g.bandLevel, 20);
    assert.ok(g.notes.some((n) => /20% band .*1-week average/.test(n)), 'the value is labelled a 1-week average, not "traded"');
    const h = refreshFindingMove(g, 7.3);
    assert.equal(h.bandPrint, false); assert.ok(!h.notes.some((n) => /band/.test(n)), 'a stale band note is removed');
  });
});

describe('zzz766 gainers India — readable errors, readable page', () => {
  test('an HTML 502 becomes a sentence, never "Unexpected token <"', async () => {
    const r = new Response('<!DOCTYPE html><html><body>Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } });
    const res = await readJsonResponse(r, 'The gainers scan');
    assert.equal(res.ok, false);
    assert.match(String(res.error), /HTTP 502/);
    assert.doesNotMatch(String(res.error), /Unexpected token|JSON/);
  });

  test('a JSON error body carries its own message; a good body passes through', async () => {
    const bad = await readJsonResponse(new Response(JSON.stringify({ ok: false, error: 'screen unreachable' }), { status: 500 }));
    assert.equal(bad.ok, false); assert.match(String(bad.error), /screen unreachable/);
    const good = await readJsonResponse(new Response(JSON.stringify({ ok: true, queue: [] }), { status: 200 }));
    assert.equal(good.ok, true); assert.deepEqual(good.json, { ok: true, queue: [] });
    const empty = await readJsonResponse(new Response('', { status: 200 }));
    assert.equal(empty.ok, false);
  });

  test('thrown fetches read as sentences', () => {
    assert.match(describeFetchError(Object.assign(new Error('x'), { name: 'TimeoutError' })), /too long/);
    assert.match(describeFetchError(new TypeError('Failed to fetch')), /Could not reach/);
  });

  test('the page has no text under 12px and no invalid "var(...)18" tag fills', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'ai-gainers', 'page.tsx'), 'utf8');
    const small = Array.from(src.matchAll(/fontSize:\s*([\d.]+)/g)).map((m) => Number(m[1])).filter((n) => n < 12);
    assert.deepEqual(small, [], 'owner: text too small/faint');
    assert.ok(!/\$\{color\}18/.test(src), 'a theme variable + "18" is not a colour');
    assert.ok(!/faint: 'var\(--mc-text-4\)'/.test(src), 'dimmest token is too faint on the dark panel');
    assert.ok(!/room left/.test(src), 'verdict labels describe the catalyst, not a trade');
    assert.ok(!/await r\.json\(\)|await rr\.json\(\)/.test(src), 'every response goes through readJsonResponse');
    assert.ok(!/rows\.slice\(0, 8\)/.test(src), 'the queue shows every name the funnel counts');
    // Page files may only default-export.
    assert.deepEqual(Array.from(src.matchAll(/^export\s+(?!default)/gm)), []);
  });

  test('the India scan never computes grades on its own clock and keys its cache by session', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'ai-gainers', 'route.ts'), 'utf8');
    assert.match(src, /earnings\/graded\?date=\$\{d\}&cache_only=1/);
    assert.match(src, /ai-gainers:v3:IN:\$\{session!\.date\}/);
    // The minifier folded `…${x} days … week's catalyst. ` + `Filings…` and
    // dropped the middle clause ("in the last 14Filings up to 60 days").
    assert.match(src, /this week\\u2019s catalyst\.`,\n\s*`Filings up to/);
    const rsrc = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'ai-gainers', 'research', 'route.ts'), 'utf8');
    assert.match(rsrc, /indiaSession\(\)\.date/, 'research store keyed by session, not IST calendar day');
    assert.match(rsrc, /STATE_TTL_S/);
    const dw = readFileSync(join(__dirname, '..', '..', 'app', 'api', 'v1', 'cron', 'data-watch', 'route.ts'), 'utf8');
    assert.match(dw, /istHour = ist\.getUTCHours\(\)/, 'istNow() is pre-shifted — local getters double-shift off UTC hosts');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz766 — USA side of the Daily Gainers, audited against the live deployment
// on 22 Sep 2026. Fixtures are the bytes the sources served that day: the
// TradingView weekly-gainers export and trimmed EDGAR submissions JSON.
// ═══════════════════════════════════════════════════════════════════════════
import {
  parseCsv as usParseCsv, usRowFromRecord, screenUsGainers, describeExclusions, capTierUs, fmtUsdM,
  describeUsExportAsOf, etToday, isNyseTradingDay, lastCompletedNyseSession, usPhaseAt,
  announcementsFromSubmissions, classifyUsFiling, secTickerCandidates, edgarFilingUrl, MERGER_MARKER,
} from '../ai-gainers/us-gainers';
import { htmlToText } from '../ai-gainers/edgar-research';
import { fmtMoney } from '../ai-gainers/catalyst-research';

describe('zzz766 gainers USA — universe, session, EDGAR classification', () => {
  const csv = fx('tv-weekly-gainer-usa-20260922.csv');
  const all = usParseCsv(csv).map(usRowFromRecord).filter((r) => r.ticker);
  const { kept, excluded } = screenUsGainers(all);
  const edgar: Record<string, any> = JSON.parse(fx('edgar-submissions-us-20260922.json'));
  const now = new Date('2026-09-22T20:30:00Z');   // 16:30 ET Tue, after the close
  const annsOf = (t: string) => announcementsFromSubmissions(edgar[t], edgar[t].cik, 21, now);
  const bySubject = (t: string, rx: RegExp) => annsOf(t).find((a) => rx.test(a.subject))!;

  test('the US list holds no Indian listings (15 NSE/BSE rows in the live export)', () => {
    assert.equal(all.length, 52);
    assert.equal(all.filter((r) => r.exchange === 'NSE' || r.exchange === 'BSE').length, 15);
    assert.ok(kept.every((r) => ['NASDAQ', 'NYSE'].includes(r.exchange)));
    for (const t of ['OPTIEMUS', 'RAYMOND', 'TBZ', 'JASH', 'APOLLO']) assert.ok(!kept.some((r) => r.ticker === t), `${t} is an NSE row`);
    assert.equal(excluded.filter((e) => e.kind === 'non_us').length, 15, 'every Indian row, including the NSE+BSE double listings');
  });

  test('duplicates are dropped once, with a reason', () => {
    assert.equal(new Set(kept.map((r) => r.ticker)).size, kept.length);
    const dup = screenUsGainers([
      { ticker: 'ABC', company: 'Abc Inc', exchange: 'NASDAQ', movePct: 10, relVol: 1, gapPct: 0, volume: 1, price: 5, marketCap: 800, perf: { m1: 1, m3: 1, m6: 1, y1: 1 } },
      { ticker: 'ABC', company: 'Abc Inc', exchange: 'NYSE', movePct: 9, relVol: 1, gapPct: 0, volume: 1, price: 5, marketCap: 800, perf: { m1: 1, m3: 1, m6: 1, y1: 1 } },
    ]);
    assert.equal(dup.kept.length, 1); assert.equal(dup.excluded[0].kind, 'duplicate');
  });

  test('small/mid only: > $10B is excluded (17 large/mega caps live), $50M–$10B kept', () => {
    assert.equal(kept.length, 20);
    assert.ok(kept.every((r) => r.marketCap != null && r.marketCap >= 50 && r.marketCap <= 10_000));
    for (const t of ['META', 'AMD', 'INTC', 'QCOM', 'SHOP', 'NET', 'MSTR', 'DOCN', 'VICR', 'RMBS']) {
      assert.equal(excluded.find((e) => e.ticker === t)?.kind, 'large_cap', t);
    }
    assert.equal(capTierUs(10_000), 'mid'); assert.equal(capTierUs(10_001), 'large'); assert.equal(capTierUs(250_000), 'mega');
    assert.equal(capTierUs(49), 'nano'); assert.equal(capTierUs(299), 'micro'); assert.equal(capTierUs(null), null);
    const note = describeExclusions(excluded, all.length, kept.length) || '';
    assert.match(note, /Kept 20 of 52 .*large\/mega caps/);
    assert.ok(!/MEESHO, MEESHO/.test(note), 'a double-listed ticker is named once');
  });

  test('noise: OTC, warrants/units, penny, nano, losers and missing caps are excluded', () => {
    const b = { relVol: 1, gapPct: 0, volume: 1e6, perf: { m1: 1, m3: 1, m6: 1, y1: 1 } };
    const r = screenUsGainers([
      { ...b, ticker: 'OTCX', company: 'Otc Co', exchange: 'OTC', movePct: 40, price: 3, marketCap: 500 },
      { ...b, ticker: 'LUNRW', company: 'Intuitive Machines, Inc. Warrants', exchange: 'NASDAQ', movePct: 40, price: 3, marketCap: 500 },
      { ...b, ticker: 'ABCD.U', company: 'Abcd Units', exchange: 'NYSE', movePct: 40, price: 10, marketCap: 500 },
      { ...b, ticker: 'PNY', company: 'Penny Corp', exchange: 'NASDAQ', movePct: 40, price: 0.4, marketCap: 120 },
      { ...b, ticker: 'NANO', company: 'Nano Corp', exchange: 'NASDAQ', movePct: 40, price: 2, marketCap: 20 },
      { ...b, ticker: 'DOWN', company: 'Down Corp', exchange: 'NASDAQ', movePct: -4, price: 2, marketCap: 400 },
      { ...b, ticker: 'NOMC', company: 'No Cap Corp', exchange: 'NASDAQ', movePct: 5, price: 2, marketCap: null },
      { ...b, ticker: 'SPCX', company: 'Blue Ocean Acquisition Corp', exchange: 'NASDAQ', movePct: 5, price: 10.4, marketCap: 150 },
      { ...b, ticker: 'ADRX', company: 'Foo Holdings ADR', exchange: 'NYSE', movePct: 5, price: 10.4, marketCap: 1500 },
    ]);
    assert.deepEqual(r.excluded.map((e) => e.kind), ['otc', 'not_common', 'not_common', 'penny', 'nano_cap', 'not_gainer', 'no_mcap']);
    assert.deepEqual(r.kept.map((k) => [k.ticker, k.capTier, k.flags.join()]), [['SPCX', 'micro', 'SPAC'], ['ADRX', 'small', 'ADR']]);
  });

  test('the move is the 1-week column only — never a silent 1-month fallback', () => {
    const row = usRowFromRecord({ Symbol: 'X', Exchange: 'NASDAQ', 'Performance %, 1 week': '', 'Performance %, 1 month': '55', 'Market capitalization': '500000000' });
    assert.equal(row.movePct, null);
    assert.equal(row.perf.m1, 55); assert.equal(row.marketCap, 500);
    assert.equal(screenUsGainers([row]).excluded[0].kind, 'no_move');
  });

  test('money formatting: $M below a billion, $B above, $T for mega', () => {
    assert.equal(fmtUsdM(643.03), '$643M'); assert.equal(fmtUsdM(2083.27), '$2.1B'); assert.equal(fmtUsdM(1_896_822), '$1.90T');
    assert.equal(fmtUsdM(12.34), '$12.3M'); assert.equal(fmtUsdM(null), '—');
    assert.equal(fmtMoney(2083.27, 'US'), '$2.1B');
    assert.equal(fmtMoney(279.33, 'IN'), '₹279 Cr', 'India unchanged');
  });

  test('US session: ET day key, NYSE holidays, weekends, intraday vs close, staleness', () => {
    assert.equal(etToday(new Date('2026-09-23T00:30:00Z')), '2026-09-22', '20:30 ET is still the 22nd in New York');
    assert.equal(isNyseTradingDay('2026-09-07'), false, 'Labor Day');
    assert.equal(isNyseTradingDay('2026-11-26'), false, 'Thanksgiving');
    assert.equal(isNyseTradingDay('2026-09-19'), false, 'Saturday');
    assert.equal(isNyseTradingDay('2026-09-22'), true);
    assert.equal(lastCompletedNyseSession(new Date('2026-09-08T12:00:00Z')), '2026-09-04', 'Tue 8am ET after Labor Day → Friday');
    assert.equal(usPhaseAt(new Date('2026-09-22T17:12:39Z')), 'regular');
    assert.equal(usPhaseAt(new Date('2026-11-27T19:00:00Z')), 'after_hours', '14:00 ET on the day-after-Thanksgiving early close');
    // The live sync: 13:12 ET Tuesday — an INTRADAY snapshot, not a close.
    const live = describeUsExportAsOf('2026-09-22T17:12:39.771Z', new Date('2026-09-22T20:30:00Z'))!;
    assert.equal(live.intraday, true); assert.equal(live.session, '2026-09-22'); assert.equal(live.stale, false);
    assert.match(live.label, /intraday snapshot/);
    const nextDay = describeUsExportAsOf('2026-09-22T17:12:39.771Z', new Date('2026-09-23T21:00:00Z'))!;
    assert.equal(nextDay.stale, true); assert.equal(nextDay.sessions_behind, 1);
    // The scheduled IST sync lands before the US open → it is the PREVIOUS close.
    const pre = describeUsExportAsOf('2026-09-22T04:30:00Z', new Date('2026-09-22T12:00:00Z'))!;
    assert.equal(pre.phase, 'pre_market'); assert.equal(pre.session, '2026-09-21'); assert.equal(pre.stale, false);
    const weekend = describeUsExportAsOf('2026-09-19T15:00:00Z', new Date('2026-09-21T12:00:00Z'))!;
    assert.equal(weekend.session, '2026-09-18'); assert.equal(weekend.stale, false, 'Monday pre-open: Friday IS the latest close');
    assert.equal(describeUsExportAsOf('2026-09-19T15:00:00Z', new Date('2026-09-21T21:00:00Z'))!.stale, true);
    assert.equal(describeUsExportAsOf('not a date'), null);
  });

  test('EDGAR submissions → dated announcements: Form 4/A skipped, ET dates, session, working links', () => {
    const prth = annsOf('PRTH');
    assert.ok(!prth.some((a) => /^4\/A/.test(a.subject)), 'Form 4/A is insider mechanics');
    const k8 = prth.find((a) => /^8-K/.test(a.subject))!;
    assert.equal(k8.url, 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026101651/ea0306047-8k_priority.htm');
    assert.equal(k8.dateIso, '2026-09-21T07:40:34-04:00', 'acceptance time in ET');
    assert.match(k8.subject, /before the open/);
    assert.ok(k8.subject.includes(MERGER_MARKER), 'same document also filed as DEFA14A');
    assert.ok(!prth.some((a) => /^DEFA14A/.test(a.subject)), 'the DEFA14A copy of the 8-K is one event, not two');
    const docn = bySubject('DOCN', /^8-K/);
    assert.match(docn.subject, /after the close/, '20:05Z = 16:05 ET');
    const effect = bySubject('USDE', /^EFFECT/);
    assert.match(effect.url, /xslEFFECTX01\/primary_doc\.xml$/);
    assert.ok(!/Item/.test(effect.subject), 'items ",," is not three empty items');
    assert.equal(edgarFilingUrl('0001653558', '0001213900-26-101651', ''), 'https://www.sec.gov/Archives/edgar/data/1653558/000121390026101651/0001213900-26-101651-index.htm');
    assert.ok(secTickerCandidates('BRK.B').includes('BRK-B'));
  });

  test('Item 1.01 is never an order win: merger → acquisition, finance facility → unclassified', () => {
    const prth = classifyAnnouncement(bySubject('PRTH', /^8-K/), 'US');
    assert.equal(prth.kind, 'catalyst'); assert.equal(prth.category, 'acquisition', 'PRTH signed a take-private merger agreement');
    const pf = buildFinding({ ticker: 'PRTH', company: null, market: 'US', movePct: 31, marketCap: 643, turnover: 70, announcements: annsOf('PRTH'), returns: { m1: 30, m3: 20, m6: 10, y1: 5, history: 999 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(pf.category, 'acquisition'); assert.match(pf.headline || '', /^8-K: Business combination agreement/);
    const docn = classifyAnnouncement(bySubject('DOCN', /^8-K/), 'US');
    assert.equal(docn.kind, 'unclassified', 'DOCN 1.01+2.03 was an equipment-finance facility');
    const nuai = classifyAnnouncement(bySubject('NUAI', /^8-K/), 'US');
    assert.notEqual(nuai.category, 'order_win');
  });

  test('offerings are negative dilution, never a positive "fundraising" catalyst', () => {
    for (const rx of [/^424B3/, /^S-1\/A/]) {
      const c = classifyAnnouncement(bySubject('USDE', rx), 'US');
      assert.equal(c.kind, 'negative', rx.source); assert.equal(c.category, 'dilution');
    }
    assert.equal(classifyAnnouncement(bySubject('WOLF', /^S-3ASR/), 'US').category, 'dilution');
    assert.equal(classifyUsFiling({ subject: '8-K: Item 1.01 Entry into a Material Definitive Agreement; Item 3.02 Unregistered Sales of Equity Securities' })?.category, 'dilution');
    assert.equal(classifyUsFiling({ subject: 'D' })?.kind, 'negative');
    assert.equal(classifyAnnouncement(bySubject('USDE', /^S-8/), 'US').kind, 'routine', 'an employee plan is not an offering');
    const f = buildFinding({ ticker: 'USDE', company: 'StablecoinX', market: 'US', movePct: 94.3, marketCap: 368, turnover: 96, announcements: annsOf('USDE'), returns: { m1: 90, m3: 80, m6: null, y1: null, history: 999 }, holding: false, sources: ['SEC EDGAR submissions'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'negative'); assert.equal(f.category, 'dilution');
    assert.match(f.headline || '', /424B3|S-1\/A|registration/);
  });

  test('an 8-K 2.02 / 10-Q is a results catalyst, not routine paperwork — and not claimed as good', () => {
    const r = classifyUsFiling({ subject: '8-K: Item 2.02 Results of Operations and Financial Condition; Item 9.01 Financial Statements and Exhibits' });
    assert.equal(r?.kind, 'catalyst'); assert.equal(r?.category, 'quarterly_result');
    assert.equal(classifyUsFiling({ subject: '10-Q: 10-Q' })?.category, 'quarterly_result');
    const f = buildFinding({ ticker: 'MDB', company: null, market: 'US', movePct: 14, marketCap: 3000, turnover: 50, announcements: [{ subject: '8-K: Item 2.02 Results of Operations and Financial Condition; Item 9.01 Financial Statements and Exhibits', summary: null, url: 'https://www.sec.gov/x.htm', dateIso: '2026-09-18T16:05:00-04:00', ageDays: 4 }], returns: { m1: 5, m3: 10, m6: 10, y1: 20, history: 999 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'catalyst'); assert.equal(f.category, 'quarterly_result');
    assert.ok(f.notes.some((n) => /whether the numbers were good was not read/.test(n)));
    assert.notEqual(f.verdict, 'FIRE', 'no stated value can never be FIRE');
  });

  test('governance paperwork is routine: 5.02 officer change, proxies, 13G, 13D/A', () => {
    assert.equal(classifyAnnouncement(bySubject('SATL', /^8-K/), 'US').kind, 'routine', 'SATL 5.02 was scored "room left"');
    assert.equal(classifyAnnouncement(bySubject('WOLF', /^DEF 14A/), 'US').kind, 'routine');
    assert.equal(classifyAnnouncement(bySubject('NUAI', /^SCHEDULE 13G/), 'US').kind, 'routine');
    assert.equal(classifyAnnouncement(bySubject('PRTH', /^SCHEDULE 13D\/A/), 'US').kind, 'routine');
    assert.equal(classifyUsFiling({ subject: 'SCHEDULE 13D' })?.category, 'strategic_investor');
    assert.equal(classifyUsFiling({ subject: 'SC TO-T' })?.category, 'open_offer');
    assert.equal(classifyUsFiling({ subject: '425' })?.category, 'acquisition');
    assert.equal(classifyUsFiling({ subject: '8-K: Item 4.02 Non-Reliance on Previously Issued Financial Statements' })?.kind, 'negative');
    assert.equal(classifyUsFiling({ subject: '8-K: Item 3.01 Notice of Delisting' })?.kind, 'negative');
    assert.equal(classifyUsFiling({ subject: '6-K: REPORT OF FOREIGN ISSUER' })?.kind, 'unclassified');
  });

  test('no catalyst is invented: an unread Item 8.01 stays unclassified; "no confirmed catalyst" when nothing', () => {
    const wolf = buildFinding({ ticker: 'WOLF', company: null, market: 'US', movePct: 18, marketCap: 1494, turnover: 30, announcements: annsOf('WOLF').filter((a) => !/^S-3/.test(a.subject)), returns: { m1: 20, m3: 10, m6: 5, y1: -50, history: 999 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(wolf.status, 'routine_only'); assert.equal(wolf.verdict, null);
    assert.match(wolf.headline || '', /not classifiable/);
    const none = buildFinding({ ticker: 'LUNR', company: null, market: 'US', movePct: 14, marketCap: 3628, turnover: 70, announcements: [], returns: null, holding: false, sources: ['SEC EDGAR submissions'], sourceFailed: false, windowDays: 21, now });
    assert.equal(none.status, 'none'); assert.equal(none.category, null);
  });

  test('a paid model read of an unclassified 8-K is USED (it was dropped), and a negative read is negative', () => {
    const item = { subject: '8-K: Item 8.01 Other Events; Item 9.01 Financial Statements and Exhibits', summary: null, url: 'https://www.sec.gov/Archives/edgar/data/1/2/x8k.htm', dateIso: '2026-09-21T07:00:00-04:00', ageDays: 1 };
    const read = { url: item.url, headline: 'Awarded a $120 million five-year supply contract by a US utility', quote: 'The company has been awarded a $120 million five-year supply contract.', category: 'order_win' as const };
    const f = buildFinding({ ticker: 'X', company: null, market: 'US', movePct: 25, marketCap: 600, turnover: 40, announcements: [item], returns: { m1: 20, m3: 10, m6: 5, y1: 0, history: 999 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now, read });
    assert.equal(f.status, 'catalyst'); assert.equal(f.category, 'order_win'); assert.equal(f.modelRead, true);
    assert.equal(f.evidenceQuote, read.quote); assert.equal(f.valueStated, 120); assert.equal(f.valuePctMcap, 20);
    const g = buildFinding({ ticker: 'X', company: null, market: 'US', movePct: 25, marketCap: 600, turnover: 40, announcements: [item], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now, read: { ...read, headline: 'Largest customer terminated its contract', quote: 'Our largest customer notified us that it terminated the agreement.', category: 'customer_loss' as const } });
    assert.equal(g.status, 'negative'); assert.equal(g.category, 'customer_loss');
  });

  test('an offering beside a real catalyst is a flag on it, and caps it below FIRE', () => {
    const cat8k = { subject: '8-K: Business combination agreement (also filed as merger communication) — Item 1.01 Entry into a Material Definitive Agreement', summary: null, url: 'https://www.sec.gov/a.htm', dateIso: '2026-09-21T07:00:00-04:00', ageDays: 1 };
    const s3 = { subject: '424B5: PROSPECTUS SUPPLEMENT', summary: null, url: 'https://www.sec.gov/b.htm', dateIso: '2026-09-21T17:00:00-04:00', ageDays: 1 };
    const f = buildFinding({ ticker: 'X', company: null, market: 'US', movePct: 30, marketCap: 500, turnover: 40, announcements: [cat8k, s3], returns: { m1: -5, m3: -10, m6: -20, y1: -30, history: 999 }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'catalyst'); assert.equal(f.category, 'acquisition');
    assert.ok(f.notes.some((n) => /Offering filed in the window/.test(n)));
    assert.notEqual(f.verdict, 'FIRE');
  });

  test('India classification is untouched by the US rules', () => {
    const pref = classifyAnnouncement({ subject: 'Announcement under Regulation 30 (LODR)-Allotment', summary: 'Allotment of equity shares on preferential basis raising ₹50 crore', url: 'x', dateIso: null, ageDays: 1 }, 'IN');
    assert.equal(pref.kind, 'catalyst'); assert.equal(pref.category, 'fundraising');
    const mgmt = classifyAnnouncement({ subject: 'Appointment of Chief Executive Officer', summary: null, url: 'x', dateIso: null, ageDays: 1 }, 'IN');
    assert.equal(mgmt.category, 'management_change');
  });

  test('EDGAR HTML entities are decoded so a verbatim quote with an apostrophe still matches', () => {
    const t = htmlToText('<p>The Company&#8217;s revenue grew 40%&#160;&#8212; a record.</p><script>x()</script>');
    assert.equal(t, 'The Company’s revenue grew 40% — a record.');
    assert.equal(quoteIsInDocument(t + ' '.repeat(10) + 'filler text to be long enough', "The Company's revenue grew 40% — a record."), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz767 · round 3 — defects seen on the deployed page (23 Sep 2026).
// ═══════════════════════════════════════════════════════════════════════════
import { delayVerdict, isDenial as isDenial3 } from '../thesis/variables';
import { hedgedAround } from '../thesis/fact-normalize';

describe('zzz767 round 3', () => {
  const EV = (variable: string, value_type: string, before: string | null, after: string, text: string): any =>
    ({ variable, value_type, before, after, unit: null, period: null, direction: 'unknown', evidence_text: text, source: 'Concall transcript Aug 2026', confidence: 'HIGH' });

  test('a schedule or a possibility is not an execution delay ▼; a delay that happened is', () => {
    assert.equal(delayVerdict('Phase‑2 targeted Q2 FY28 (timing risk implicit).'), 'stated');
    assert.equal(delayVerdict("B200 deliveries upcoming for next lot expected in 'next couple of months'."), 'stated');
    assert.equal(delayVerdict('Refurbishment periods of 4-6 months could delay redeployment.'), 'stated');
    assert.equal(delayVerdict('Financial closure not complete; vendor timelines may shift commissions'), 'stated');
    assert.equal(delayVerdict('Dahej commissioning delayed from this quarter to next.'), 'deteriorating');
    assert.equal(delayVerdict('Customer-deferred volumes on large CDMO contract.'), 'deteriorating');
  });

  test('reassurances are denials: "projects on schedule", "no stated delays"', () => {
    assert.equal(isDenial3('Projects on schedule; Phase 1 commissioning in Q3.'), true);
    assert.equal(isDenial3('Management says all capex is on track.'), true);
    assert.equal(isDenial3('Plant behind schedule, not on track.'), false);
    const v = extractVariables(null, { risks: { delay: 'Projects are on schedule as per plan.' } }).find((x) => x.key === 'execution_delay')!;
    assert.equal(v.verdict, 'flat');
  });

  test('a hedged figure is a management estimate, not an actual (AZAD "maybe INR1,200 crores")', () => {
    assert.equal(hedgedAround('the asset base is maybe INR1,200 crores including capital WIP', 'INR1,200 crores'), true);
    assert.equal(hedgedAround('Capex for the year was INR1,200 crores.', 'INR1,200 crores'), false);
    const rows = varsFromEvents([EV('capex', 'ACTUAL', null, 'INR1,200 crores', 'Our gross block is maybe INR1,200 crores, including capital work in progress.')], 'Q1 FY27');
    const r = rows.find((x) => x.key === 'capex')!;
    assert.notEqual(r.statement, 'ACTUAL');
  });

  test('one-offs need one-off words, and a headline figure is not an item (IKS PAT INR193 crores)', () => {
    assert.equal(valueFitsVariable({ variable: 'one_offs', before: null, after: 'INR 16,818.00', unit: null, evidence_text: 'Total income INR 16,818.00 INR 14,200.00' }), false);
    assert.equal(valueFitsVariable({ variable: 'one_offs', before: null, after: 'INR193 crores', unit: null,
      evidence_text: 'growth of PAT, which is reflected at about 28% year-on-year, coming in at INR193 crores, which again, if you were to adjust for the one-time exceptional acquisition costs, it goes even higher.' }), false);
    assert.equal(valueFitsVariable({ variable: 'one_offs', before: null, after: 'INR11.5 crores', unit: null,
      evidence_text: 'Q4 had a higher impact because of the one-off, INR56 crores were there, including INR11.5 crores of one- off items.' }), true);
  });

  test('WHAT CHANGED lines separate the variable from its typed value', () => {
    const rows = varsFromEvents([EV('capacity_addition', 'GUIDANCE', null, '8 plants', 'We plan to add 8 plants over the next two years.')], 'Q1 FY27');
    const lines = rowChangeLines(rows, 'Q1 FY27');
    assert.ok(lines.some((l) => / — guidance: 8 plants/.test(l.text)), JSON.stringify(lines));
  });
});

import { scoreCatalyst as scoreCat767 } from '../ai-gainers/catalyst-research';
describe('zzz767 gainers', () => {
  test('a board appointment is never "not yet priced in" (INOD scored 44)', () => {
    const c: any = { subject: 'Innodata appoints Admiral Rogers to its Board', summary: null, kind: 'catalyst', category: 'management_change', stage: 'executed', valueStated: null, incremental: true, ageDays: 5 };
    const s = scoreCat767(c, { marketCap: 2000, returns: { m1: 0.3, m3: -26, m6: null, y1: null } as any, sourceTier: 'primary', verifiedQuote: true });
    assert.ok(s.net <= 15, String(s.net));
    assert.notEqual(s.verdict, 'ROOM');
  });
});
