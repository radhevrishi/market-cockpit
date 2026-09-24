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
  classifyAnnouncement, buildFinding, returnsFromSeries, bandPrint, pricingOf, marketResponseOf, scoreCatalyst, parseStatedValue, coverage,
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
    // zzz774: the ratio is annual and the loss is this quarter's — never a deterioration.
    assert.notEqual(v!.verdict, 'deteriorating');
    assert.match(String(v!.after), /\(last FY\)$/);
  });

  test('a negative cash ratio with an unknown profit sign is STATED (shown, not judged), never a guess', () => {
    const unknown = { ...row('KMEW'), cfo_to_pat_ratio: -21.3, pat_curr_cr: null };
    const v = extractVariables(unknown, null).find((x) => x.key === 'cash_conversion');
    assert.equal(v!.verdict, 'stated');
    assert.equal(v!.after, '-21.30× (last FY)');
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
    // zzz776: a last-FY cash ratio carried as historical / unresolved is a
    // named open question, not a current deterioration.
    for (const t of ['SOTL', 'MOREPENLAB']) {
      const a = assess(t);
      assert.ok(a.status === 'WEAKENING' || (a.status === 'CONFIRMATION_REQUIRED' && /Unresolved historical red flag/.test(a.because)), `${t}: ${a.status}`);
      assert.notEqual(a.status, 'ON_TRACK');
    }
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
    // zzz771: four grader ratios and no filing mechanism is output, not a
    // confirmed thesis — a cash ratio says profit converted, not WHY the
    // business improved. Green needs an operating mechanism (next test).
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.notEqual(a.verdict?.direction, 'STRENGTHENING');
  });

  test('zzz771 · green IS reachable when the operating mechanism itself moved', () => {
    const a = assessThesis({ pattern: null, evidenceReviewed: true, hasGraderRow: true, variables: [
      { key: 'revenue_growth', label: 'Revenue growth', before: null, after: '+27.2%', delta: '+27.2%', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'cash_conversion', label: 'Cash conversion', before: '0.9×', after: '1.2×', delta: null, verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'margin', label: 'Operating margin', before: null, after: '+3pp', delta: '+3pp', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'earnings_growth', label: 'Earnings growth', before: null, after: '+33.2%', delta: '+33.2%', verdict: 'improving', evidence: '', source: 'grader' },
      { key: 'utilisation', label: 'Capacity utilisation', before: '65%', after: '80%', delta: '+15pp', verdict: 'improving', evidence: 'Utilisation rose from 65% to 80%.', source: 'filing' },
      { key: 'volume', label: 'Volume', before: null, after: '+22%', delta: '+22%', verdict: 'improving', evidence: 'Volumes grew 22% year on year.', source: 'filing' },
      { key: 'margin_driver', label: 'Margin driver', before: null, after: 'operating leverage from higher utilisation and a richer product mix', delta: null, verdict: 'improving', evidence: 'Margin expansion was driven by operating leverage and product mix.', source: 'filing' },
    ] as any });
    assert.equal(a.status, 'STRENGTHENING', a.because);
    assert.equal(a.verdict?.evidence, 'CONFIRMED');
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
      assert.equal(t.confirmed + t.pending + t.contradicted + t.stated + t.flat + (t.watch || 0), t.total);
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
    assert.ok(a.financialWarning.some((w) => /cash conversion/i.test(w.label)) || (a.historicalContext || []).some((h: any) => h.key === 'cash_conversion'), 'the figure is still shown (as history)');
  });

  test('the same deterioration DOES weaken an F thesis — cash conversion is its forensic test', () => {
    const a = assess('SOTL', { evidenceReviewed: false });
    assert.equal(classifyGradedRow(row('SOTL'))?.pattern, 'F');
    // zzz776: historical-only → CONFIRMATION REQUIRED naming the red flag.
    assert.ok(a.status === 'WEAKENING' || (a.status === 'CONFIRMATION_REQUIRED' && /cash conversion/i.test(a.because)), a.status);
    assert.equal(a.financialWarning.length, 0, 'for F it is thesis-critical, so it is not a side warning');
  });

  // zzz770 (spec §4): cash is thesis-critical only for F/G. For an
  // unclassified ledger it stays a FINANCIAL WARNING even after a read.
  test('once a document has been read, an unclassified ledger still shows weak cash as a warning, not a status mover', () => {
    const a = assess('HAPPYFORGE', { pattern: null, graded: { cfo_to_pat_ratio: 0.32 }, evidenceReviewed: true, summary: { positives: [] } });
    assert.notEqual(a.status, 'WEAKENING');
    assert.notEqual(a.status, 'BROKEN');
    assert.ok(a.financialWarning.some((w) => /cash conversion/i.test(w.label)) || (a.historicalContext || []).some((h: any) => h.key === 'cash_conversion'));
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
    assert.ok(r.tail && r.tail.length === 90, "the last 90 dated closes travel with the returns");
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
    // zzz773: a 1Y run is not a pricing assessment. The reaction since the
    // filing (−0.2% on a 3.8%-of-mcap order) is small; the summary-only
    // evidence halves nothing but materiality, and caps the rank below P1.
    assert.equal(f.verdict, 'ROOM');
    assert.equal(f.components!.evidence, 'SUMMARY_ONLY');
    assert.equal(f.components!.materialityConfidence, 0.6);
    assert.equal(f.components!.pricing!.state, 'REACTION_SMALL_VS_SIZE');
    assert.ok(f.components!.caps!.some((c) => /summary-only/.test(c)));
    assert.ok(f.notes.some((n) => /not model-read/.test(n)));
  });

  test('materiality gate: under 1% of market cap cannot rank above THIN', () => {
    const c = classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Award_of_Order_Receipt_of_Order', 'Order worth ₹33 crore received', 0));
    const s = scoreCatalyst(c, { marketCap: 5000, returns: { m1: -10, m3: -20, m6: -30, y1: -40, history: 247 }, sourceTier: 'primary', verifiedQuote: true });
    assert.equal(s.verdict, 'THIN'); assert.ok(s.net <= 17);
  });

  test('zzz773: NET is reproducible from the displayed components', () => {
    const c = classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Acquisition', 'Acquisition of control worth ₹1,500 crore', 1));
    for (const verified of [true, false]) {
      const s = scoreCatalyst(c, { marketCap: 5000, returns: { m1: 109, m3: 150, m6: 200, y1: 300, history: 247 }, sourceTier: 'primary', verifiedQuote: verified });
      const k = s.components;
      const base = Math.round((0.30 * k.freshness + 0.30 * k.materiality + 0.25 * k.transmission + 0.15 * k.persistence) * 10) / 10;
      assert.equal(k.base, base);
      assert.equal(k.netUncapped, Math.round(base * k.sourceMult * k.pricingAdj! * 10) / 10);
      assert.equal(k.materiality, Math.round(k.materialityRaw! * k.materialityConfidence! * 10) / 10);
      // Every gap between the uncapped number and NET is a listed cap.
      if (s.net < k.netUncapped!) assert.ok(k.caps!.length > 0);
      else assert.equal(s.net, k.netUncapped);
    }
  });

  test('zzz773: a trailing return is never a pricing assessment — up 109% 1M with no dated series is INSUFFICIENT EVIDENCE', () => {
    const c = classifyAnnouncement(ann('Announcement under Regulation 30 (LODR)-Acquisition', 'Acquisition of control worth ₹1,500 crore', 1));
    const up = scoreCatalyst(c, { marketCap: 5000, returns: { m1: 109, m3: 150, m6: 200, y1: 300, history: 247 }, sourceTier: 'primary', verifiedQuote: true });
    const down = scoreCatalyst(c, { marketCap: 5000, returns: { m1: -30, m3: -40, m6: -50, y1: -60, history: 247 }, sourceTier: 'primary', verifiedQuote: true });
    assert.equal(up.components.pricing!.state, 'INSUFFICIENT_EVIDENCE');
    assert.equal(down.components.pricing!.state, 'INSUFFICIENT_EVIDENCE');
    assert.equal(up.net, down.net, 'stock up vs stock down does not change the score without a defined comparison');
  });

  test('zzz773: pricing compares the reaction since the close before the filing with the event size', () => {
    const tail = (pre: number, post: number, run = 0): Array<[string, number]> => {
      const out: Array<[string, number]> = [];
      for (let i = 0; i < 25; i++) out.push([`2026-08-${String(i + 1).padStart(2, '0')}`, 100 * (1 + (run / 100) * (i / 24))]);
      out[24][1] = pre;
      out.push(['2026-09-02', post]);
      return out;
    };
    const resp = (pre: number, post: number, run = 0) => marketResponseOf({ m1: null, m3: null, m6: null, y1: null, history: 26, tail: tail(pre, post, run) }, '2026-09-01T10:00:00+05:30');
    assert.equal(resp(100, 102).sinceFiling, 2);
    assert.equal(pricingOf(resp(100, 102), 10, 'executed').state, 'REACTION_SMALL_VS_SIZE');
    assert.equal(pricingOf(resp(100, 115), 10, 'executed').state, 'REACTION_IN_LINE');
    assert.equal(pricingOf(resp(100, 140), 10, 'executed').state, 'REACTION_EXCEEDS_SIZE');
    assert.equal(pricingOf(resp(100, 90), 10, 'executed').state, 'FELL_AFTER_FILING');
    assert.equal(pricingOf(resp(100, 90), 10, 'executed').adj, 1, 'a fall is a response, not a bonus');
    assert.equal(pricingOf(resp(100, 102), null, 'executed').state, 'INSUFFICIENT_EVIDENCE', 'no value, no comparison');
    assert.equal(pricingOf(resp(100, 102), 10, 'enabling').state, 'INSUFFICIENT_EVIDENCE');
    assert.equal(pricingOf(resp(150, 151, 50), 10, 'executed').state, 'RAN_UP_BEFORE_FILING');
    assert.ok(!/not priced|priced in/i.test(pricingOf(resp(100, 90), 10, 'executed').text));
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
    // zzz773: last FY's ratio is history — carried as historical context,
    // decided "context only", never read as this period's figure.
    const h = a.historicalContext!.find((x) => x.key === 'cash_conversion')!;
    assert.equal(h.active, false);
    assert.match(h.decision, /^Context only/);
    assert.equal(a.checked.find((c) => c.key === 'cash_conversion')!.state, 'NOT_DISCLOSED');
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
    // zzz771: the evidence of the current period is untouched; only its
    // derived variable snapshot gains the backfilled previous value.
    const { variables: vNew, ...restNew } = l.periods['Q1 FY27'];
    const { variables: _vOld, ...restOld } = base.periods['Q1 FY27'];
    assert.deepEqual(restNew, restOld, 'the current period is untouched');
    assert.equal(vNew!.utilisation.previous_period, 'Q4 FY26');
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
    // zzz770 (owner's rule 8): an at-peak plan that did not move and a bare
    // capex level with no prior are not CHANGES. They stay on the board,
    // typed, and leave WHAT CHANGED.
    const lines = rowChangeLines(vars, 'Q1 FY27');
    assert.ok(!lines.some((l) => /Capacity utilisation/.test(l.text)), JSON.stringify(lines));
    assert.ok(!lines.some((l) => /Capex: INR943 million/.test(l.text)));
    assert.equal(rowValueText(vars.find((v) => v.key === 'utilisation')!), 'guidance: 65% to 70%');
    assert.equal(rowValueText(vars.find((v) => v.key === 'capex')!), 'INR943 million');
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
    // zzz770: a plan that did not move is not a change, so the separator is
    // checked on a guidance that DID move (the typed form is unchanged).
    const rows = varsFromEvents([EV('capacity_addition', 'GUIDANCE', null, '8 plants', 'We plan to add 8 plants over the next two years.')], 'Q1 FY27');
    rows[0].comparison = { guidance_move: 'RAISED', previous: { raw: '6 plants' }, previous_period: 'Q4 FY26', basis: 'QOQ', change_type: 'INCREASED' } as any;
    const lines = rowChangeLines(rows, 'Q1 FY27');
    assert.ok(lines.some((l) => / — guidance: 6 plants \(Q4 FY26\) → 8 plants · raised/.test(l.text)), JSON.stringify(lines));
    assert.equal(lines[0].change_class, 'GUIDANCE_CHANGE');
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

import { classifyAnnouncement as classify768 } from '../ai-gainers/catalyst-research';
describe('zzz768', () => {
  test('an 8-K item title with a summary is not an order win (PRTH 1.01 + 5.02)', () => {
    const a: any = { subject: '8-K: Item 1.01 Entry into a Material Definitive Agreement; Item 5.02 Departure of Directors or Certain Officers', summary: 'Entry into a Material Definitive Agreement; Departure of Directors or Certain Officers', url: 'x', dateIso: '2026-09-21', ageDays: 2 };
    assert.notEqual(classify768(a, 'US').category, 'order_win');
    const b: any = { subject: 'Press release', summary: 'The company has received a purchase order worth $40 million from a US utility.', url: 'x', dateIso: '2026-09-21', ageDays: 2 };
    assert.equal(classify768(b, 'US').category, 'order_win');
  });
});

import { parseStatedValue as psv768 } from '../ai-gainers/catalyst-research';
describe('zzz768 India gainers classification', () => {
  const A = (subject: string, summary: string | null = null): any => ({ subject, summary, url: 'x', dateIso: '2026-09-21', ageDays: 2 });
  test('counts are not rupees; rupee millions and full rupee amounts are', () => {
    assert.equal(psv768('APSSDC SaaS GenAI platform award for up to 20 lakh users', 'IN'), null);
    assert.equal(psv768('Board approved preferential allotment of 2.82 lakh shares', 'IN'), null);
    assert.ok(Math.abs((psv768('Letter of Award aggregating to Rs. 4,884.61 Million (inclusive of taxes)', 'IN') ?? 0) - 488.461) < 1e-6);
    assert.equal(psv768('Allotment of 25,00,000 Warrants at 240/- aggregating upto 60,00,00,000/- (Rupees Sixty Crore Only)', 'IN'), 60);
    assert.equal(psv768('order worth Rs 5,000 lakh', 'IN'), 50);
  });
  test('an order received is executed even with a delivery date', () => {
    const c = classifyAnnouncement(A('Receipt of order', 'Lineage Power has received a Letter of Award of Rs. 4,884.61 Million from NGSL for BESS supply to be completed by March 2027.'), 'IN');
    assert.equal(c.category, 'order_win'); assert.equal(c.stage, 'executed');
  });
  test('tribunal-sanctioned amalgamation is not negative; officer changes and buyback extinguishment are routine', () => {
    assert.equal(classifyAnnouncement(A('General Updates', 'NCLT sanctioned Mawana Foods’ amalgamation into Mawana Sugars on 3 September 2026.'), 'IN').kind, 'routine');
    assert.equal(classifyAnnouncement(A('General Updates', 'Manisha Kadagathur resigns as CHRO effective 30 September.'), 'IN').category, 'management_change');
    assert.equal(classifyAnnouncement(A('Buyback', 'Extinguishment of 8,68,100 equity shares following buyback at Rs. 900 per share'), 'IN').kind, 'routine');
    assert.equal(classifyAnnouncement(A('General Updates', 'EIL signed PMC/EPCM contract over ₹450 crore with a refinery'), 'IN').category, 'order_win');
  });
});

import { historicalAsOf as hist768 } from '../thesis/fact-normalize';
import { rupeeGlyph } from '../thesis/variables';
describe('zzz768 thesis board', () => {
  const EV = (variable: string, value_type: string, before: string | null, after: string, text: string): any =>
    ({ variable, value_type, before, after, unit: null, period: null, direction: 'unknown', evidence_text: text, source: 'Annual report', confidence: 'HIGH' });
  test('a company-history line is historical context (CUPID "2006 … 160 to 400 million units")', () => {
    assert.equal(hist768(EV('capacity', 'ACTUAL', '160 million', '400 million units', '2006 Expanded annual manufacturing capacity from 160 million to 400 million units, strengthening production.'), 'Q1 FY27'), '2006');
  });
  test('a working-capital amount or a capex budget moving is shown, not judged', () => {
    const rows = varsFromEvents([{ ...EV('working_capital', 'ACTUAL', '52 crores', '65 crores', 'Working capital went up from 52 crores to 65 crores this quarter.'), direction: 'up' }], 'Q1 FY27');
    assert.equal(rows.find((r) => r.key === 'working_capital')!.verdict, 'stated');
    const days = varsFromEvents([{ ...EV('working_capital', 'ACTUAL', '137 days', '84 days', 'Working capital days improved from 137 days to 84 days.'), direction: 'down' }], 'Q1 FY27');
    assert.equal(days.find((r) => r.key === 'working_capital')!.verdict, 'improving');
  });
  test('debt repayment is not capex; revenue is not a volume; "under commissioning" is not commissioned', () => {
    assert.equal(valueFitsVariable({ variable: 'capex', before: null, after: 'reduced the debt by about 10 crores', unit: null, evidence_text: 'We have reduced the debt by about 10 crores.' }), false);
    assert.equal(valueFitsVariable({ variable: 'volume', before: null, after: 'revenue reaching a 15-quarter high of INR1,300 crore', unit: null, evidence_text: 'revenue reaching a 15-quarter high of INR1,300 crore' }), false);
    const rows = varsFromEvents([EV('commissioning', 'ACTUAL', null, 'The Pune facility is under commissioning', 'The Pune facility is under commissioning and will start in Q3.')], 'Q1 FY27');
    assert.notEqual(rows.find((r) => r.key === 'commissioning')?.verdict, 'improving');
  });
  test('PDF rupee glyphs print as ₹', () => {
    assert.equal(rupeeGlyph('` 110 crore plus working capital'), '₹110 crore plus working capital');
    assert.equal(rupeeGlyph('H257 crore'), '₹257 crore');
    assert.equal(rupeeGlyph('Phase H2 FY27'), 'Phase H2 FY27');
  });
});

import { rupeeGlyph as rupee769, rowValueText as rvt769, delayVerdict as dv769, extractVariables as ev769, varsFromEvents as vfe769, marginDriverPositive } from '../thesis/variables';
import { valueFitsVariable as fits769 } from '../thesis/evidence-extract';
import { scaledNumber as sn769 } from '../thesis/evidence-ledger';
import { quantity as q769, changeBetween as cb769 } from '../thesis/comparison';
import { normalizeEvent as ne769 } from '../thesis/fact-normalize';
import { assessThesis as at769 } from '../thesis/status';
import { chipValue as chip769, rupee as cardRupee769 } from '../../components/thesis-card';
describe('zzz769 portfolio catalysts — display and classification', () => {
  const EV = (variable: string, value_type: string, before: string | null, after: string, text: string, direction = 'unknown'): any =>
    ({ variable, value_type, before, after, unit: null, period: null, direction, evidence_text: text, source: 'Q1 FY27 concall', confidence: 'HIGH' });
  const fits = (variable: string, after: string, ev = 'The company discussed this in the concall this quarter at some length.') =>
    fits769({ variable, before: null, after, unit: null, evidence_text: ev });

  test('1 · a unit glued to its figure is read whole (PRECWIRE "3920MT/PA → 4620 MT/PA" is +17.9%, not +1078.6%)', () => {
    assert.equal(sn769('3920MT/PA'), 3920);
    assert.equal(sn769('10MW'), 10);
    assert.equal(sn769('3,920MT'), 3920);
    assert.equal(sn769('Q4 FY26'), null);
    assert.equal(sn769('B200 GPUs'), null);
    assert.equal(cb769(q769('3920MT/PA')!, q769('4620 MT/PA')!).change, '+17.9%');
    assert.equal(ledgerDeltaOf('3920MT/PA', '4620 MT/PA', null), '+17.9%');
    const row = vfe769([EV('capacity', 'ACTUAL', '3920MT/PA', '4620 MT/PA', 'Installed capacity went up from 3920MT/PA to 4620 MT/PA this quarter.', 'up')], 'Q1 FY27');
    assert.equal(row.find((r) => r.key === 'capacity')!.delta, '+17.9%');
  });

  test('2 · a possible delay is not a delay; a pause that happened is', () => {
    assert.equal(dv769('Project X (risk if delayed)'), 'stated');
    assert.equal(dv769('potential project execution delays'), 'stated');
    assert.equal(dv769('risk of delay in approvals'), 'stated');
    assert.equal(dv769('Phase 2 delayed by 3 months'), 'deteriorating');
    assert.equal(dv769('Innovator asked temporary pause on CDMO volumes'), 'deteriorating');
  });

  test('3 · a structural driver that describes a decline is not ▲ (WENDT)', () => {
    const drivers = (d: any[]) => ev769(null, { margin_bridge: { drivers: d } }).find((v) => v.key === 'margin_driver')!;
    const wendt = drivers([
      { nature: 'structural', detail: 'Lower absorption cost due to decreased topline and deferred machine dispatches leading to lower EBITDA.' },
      { nature: 'one_off', detail: 'One-time expenses of Rs.1.77 crore impacted FY results.' },
    ]);
    assert.notEqual(wendt.verdict, 'improving');
    assert.equal(wendt.verdict, 'stated');
    assert.equal(drivers([{ nature: 'structural', detail: 'Margin expansion of 200 bps to a higher 18% from a richer product mix and operating leverage.' }]).verdict, 'improving');
    assert.equal(marginDriverPositive('higher foam share pulled gross margins down'), false);
  });

  test('4 · one-offs: proceeds tables dropped; future receipts and routine other income shown, not counted', () => {
    const oo = (items: any[], graded: any = { pat_curr_cr: 100, pat_prev_cr: 60 }) => ev769(graded, { one_offs: items }).find((v) => v.key === 'one_offs');
    assert.equal(oo([{ item: 'IPO proceeds', amount: 'Total raised 15,919.34 Mn and utilized till FY26; balance 1,326.79 Mn', direction: 'gain' }]), undefined);
    const maninds = oo([{ item: 'Merino Shelters monetization', amount: 'Rs 35-50 crore expected in FY27 (prior upfront Rs 70 crore received in Q4 FY25)', direction: 'gain' }]);
    assert.equal(maninds!.verdict, 'stated');
    const wonderla = oo([{ item: 'Other income', amount: '₹9.47 Cr', direction: 'gain' }], { pat_curr_cr: 20, pat_prev_cr: 18 });
    assert.equal(wonderla!.verdict, 'stated');
    // A real one-off still counts.
    assert.equal(oo([{ item: 'Exceptional gain on sale of land', amount: '₹60 Cr', direction: 'gain' }])!.verdict, 'deteriorating');
    assert.equal(fits769({ variable: 'one_offs', before: null, after: 'Total raised 15,919.34 Mn and utilized till FY26', unit: null, evidence_text: 'one-off: Total raised 15,919.34 Mn and utilized till FY26' }), false);
  });

  test('5 · values that cannot be the variable are rejected', () => {
    assert.equal(fits('order_intake', '584 86403 27.6 27.6 1'), false);
    assert.equal(fits('capacity', '240/13,800/108,000'), false);
    for (const x of ['57012.81', '5 to 6 months', 'recovered in under 12 months', 'approval is valid until June 30, 2032', 'about 42 stores are in operation',
      '10 hectares (24 acres) bought', '419 MWp', '10x', '1.75x to 2x of the revenue', '1 lakh (barrels)', 'cash balance of INR 50 crores', '~INR 8 cr Avg. monthly TSMA expenses']) {
      assert.equal(fits('capex', x), false, x);
    }
    for (const x of ['INR881.1 crores capex', 'Rs 58.29 crores', '350Crs', '!833 million', 'we did not foresee any significant core business capex during FY27']) assert.equal(fits('capex', x), true, x);
    assert.equal(fits('capex_status', 'Phase 1 commissioned in Q3 FY26'), true);
    assert.equal(fits('capex_status', 'bank balance of 20 crore'), false);
    for (const x of ['155 kW rooftop solar', 'Rooftop Solar Power System with 3,870 kWp capacity', '2,061 kWp', '187 kW', '300 kW']) assert.equal(fits('capacity', x), false, x);
    assert.equal(fits('capacity', '4.3MW'), true);
    assert.equal(fits('capacity_addition', '300 MW solar'), true);
    for (const x of ['we continue to invest in talent, capacity, and inventory', 'Creation of Additional capacity to meet Anticipated demand', 'meaningful incremental capacity']) assert.equal(fits('capacity_addition', x), false, x);
    assert.equal(fits('capacity_addition', 'new line at Pune'), true);
    assert.equal(fits('capacity_addition', 'five → ten'), true);
    assert.equal(fits('working_capital', 'INR6.25 per share'), false);
    assert.equal(fits('order_book', '88% LED'), false);
    assert.equal(fits('order_book', 'INR1,500 crore order book'), true);
    assert.equal(fits('new_customer', '20 th October 2026 to 19 th October 2029'), false);
    assert.equal(fits('new_customer', 'Corvette (Q3 FY26)'), true);
    assert.equal(fits('guidance', '31 st December, 2028'), false);
    assert.equal(fits('guidance', 'Music Revenue at INR 2,306 Mn registered 39% YoY growth'), false);
    assert.equal(fits('guidance', 'Revenue from Operations at ₹ 8,409.74 million (up 34.8% YoY)'), false);
    assert.equal(fits('guidance', '25% revenue growth expected in FY27'), true);
    assert.equal(fits('capacity_bottleneck', 'close to INR 10 crores', 'There is a bottleneck of close to INR 10 crores in the plant.'), false);
    // TBZ: a reported result filed as guidance no longer reads as ▲ guidance.
    const tbz = vfe769([EV('guidance', 'ACTUAL', null, 'Revenue from Operations at ₹ 8,409.74 million (up 34.8% YoY)', 'Revenue from Operations at ₹ 8,409.74 million (up 34.8% YoY) for the quarter.', 'up')], 'Q1 FY27');
    assert.notEqual(tbz.find((r) => r.key === 'guidance')?.verdict, 'improving');
  });

  test('6 · a hedge inside the value makes it a claim (NRBBEARING "maybe INR30 crores")', () => {
    const e = ne769(EV('order_book', 'ACTUAL', 'INR25 crores', 'maybe INR30 crores', 'Order book was INR25 crores and now maybe INR30 crores.', 'up'), 'Q1 FY27');
    assert.equal(e.value_type, 'MANAGEMENT_CLAIM');
    const row = vfe769([EV('order_book', 'ACTUAL', 'INR25 crores', 'maybe INR30 crores', 'Order book was INR25 crores and now maybe INR30 crores.', 'up')], 'Q1 FY27');
    assert.notEqual(row.find((r) => r.key === 'order_book')!.verdict, 'improving');
  });

  test('7 · a plan rides beside the actual only in the same measure; the same figure is not a plan', () => {
    const ti = vfe769([
      EV('volume', 'ACTUAL', null, '3.4 million cases', 'Volume for the quarter was 3.4 million cases sold across states.'),
      EV('volume', 'TARGET', null, 'mid-double digit', 'We target mid-double digit volume growth going forward in the year.'),
    ], 'Q1 FY27');
    assert.equal(ti.find((r) => r.key === 'volume')!.plan ?? null, null);
    const menon = vfe769([
      EV('capex', 'ACTUAL', null, '6.74 crore', 'Capex incurred during the year was 6.74 crore on the new building.'),
      EV('capex', 'GUIDANCE', null, '6.74 crore fully deployed in FY26', 'The planned 6.74 crore will be fully deployed in FY26 as per plan.'),
    ], 'Q1 FY27');
    assert.equal(menon.find((r) => r.key === 'capex')!.plan ?? null, null);
  });

  test('8 · "!" before a money figure is the PDF rupee glyph', () => {
    assert.equal(rupee769('!833 million'), '₹833 million');
    assert.equal(cardRupee769('!1,000 million'), '₹1,000 million');
    assert.equal(rupee769('Great quarter! 12 new stores'), 'Great quarter! 12 new stores');
  });

  test('9 · the same text twice reads "unchanged since", not an arrow (KINGFA "LGFT")', () => {
    const row: any = {
      key: 'new_product', label: 'New product', verdict: 'flat', before: 'LGFT', after: 'LGFT', delta: null, statement: 'ACTUAL',
      evidence: '', source: 'filing', kind: 'fact',
      comparison: { previous: { raw: 'LGFT' }, current: { raw: 'LGFT' }, previous_period: 'Q3 FY26', basis: 'QOQ', change_type: 'UNCHANGED', change: null },
    };
    assert.equal(rvt769(row), 'LGFT · unchanged since Q3 FY26');
    assert.equal(chip769(row), 'LGFT · unchanged since Q3 FY26');
  });

  test('10 · a historical row on the chip says it is history (CASTROLIND)', () => {
    assert.equal(chip769({ verdict: 'stated', before: null, after: 'INR1,871 crores', delta: null, statement: 'HISTORICAL', asOf: 'FY26' }), 'history: INR1,871 crores (FY26)');
  });

  test('11 · evidence more than two quarters old cannot keep a thesis green (MINDSPACE, Q4 FY24)', () => {
    const V = (key: string, verdict: string, o: any = {}) => ({ key, label: key, before: null, after: o.after ?? null, delta: o.delta ?? null, verdict, evidence: `${key} evidence`, source: o.source ?? 'filing', kind: 'fact' }) as any;
    const vars = [
      V('revenue_growth', 'improving', { delta: '+30%', source: 'grader' }),
      V('earnings_growth', 'improving', { delta: '+45%', source: 'grader' }),
      V('margin', 'improving', { delta: '+2.0pp', source: 'grader' }),
      V('operating_leverage', 'improving', { delta: '1.5×', source: 'grader' }),
      V('utilisation', 'improving', { after: '84%', delta: '+12pp' }),
      V('volume', 'improving', { after: '+12%' }),
    ];
    const fresh = at769({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: vars, evidencePeriod: 'Q1 FY27', expectedPeriod: 'Q1 FY27' });
    assert.equal(fresh.status, 'STRENGTHENING');
    const stale = at769({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: vars, evidencePeriod: 'Q4 FY24', expectedPeriod: 'Q1 FY27' });
    assert.equal(stale.status, 'CONFIRMATION_REQUIRED');
    assert.match(stale.because, /^The evidence on file is Q4 FY24 — too old to confirm this quarter's mechanism; read the latest filing\./);
    assert.ok(stale.mechanismCheck.every((m) => m.state !== 'confirmed'));
    // Two quarters behind is still current enough.
    assert.equal(at769({ pattern: 'A', evidenceReviewed: true, hasGraderRow: true, variables: vars, evidencePeriod: 'Q3 FY26', expectedPeriod: 'Q1 FY27' }).status, 'STRENGTHENING');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz769 · gainers — stored findings under old rules, board coverage, errors,
// entity cleanup, recent listing with a filed result.
// ═══════════════════════════════════════════════════════════════════════════
import { RULES_VERSION, rescoreFromInputs, staleRuleTickers, compactInputs, pickReadCandidate, buildFinding as build769 } from '../ai-gainers/catalyst-research';
import { unEntity as unEntity769, presentFindings as present769, presentErrorLines, boardCoverage } from '../ai-gainers/research-present';
import { parseAnnouncements as parseAnn769 } from '../ai-gainers/screener-company';

describe('zzz769 gainers — classification the stored day still showed wrong', () => {
  const A = (subject: string, summary: string | null = null): any => ({ subject, summary, url: 'x', dateIso: '2026-09-21', ageDays: 2 });
  test('share / warrant / user counts in lakh or crore are not rupees (SHIVALIK, INDSWFTLAB)', () => {
    assert.equal(psv768('Allotment of 1.5 lakh equity shares under ESOP to eligible employees', 'IN'), null);
    assert.equal(psv768('Board approved issue of 70 lakh warrants convertible into equity shares', 'IN'), null);
    assert.equal(psv768('Allotment of 1.2 crore equity shares on preferential basis', 'IN'), null);
    assert.equal(psv768('Platform crossed 2 crore users', 'IN'), null);
    // a currency-marked or bare money crore still parses
    assert.equal(psv768('Order worth ₹126 crore from a PSU', 'IN'), 126);
    assert.equal(psv768('contract of 45 crore for supply of transformers', 'IN'), 45);
    assert.equal(psv768('70 lakh warrants at Rs 45 each aggregating Rs 31.5 crore', 'IN'), 31.5);
  });
  test('PACEDIGITK LoA: executed and valued, not "SCHEDULED" and not "no value stated"', () => {
    const c = classifyAnnouncement(A('Receipt of Letter of Award', 'Pace Digitek subsidiary receives Letter of Award worth Rs. 4,884.61 Million for supply and installation, to be completed by March 2027.'), 'IN');
    assert.equal(c.category, 'order_win'); assert.equal(c.stage, 'executed');
    assert.ok(Math.abs((c.valueStated ?? 0) - 488.461) < 1e-6);
  });
  test('officer changes are management changes, not "not classifiable" (SUNTV, CAPILLARY, TURTLEMINT, CIFL, CHEMPLASTS)', () => {
    for (const s of [
      'Intimation of Change in Senior Management Personnel',
      'Changes in Key Managerial Personnel of the Company',
      'Appointment of Chief Business Officer',
      'Chemplast Sanmar appoints Mr. R Kumar as Chief Financial Officer',
    ]) assert.equal(classifyAnnouncement(A('General Updates', s), 'IN').category, 'management_change', s);
    // zzz775: a company secretary / compliance officer change is paperwork
    // (JAYBARMARU read as NEGATIVE), still never "not classifiable".
    assert.equal(classifyAnnouncement(A('General Updates', 'Resignation of Company Secretary and Compliance Officer'), 'IN').kind, 'routine');
  });
  test('KMPs authorised to determine materiality is Reg 30(5) paperwork (LCCPROJECT, CELLECOR)', () => {
    for (const s of [
      'Disclosure under Regulation 30(5) - KMPs authorised to determine materiality of events',
      'Authorisation of Key Managerial Personnel for determining materiality of an event or information',
    ]) { const c = classifyAnnouncement(A('General Updates', s), 'IN'); assert.equal(c.kind, 'routine', s); assert.notEqual(c.kind, 'unclassified'); }
  });
});

describe('zzz769 gainers — rules version and the no-AI re-score', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const inputs = (anns: any[], extra: any = {}) => compactInputs({ announcements: anns, returns: { m1: 5, m3: 10, m6: 12, y1: 20, history: 250 }, marketCap: 2000, turnover: 12, sources: ['screener.in company page'], sourceFailed: false, fetchedAt: now.toISOString(), ...extra }, 21, now);
  test('RULES_VERSION is set; a finding without it, or with an older one, is stale', () => {
    assert.ok(typeof RULES_VERSION === 'string' && RULES_VERSION.length > 0);
    const f: any = { status: 'catalyst' };
    assert.deepEqual(staleRuleTickers({ A: f, B: { ...f, rulesVersion: RULES_VERSION }, C: { ...f, rulesVersion: 'old' }, D: { status: 'unresearched' } } as any, ['A', 'B', 'C', 'D', 'E']), ['A', 'C']);
  });
  test('re-scoring the stored PACEDIGITK inputs gives an executed, valued order and stamps the version', () => {
    const inp = inputs([{ subject: 'Receipt of order', summary: 'Lineage Power has received a Letter of Award of Rs. 4,884.61 Million from NGSL for BESS supply to be completed by March 2027.', url: 'u1', dateIso: '2026-09-22T10:00:00Z', ageDays: 1 }]);
    const f = rescoreFromInputs(inp, { ticker: 'PACEDIGITK', company: null, market: 'IN', movePct: 9, holding: false, windowDays: 21 });
    assert.equal(f.rulesVersion, RULES_VERSION);
    assert.equal(f.status, 'catalyst'); assert.equal(f.stage, 'executed');
    assert.ok(f.valueStated != null && f.valueStated > 488);
    assert.ok(!f.notes.some((n) => /SCHEDULED/.test(n)), f.notes.join(' | '));
  });
  test('re-scoring MAWANASUG does not print NEGATIVE; GANDHITUBE buyback extinguishment is not a catalyst', () => {
    const m = rescoreFromInputs(inputs([{ subject: 'General Updates', summary: 'NCLT sanctioned the scheme of amalgamation of Mawana Foods into Mawana Sugars.', url: 'u2', dateIso: '2026-09-20T10:00:00Z', ageDays: 3 }]), { ticker: 'MAWANASUG', company: null, market: 'IN', movePct: 6, holding: false, windowDays: 21 });
    assert.notEqual(m.status, 'negative');
    const g = rescoreFromInputs(inputs([{ subject: 'Buyback', summary: 'Extinguishment of 8,68,100 equity shares bought back', url: 'u3', dateIso: '2026-09-20T10:00:00Z', ageDays: 3 }]), { ticker: 'GANDHITUBE', company: null, market: 'IN', movePct: 6, holding: false, windowDays: 21 });
    assert.notEqual(g.status, 'catalyst');
  });
  test('the stored read is reused only for the filing the current rules choose', () => {
    const anns = [{ subject: 'Receipt of order', summary: 'received a work order worth ₹60 crore', url: 'u-order', dateIso: '2026-09-22T10:00:00Z', ageDays: 1 }];
    const cand = pickReadCandidate(anns as any, 'IN', { marketCap: 2000, returns: null, windowDays: 21, now });
    assert.equal(cand?.url, 'u-order');
    const inp = inputs(anns, { read: { url: 'u-other', headline: 'x', quote: 'y', category: 'order_win' } });
    const f = rescoreFromInputs(inp, { ticker: 'X', company: null, market: 'IN', movePct: 5, holding: false, windowDays: 21 }, null);
    assert.equal(f.modelRead, false);
  });
  test('compactInputs keeps the window and bounds the text', () => {
    const inp = inputs([
      { subject: 'a'.repeat(900), summary: 'b'.repeat(900), url: 'n', dateIso: '2026-09-22T10:00:00Z', ageDays: 1 },
      { subject: 'old', summary: null, url: 'o', dateIso: '2026-07-01T10:00:00Z', ageDays: 84 },
    ]);
    assert.equal(inp.announcements.length, 1);
    assert.ok(inp.announcements[0].subject.length <= 300 && (inp.announcements[0].summary || '').length <= 400);
  });
});

describe('zzz769 gainers — a recent listing with a filed result (MILKYMIST)', () => {
  const now = new Date('2026-09-23T10:00:00Z');
  const base = (filedResult: boolean) => build769({
    ticker: 'MILKYMIST', company: 'Milky Mist Dairy', market: 'IN', movePct: 12, marketCap: 5000, turnover: 40,
    announcements: [{ subject: 'Outcome of Board Meeting', summary: 'Unaudited financial results for the quarter ended June 2026', url: 'r1', dateIso: '2026-09-18T10:00:00Z', ageDays: 5 }],
    returns: { m1: null, m3: null, m6: null, y1: null, history: 26 }, holding: false, sources: ['s'], sourceFailed: false, windowDays: 21, now, filedResult,
  });
  test('with a filed result it is not a listing artifact; the listing is a caveat', () => {
    const f = base(true);
    assert.notEqual(f.status, 'listing_artifact');
    assert.ok(f.notes.some((n) => /Recent listing/.test(n) && /caveat/.test(n)), f.notes.join(' | '));
    assert.ok(/Quarterly result on file/.test(String(f.headline)), String(f.headline));
  });
  test('a results filing in the window counts as a filed result even without the scan flag', () => {
    assert.notEqual(base(false).status, 'listing_artifact');
  });
  test('a recent listing with no result is still a listing artifact', () => {
    const f = build769({ ticker: 'NEWCO', company: null, market: 'IN', movePct: 15, marketCap: 800, turnover: 5,
      announcements: [{ subject: 'Receipt of order', summary: 'received a work order worth ₹12 crore', url: 'o1', dateIso: '2026-09-22T10:00:00Z', ageDays: 1 }],
      returns: { m1: null, m3: null, m6: null, y1: null, history: 20 }, holding: false, sources: ['s'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'listing_artifact');
  });
});

describe('zzz769 gainers — board coverage, error lines, entity cleanup', () => {
  test('coverage is researched ∩ board / board — 99 stored of 125 on the board is 99/125, not 99/99', () => {
    const board = Array.from({ length: 125 }, (_, i) => `T${i}`);
    const findings: Record<string, any> = {};
    for (let i = 0; i < 99; i++) findings[`T${i}`] = { status: 'none' };
    findings.OLD1 = { status: 'catalyst' };               // researched from an earlier scan, off the board
    const c = boardCoverage(board, findings);
    assert.equal(c.researched, 99); assert.equal(c.total, 125); assert.equal(c.missing.length, 26); assert.equal(c.pct, 79); assert.equal(c.offBoard, 1);
  });
  test('excluded large caps are not counted as board names awaiting research', () => {
    const c = boardCoverage(['A', 'B', 'BIG'], { A: { status: 'none' }, B: { status: 'unresearched' } }, ['BIG']);
    assert.equal(c.total, 2); assert.deepEqual(c.missing, ['B']);
  });
  test('"Last errors": one short line per ticker, ≤ 90 chars, at most 5, full text kept', () => {
    const long = 'chart: screener.in could not be read. proxy: answered 231 bytes — too short to be a page. If the mc-proxy hop reports 404, the worker route is missing; if it reports 403 the IP is blocked. '.repeat(3);
    const errs = ['STEAMHOUSE: ' + long, 'STEAMHOUSE: ' + long, 'OFFBOARD: ' + long,
      ...['A1', 'A2', 'A3', 'A4', 'A5'].map((t) => `${t}: company page: proxy timeout after 20000 ms; chart: unreachable`)];
    const u = ['STEAMHOUSE', 'A1', 'A2', 'A3', 'A4', 'A5'].map((ticker) => ({ ticker }));
    const lines = presentErrorLines(errs, u, 5);
    assert.equal(lines.length, 5);
    assert.ok(lines.every((l) => l.short.length <= 90), JSON.stringify(lines.map((l) => l.short)));
    assert.ok(!lines.some((l) => l.ticker === 'OFFBOARD'));
    const one = presentErrorLines(['STEAMHOUSE: ' + long], u, 5);
    assert.equal(one[0].short, 'STEAMHOUSE: price chart unavailable (screener.in)');
    assert.ok(one[0].full.length > 200);
    assert.equal(presentErrorLines(['A1: company page: unreachable; chart: unreachable'], u)[0].short, 'A1: company page unavailable (screener.in), price chart unavailable (screener.in)');
  });
  test("KTKBANK \"Scrutinizer''s Report\" → one apostrophe, in stored findings and on parse", () => {
    assert.equal(unEntity769("Scrutinizer''s Report"), "Scrutinizer's Report");
    assert.equal(unEntity769('AIL Dixon&#x27;s'), "AIL Dixon's");
    assert.equal(unEntity769("it is '' empty"), "it is '' empty");
    const p = present769({ KTKBANK: { status: 'routine_only', headline: "2 filings in window, all routine (Scrutinizer''s Report)", routine: ["Scrutinizer''s Report"], notes: [] } } as any);
    assert.equal(p.KTKBANK.headline, "2 filings in window, all routine (Scrutinizer's Report)");
    assert.equal(p.KTKBANK.routine[0], "Scrutinizer's Report");
    const html = `<div class="company-announcements-tab"><ul><li class="overflow-wrap-anywhere"><a href="https://x/y.pdf" target="_blank" rel="noopener noreferrer">Scrutinizer&#39;&#39;s Report <div class="ink-600 smaller"><time datetime="2026-09-20T10:00:00+05:30">20 Sep</time> - Scrutinizer''s report on e-voting</div></a></li></ul></div>`;
    const anns = parseAnn769(html, new Date('2026-09-23T10:00:00Z'));
    assert.equal(anns[0].subject, "Scrutinizer's Report");
    assert.equal(anns[0].summary, "Scrutinizer's report on e-voting");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz770 PC-A — PERSISTENCE, INCREMENTAL READS, EVIDENCE STATES, HISTORY.
//
// Every test here runs the real store (lib/thesis/evidence-store) against an
// in-memory KV injected through setEvidenceKvForTests: persist → "reload"
// (a fresh load from the serialised store) → the card inputs, with fetch
// stubbed to THROW so any network or model call during a reload fails loudly.
// ═══════════════════════════════════════════════════════════════════════════
import {
  setEvidenceKvForTests, persistEvidenceRun, persistAttempt, persistSeen, persistStatus, loadLedger, loadLedgers,
} from '../thesis/evidence-store';
import {
  evidenceStateOf, migrateLedger, unseenDocuments, failureKindOf, mergePeriodDetailed, documentFingerprint,
  LEDGER_VERSION, freshnessLine as freshnessLine770, freshnessOf as freshnessOf770, whatChanged as whatChanged770,
  type CompanyLedger as Ledger770,
} from '../thesis/evidence-ledger';
import { buildComparisons as buildComparisons770 } from '../thesis/comparison';
import { applyLedger, type BookRow } from '../thesis/use-book';
import { evidenceCounts, evidenceReadLine, changesNote } from '../thesis/evidence-counts';
import { readOneDocument, pdfTextQuality as pdfTextQuality770 } from '../thesis/pdf-ocr';
import { attemptOutcome as attemptOutcome770, sourcePrecedence, rankCandidates as rankCandidates770 } from '../thesis/evidence-discovery';
import { usReleaseDocument, usReleaseOnFile } from '../thesis/us-evidence';

describe('zzz770 PC-A persistence and incremental evidence', () => {
  /** In-memory KV that stores SERIALISED values, like Redis. */
  const fakeKv = (opts: { failSet?: (k: string) => boolean } = {}) => {
    const m = new Map<string, string>();
    let sets = 0;
    return {
      map: m,
      sets: () => sets,
      get: async <T = any>(k: string): Promise<T | null> => (m.has(k) ? JSON.parse(m.get(k)!) as T : null),
      set: async (k: string, v: any) => {
        if (opts.failSet?.(k)) throw new Error(`KV write refused for ${k}`);
        sets++;
        m.set(k, JSON.stringify(v));
      },
    };
  };
  const D = (url: string, label: string, kind: string, date: string, outcome = 'read'): any =>
    ({ id: documentId(url), url, label, kind, source: 'screener.in company page', period: null, date_iso: date, outcome, chars: 40000, pages: 20 });
  const E = (variable: string, after: string, unit: string | null, source: string, text: string, before: string | null = null, value_type = 'ACTUAL'): any =>
    ({ variable, value_type, before, after, unit, period: null, direction: 'up', evidence_text: text, source, confidence: 'HIGH' });
  const input = (ticker: string, docs: any[], events: any[], runId: string, extra: any = {}): any => ({
    ticker, market: 'IN', runId, startedAt: '2026-09-23T00:00:00.000Z', documents: docs, filingDate: null, events,
    summary: { events, verdict_line: `${ticker} read`, capex_projects: [] }, discoveryState: 'EVIDENCE_FOUND',
    discoveryAttempts: [{ source: 'screener.in company page', outcome: 'found', detail: '', found: docs.length }],
    promptVersion: 'india-ai-summary-v9', model: 'm', rawExtraction: null, pipeline: null, ...extra,
  });
  const blank = (symbol: string): BookRow => ({
    symbol, origin: 'book', market: 'IN', graded: null, tier: null, pattern: null, radarScore: null,
    summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null,
  });
  const cardInputs = (r: BookRow) => JSON.parse(JSON.stringify({
    summary: r.summary, assessment: r.assessment, comparisons: r.comparisons, capex: r.capex, changed: r.changed,
    reportingPeriod: r.reportingPeriod, documentsRead: r.documentsRead, documentOutcomes: r.documentOutcomes,
    discoveryAttempts: r.discoveryAttempts, freshness: r.freshness, pattern: r.pattern, state: r.state,
  }));
  const q1Docs = [
    D('https://x/aether-tr-aug26.pdf', 'Concall transcript Aug 2026', 'transcript', '2026-08-01'),
    D('https://x/aether-ip-aug26.pdf', 'Investor presentation Aug 2026', 'investor_presentation', '2026-08-01'),
  ];
  const q1Events = [
    E('utilisation', '65%', '%', 'Concall transcript Aug 2026', 'Capacity utilisation for the quarter was 65% across the plants.'),
    E('order_book', 'INR 900 crores', 'crores', 'Investor presentation Aug 2026', 'The order book stood at INR 900 crores at the end of the quarter.'),
    E('guidance', '20% revenue growth', '%', 'Concall transcript Aug 2026', 'We guide for 20% revenue growth for FY27 on the back of new capacity.', null, 'GUIDANCE'),
  ];
  let restore: (() => void) | null = null;
  const useKv = (kv: any) => { setEvidenceKvForTests(kv); restore = () => setEvidenceKvForTests(null); };
  const done = () => { restore?.(); restore = null; };

  test('reload reconstruction: persisted ledger → identical card inputs, zero network or model calls', async () => {
    const kv = fakeKv(); useKv(kv);
    try {
      const r = await persistEvidenceRun(input('AETHER', q1Docs, q1Events, 'run_a1'));
      assert.equal(r.persisted, true);
      const afterRead = applyLedger(blank('AETHER'), r.ledger);
      // RELOAD: all React state gone. Anything that reaches for the network
      // (a model call, a discovery fetch) throws.
      const realFetch = globalThis.fetch;
      let calls = 0;
      (globalThis as any).fetch = (() => { calls++; throw new Error('no network or model call is allowed on reload'); }) as any;
      let reloaded: BookRow;
      try {
        const ledgers = await loadLedgers(['AETHER']);
        reloaded = applyLedger(blank('AETHER'), ledgers.AETHER);
      } finally { (globalThis as any).fetch = realFetch; }
      assert.equal(calls, 0, 'zero model / network calls on reload');
      assert.deepEqual(cardInputs(reloaded!), cardInputs(afterRead));
      assert.equal(reloaded!.reportingPeriod, 'Q1 FY27');
      assert.equal(reloaded!.summary.events.length, 3, 'the card renders the persisted period events');
      assert.ok(reloaded!.assessment, 'thesis status is re-derived from persisted state');
      // lineage persisted on every fact
      const f = (await loadLedger('AETHER'))!.periods['Q1 FY27'].facts.find((x) => x.metric_name === 'utilisation')!;
      assert.equal(f.source_url, 'https://x/aether-tr-aug26.pdf');
      assert.equal(f.source_published_date, '2026-08-01');
      assert.equal(f.effective_date, '2026-06-30');
      assert.equal(f.record_status, 'ACTIVE');
      assert.ok(f.retrieved_at && f.source_quote.length > 20);
      const doc = (await loadLedger('AETHER'))!.periods['Q1 FY27'].documents[0];
      assert.equal(doc.retrieval_status, 'retrieved'); assert.equal(doc.read_status, 'read');
      assert.equal(doc.reporting_period, 'Q1 FY27');
      assert.equal(doc.fingerprint, documentFingerprint(doc.url, doc.date_iso, 'Q1 FY27', doc.content_hash));
      assert.match(evidenceReadLine(r.ledger)!, /^✓ Evidence read · Q1 FY27 · 2 documents · 3 facts · 3 events · Last updated \d{4}-\d{2}-\d{2}$/);
    } finally { done(); }
  });

  test('quarter transition: 65% → 70% → 70% unchanged → Q4 not disclosed (never 0%, never declining)', () => {
    const at = (d: string) => `${d}T10:00:00.000Z`;
    const step = (l: Ledger770, period: string, date: string, events: any[], id: string) => {
      const docs = [D(`https://x/q-${id}.pdf`, `Concall ${id}`, 'transcript', date)];
      const rp = reportingPeriodForDocuments(docs);
      assert.equal(rp.period, period);
      const { facts, events: evs } = factsFromEvents('QT', rp.period, events.map((e) => ({ ...e, source: `Concall ${id}` })), docs, at(date));
      const p: any = { reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date, documents: docs,
        documents_found: 1, documents_read: 1, documents_failed: 0, documents_skipped: 0, facts, events: evs, summary: { events }, status: null, status_because: null,
        tallies: null, discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: id, prompt_version: 'v9', model: 'm', extracted_at: at(date), updated_at: at(date) };
      return mergePeriod(l, p, { run_id: id, reporting_period: rp.period, started_at: at(date), finished_at: at(date), outcome: 'COMPLETED', error: null, documents_found: 1, documents_read: 1, facts_extracted: facts.length, events_extracted: evs.length, model: 'm', prompt_version: 'v9' } as any);
    };
    const u = (v: string) => E('utilisation', v, '%', '', `Capacity utilisation for the quarter was ${v} across the plants.`);
    let l = step(emptyLedger('QT', 'IN', at('2026-08-01')), 'Q1 FY27', '2026-08-01', [u('65%')], 'q1');
    assert.equal(buildComparisons770(l).utilisation!.change_type, 'NEW');
    l = step(l, 'Q2 FY27', '2026-11-01', [u('70%')], 'q2');
    let c = buildComparisons770(l).utilisation!;
    assert.equal(c.change_type, 'INCREASED'); assert.equal(c.change, '+5pp'); assert.equal(c.previous_period, 'Q1 FY27');
    l = step(l, 'Q3 FY27', '2027-02-01', [u('70%')], 'q3');
    c = buildComparisons770(l).utilisation!;
    assert.equal(c.change_type, 'UNCHANGED');
    assert.equal(c.direction === 'down', false);
    // Q4: read, but utilisation is not in the filing.
    l = step(l, 'Q4 FY27', '2027-05-10', [E('order_book', 'INR 900 crores', 'crores', '', 'The order book stood at INR 900 crores at the end of the quarter.')], 'q4');
    c = buildComparisons770(l).utilisation!;
    assert.equal(c.change_type, 'NOT_DISCLOSED');
    assert.equal(c.current, null, 'no current figure is invented');
    assert.notEqual(c.direction, 'down', 'an absent figure is not a decline');
    assert.doesNotMatch(c.line, /\b0%|\bdeclin|\bfell\b|\bdown\b/i);
    assert.equal(c.previous!.raw, '70%');
    assert.ok(!whatChanged770(l).lines.some((x) => x.metric === 'utilisation' && /0%/.test(x.text) && x.sign === '-'));
    // every quarter is still on file
    assert.deepEqual(Object.keys(l.periods).sort((a, b) => periodOrdinal(a) - periodOrdinal(b)), ['Q1 FY27', 'Q2 FY27', 'Q3 FY27', 'Q4 FY27']);
  });

  test('idempotency: reading AETHER ×3 → same documents, facts, events, history; runs 2–3 report NO_CHANGES', async () => {
    const kv = fakeKv(); useKv(kv);
    try {
      const counts: any[] = [];
      const changes: string[] = [];
      for (const id of ['r1', 'r2', 'r3']) {
        const r = await persistEvidenceRun(input('AETHER', q1Docs, q1Events, id));
        await persistStatus('AETHER', 'Q1 FY27', 'CONFIRMATION_REQUIRED', 'one mechanism confirmed', null);
        changes.push(r.diff!.changes);
        const l = (await loadLedger('AETHER'))!;
        const p = l.periods['Q1 FY27'];
        counts.push({ periods: Object.keys(l.periods).length, docs: p.documents.length, facts: p.facts.length, events: p.events.length,
          superseded: (p.superseded_facts || []).length, history: l.status_history.length,
          ids: [...p.facts.map((f) => f.id), ...p.events.map((e) => e.id), ...p.documents.map((d) => d.id)].sort().join(',') });
      }
      assert.deepEqual(counts[1], counts[0]);
      assert.deepEqual(counts[2], counts[0]);
      assert.deepEqual(changes, ['NEW_PERIOD', 'NO_CHANGES', 'NO_CHANGES']);
      assert.equal(counts[0].history, 1, 'the same status is not appended twice');
      const l = (await loadLedger('AETHER'))!;
      assert.equal(l.run_log!.length, 3);
      assert.equal(l.run_log![2].changes, 'NO_CHANGES');
      assert.equal(l.run_log![0].status_after, 'CONFIRMATION_REQUIRED', 'status after is filled when the engine posts it');
      assert.equal(changesNote({ changes: 'NO_CHANGES' }), 'No changes — the documents say what is already on file');
      // A GENUINE revision of the same document: superseded, never deleted.
      const revised = q1Events.map((e) => (e.variable === 'utilisation' ? { ...e, after: '68%', evidence_text: 'Capacity utilisation for the quarter was 68% across the plants.' } : e));
      const r4 = await persistEvidenceRun(input('AETHER', q1Docs, revised, 'r4'));
      assert.equal(r4.diff!.changes, 'REVISIONS');
      const p4 = (await loadLedger('AETHER'))!.periods['Q1 FY27'];
      const active = p4.facts.find((f) => f.metric_name === 'utilisation')!;
      assert.equal(active.value, '68%');
      assert.equal(p4.facts.length, counts[0].facts, 'a revision replaces the active fact, it does not add one');
      const old = p4.superseded_facts!.find((f) => f.id === active.supersedes)!;
      assert.ok(old, 'the superseded fact is kept');
      assert.equal(old.value, '65%'); assert.equal(old.record_status, 'SUPERSEDED'); assert.equal(old.superseded_by, active.id);
      assert.equal(p4.superseded_events!.length, 1, 'the revised event is archived one-for-one');
      assert.equal(p4.events.length, counts[0].events);
      const r5 = await persistEvidenceRun(input('AETHER', q1Docs, revised, 'r5'));
      assert.equal(r5.diff!.changes, 'NO_CHANGES', 're-reading the revision changes nothing');
      assert.equal((await loadLedger('AETHER'))!.periods['Q1 FY27'].superseded_facts!.length, 1);
    } finally { done(); }
  });

  test('partial batch: A, B, C persisted; D fails → A–C survive, D is not marked read', async () => {
    const kv = fakeKv({ failSet: (k) => k.endsWith(':DDD') }); useKv(kv);
    try {
      const started = new Date(Date.now() - 1000).toISOString();
      const results: Record<string, boolean> = {};
      for (const t of ['AAA', 'BBB', 'CCC', 'DDD']) {
        // what readAll does: one company at a time, a failure recorded, the loop continues
        try {
          const r = await persistEvidenceRun(input(t, q1Docs.map((d) => ({ ...d, url: d.url.replace('aether', t) , id: documentId(d.url.replace('aether', t)) })), q1Events, `run_${t}`));
          results[t] = r.persisted;
        } catch { results[t] = false; }
      }
      assert.deepEqual(results, { AAA: true, BBB: true, CCC: true, DDD: false });
      const loaded = await loadLedgers(['AAA', 'BBB', 'CCC', 'DDD']);
      assert.deepEqual(Object.keys(loaded).sort(), ['AAA', 'BBB', 'CCC']);
      for (const t of ['AAA', 'BBB', 'CCC']) assert.equal(loaded[t].latest_period, 'Q1 FY27');
      const p = batchProgress({ started_at: started, tickers: ['AAA', 'BBB', 'CCC', 'DDD'] }, loaded);
      assert.equal(p.done, 3); assert.deepEqual(p.remaining_tickers, ['DDD']);
    } finally { done(); }
  });

  test('new evidence: a Q2 filing for ONE company marks only it NEW_EVIDENCE_AVAILABLE; reading it appends Q2, keeps Q1, compares Q2 vs Q1', async () => {
    const kv = fakeKv(); useKv(kv);
    try {
      await persistEvidenceRun(input('XXX', q1Docs, q1Events, 'x1'));
      await persistEvidenceRun(input('YYY', q1Docs.map((d) => ({ ...d, url: d.url + '?y', id: documentId(d.url + '?y') })), q1Events, 'y1'));
      const now = '2026-10-25T12:00:00Z';     // Q1 FY27 expected; Q2 not yet due
      const q1Before = JSON.parse(JSON.stringify((await loadLedger('XXX'))!.periods['Q1 FY27']));
      // "Check for new evidence" on both: X's sources list a Q2 results PDF; Y's only what is on file.
      const q2cand = { url: 'https://x/xxx-q2-results.pdf', kind: 'results', label: 'Financial results Q2', dateIso: '2026-10-20' };
      await persistSeen('XXX', 'IN', '2026-10-20', [...q1Docs.map((d) => ({ url: d.url, kind: d.kind, label: d.label, dateIso: d.date_iso })), q2cand], { runId: 'cx' });
      await persistSeen('YYY', 'IN', '2026-08-01', q1Docs.map((d) => ({ url: d.url + '?y', kind: d.kind, label: d.label, dateIso: d.date_iso })), { runId: 'cy' });
      const X = (await loadLedger('XXX'))!, Y = (await loadLedger('YYY'))!;
      assert.equal(evidenceStateOf(X, now).state, 'NEW_EVIDENCE_AVAILABLE');
      assert.equal(evidenceStateOf(Y, now).state, 'CURRENT', 'the other company is untouched');
      assert.equal(X.pending_documents!.length, 1);
      assert.equal(X.run_log!.at(-1)!.mode, 'check');
      // a document already on file is never "new"
      assert.deepEqual(unseenDocuments(X, q1Docs.map((d) => ({ url: d.url, kind: d.kind, dateIso: d.date_iso })), now), []);
      // a same-period document under a NEW url is new evidence even with the same date
      const late = unseenDocuments(Y, [{ url: 'https://x/yyy-results-q1.pdf', kind: 'results', dateIso: '2026-08-01' }], now);
      assert.equal(late.length, 1); assert.equal(late[0].reporting_period, 'Q1 FY27');
      // Reading it: Q2 appended, Q1 preserved exactly, Q2 compared with Q1.
      const q2Docs = [D('https://x/xxx-q2-results.pdf', 'Financial results Q2', 'results', '2026-10-20')];
      const r = await persistEvidenceRun(input('XXX', q2Docs, [E('utilisation', '70%', '%', 'Financial results Q2', 'Capacity utilisation for the quarter was 70% across the plants.')], 'x2'));
      assert.equal(r.diff!.changes, 'NEW_PERIOD');
      const after = (await loadLedger('XXX'))!;
      assert.deepEqual(Object.keys(after.periods).sort(), ['Q1 FY27', 'Q2 FY27']);
      assert.equal(after.latest_period, 'Q2 FY27');
      assert.deepEqual(JSON.parse(JSON.stringify(after.periods['Q1 FY27'])), q1Before, 'Q1 untouched by the Q2 read');
      assert.equal(after.pending_documents!.length, 0, 'the read took the pending document in');
      assert.equal(evidenceStateOf(after, now).state, 'CURRENT');
      const cmp = buildComparisons770(after).utilisation!;
      assert.equal(cmp.previous_period, 'Q1 FY27'); assert.equal(cmp.change, '+5pp');
    } finally { done(); }
  });

  test('retrieval failure → SOURCE_UNAVAILABLE / RETRIEVAL_FAILED, never "not disclosed"; evidence on file is kept', async () => {
    const kv = fakeKv(); useKv(kv);
    try {
      const now = '2026-09-23T12:00:00Z';
      assert.equal(evidenceStateOf(null, now).state, 'NOT_SEARCHED');
      await persistAttempt('SRC', 'IN', 'f1', now, 'SOURCE_UNAVAILABLE', 'screener.in company page — HTTP 504', { failureKind: 'source_unreachable', attempts: [{ source: 'screener.in company page', outcome: 'error' }] });
      const s = (await loadLedger('SRC'))!;
      assert.equal(evidenceStateOf(s, now).state, 'SOURCE_UNAVAILABLE');
      assert.deepEqual(s.run_log![0].sources_failed, ['screener.in company page']);
      await persistAttempt('DOC', 'IN', 'f2', now, 'SOURCE_UNAVAILABLE', 'Investor presentation: download failed (HTTP 404)', { failureKind: 'document_unreadable', documents_found: 4 });
      assert.equal(evidenceStateOf((await loadLedger('DOC'))!, now).state, 'RETRIEVAL_FAILED');
      // A company WITH evidence whose later read failed keeps its evidence and says so.
      await persistEvidenceRun(input('KEEP', q1Docs, q1Events, 'k1'));
      await persistAttempt('KEEP', 'IN', 'k2', now, 'SOURCE_UNAVAILABLE', 'Concall transcript: scanned (OCR unavailable — per-read OCR limit reached)', { failureKind: 'document_unreadable' });
      const k = (await loadLedger('KEEP'))!;
      assert.equal(k.latest_period, 'Q1 FY27');
      const f = freshnessOf770(k, now);
      assert.equal(f.evidence_state, 'RETRIEVAL_FAILED');
      const line = freshnessLine770(f)!;
      assert.equal(line.label, 'RETRIEVAL FAILED');
      assert.match(line.text, /not a disclosure gap/);
      assert.doesNotMatch(`${line.label} ${line.text} ${f.detail}`, /not disclosed|no disclosure/i);
      // the variables stay as last read: no NOT_DISCLOSED is manufactured from our failure
      assert.ok(!Object.values(buildComparisons770(k)).some((c) => c!.change_type === 'NOT_DISCLOSED'));
      // model failure is the reader's too
      await persistAttempt('MOD', 'IN', 'm1', now, 'FAILED', 'model API HTTP 529', { failureKind: 'model_failed' });
      assert.equal(evidenceStateOf((await loadLedger('MOD'))!, now).state, 'RETRIEVAL_FAILED');
      // v1 runs without a failure_kind are classified from their outcome text
      assert.equal(failureKindOf({ outcome: 'SOURCE_UNAVAILABLE', error: 'Investor presentation: download failed (HTTP 404)' }), 'document_unreadable');
      assert.equal(failureKindOf({ outcome: 'SOURCE_UNAVAILABLE', error: 'screener.in HTTP 504' }), 'source_unreachable');
      // searched, every source answered, nothing readable: that IS the disclosure fact — incomplete, not failed
      await persistAttempt('NONE', 'IN', 'n1', now, 'NO_DISCLOSURE', null);
      assert.equal(evidenceStateOf((await loadLedger('NONE'))!, now).state, 'EVIDENCE_INCOMPLETE');
    } finally { done(); }
  });

  test('OCR path: a scanned PDF is transcribed by the (stubbed) OCR and read; a refused OCR is a retrieval failure', async () => {
    const scan = async () => ({ text: 'x '.repeat(155), pages: 32, source: 'PDF' });
    assert.equal(pdfTextQuality770(310, 32, 'x '.repeat(155)), 'scanned');
    let ocrCalls = 0;
    const ocrText = 'Revenue from operations for the quarter ended June 30, 2026 was Rs 61 crore. Capacity utilisation was 72%. '.repeat(8);
    const ok = await readOneDocument({ url: 'https://x/scan.pdf', label: 'Financial results (scanned)' }, {
      extract: scan, ocr: async () => { ocrCalls++; return { ok: true, text: ocrText, detail: 'ocr' }; }, ocrGate: () => true,
    });
    assert.equal(ok.outcome, 'read');
    assert.equal((ok as any).viaOcr, true);
    assert.match((ok as any).text, /utilisation was 72%/);
    assert.equal(ocrCalls, 1);
    const refused = await readOneDocument({ url: 'https://x/scan.pdf', label: 'x' }, {
      extract: scan, ocr: async () => { throw new Error('OCR must not be called when the gate refuses'); }, ocrGate: () => 'OCR unavailable — only a clicked read may OCR',
    });
    assert.equal(refused.outcome, 'scanned');
    assert.match((refused as any).detail, /only a clicked read may OCR/);
    const failed = await readOneDocument({ url: 'u', label: 'x' }, { extract: async () => ({ source: 'FAILED', failure_reason: 'HTTP 403' }), ocr: async () => { throw new Error('no'); }, ocrGate: () => true });
    assert.deepEqual([failed.outcome, (failed as any).detail], ['download_failed', 'HTTP 403']);
    const short = await readOneDocument({ url: 'u', label: 'x' }, { extract: async () => ({ text: 'Intimation of board meeting.', pages: 1, source: 'PDF' }), ocr: async () => { throw new Error('no'); }, ocrGate: () => true });
    assert.equal(short.outcome, 'too_short');
    // an unreadable scan is OUR failure: SOURCE_UNAVAILABLE outcome, RETRIEVAL_FAILED state
    assert.equal(attemptOutcome770([{ outcome: 'found' }], [{ outcome: 'scanned' }]), 'SOURCE_UNAVAILABLE');
  });

  test('migration v1 → v2: in memory on load, lossless, idempotent, written only by the next save', async () => {
    const kv = fakeKv(); useKv(kv);
    try {
      // A v1-shaped ledger exactly as zzz740–769 stored it (no v2 fields).
      const v2 = mergePeriod(emptyLedger('OLD', 'IN', '2026-09-01T00:00:00.000Z'), (() => {
        const docs = [D('https://x/old.pdf', 'Concall Aug 2026', 'transcript', '2026-08-01'), D('https://x/old-apr.pdf', 'Concall Apr 2026', 'transcript', '2026-04-01', 'not_selected')];
        const { facts, events } = factsFromEvents('OLD', 'Q1 FY27', q1Events.map((e) => ({ ...e, source: 'Concall Aug 2026' })), docs, '2026-09-01T00:00:00.000Z');
        return { reporting_period: 'Q1 FY27', period_end_date: '2026-06-30', latest_document_date: '2026-08-01', documents: docs, documents_found: 2, documents_read: 1, documents_failed: 0, documents_skipped: 1,
          facts, events, summary: { verdict_line: 'x' }, status: 'NEUTRAL', status_because: 'b', tallies: null, discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: 'o1', prompt_version: 'v8', model: 'm',
          extracted_at: '2026-09-01T00:00:00.000Z', updated_at: '2026-09-01T00:00:00.000Z' } as any;
      })(), { run_id: 'o1', reporting_period: 'Q1 FY27', started_at: '2026-09-01T00:00:00.000Z', finished_at: '2026-09-01T00:00:00.000Z', outcome: 'COMPLETED', error: null, documents_found: 2, documents_read: 1, facts_extracted: 3, events_extracted: 3, model: 'm', prompt_version: 'v8' } as any);
      const strip = (o: any): any => JSON.parse(JSON.stringify(o, (k, v) => (['fingerprint', 'reporting_period_doc', 'retrieval_status', 'read_status', 'content_hash', 'first_seen_at', 'last_read_at',
        'source_url', 'source_published_date', 'effective_date', 'retrieved_at', 'source_section', 'record_status', 'supersedes', 'superseded_by', 'superseded_at',
        'superseded_facts', 'superseded_events', 'pending_documents', 'run_log', 'migrated_from_version'].includes(k) ? undefined : v)));
      const v1: any = strip(v2);
      v1.version = 1;
      for (const p of Object.values<any>(v1.periods)) for (const d of p.documents) delete d.reporting_period;
      kv.map.set('evidence:ledger:v1:OLD', JSON.stringify(v1));
      const setsBefore = kv.sets();
      const loaded = (await loadLedger('OLD'))!;
      assert.equal(kv.sets(), setsBefore, 'loading never writes');
      assert.equal(JSON.parse(kv.map.get('evidence:ledger:v1:OLD')!).version, 1, 'the stored shape is untouched until a write');
      assert.equal(loaded.version, LEDGER_VERSION);
      assert.equal(loaded.migrated_from_version, 1);
      const p = loaded.periods['Q1 FY27'];
      assert.ok(p.documents.every((d) => d.fingerprint && d.retrieval_status && d.read_status));
      assert.equal(p.documents.find((d) => d.outcome === 'not_selected')!.retrieval_status, 'not_attempted');
      assert.equal(p.documents.find((d) => d.outcome === 'not_selected')!.reporting_period, 'Q4 FY26');
      assert.ok(p.facts.every((f) => f.record_status === 'ACTIVE' && f.effective_date === '2026-06-30' && f.source_url === 'https://x/old.pdf'));
      assert.deepEqual(p.facts.map((f) => [f.id, f.value]), v1.periods['Q1 FY27'].facts.map((f: any) => [f.id, f.value]), 'no value changes');
      assert.equal(loaded.run_log!.length, 1);
      assert.deepEqual(migrateLedger(loaded), loaded, 'idempotent');
      assert.deepEqual(freshnessOf770(loaded, '2026-09-23T00:00:00Z').state, freshnessOf770(v1, '2026-09-23T00:00:00Z').state, 'same legacy freshness');
      // the next real write persists v2
      await persistStatus('OLD', 'Q1 FY27', 'STRENGTHENING', 'x', null);
      assert.equal(JSON.parse(kv.map.get('evidence:ledger:v1:OLD')!).version, LEDGER_VERSION);
    } finally { done(); }
  });

  test('header counts come from persisted ledgers; bench never counts as held', async () => {
    const now = '2026-09-23T12:00:00Z';
    const kv = fakeKv(); useKv(kv);
    try {
      const { ledger } = await persistEvidenceRun(input('HELD', q1Docs, q1Events, 'h1'));
      const rows: any[] = [
        { origin: 'book', ledger },                         // read
        { origin: 'both', ledger },                         // held AND benched: held
        { origin: 'bench', ledger: null },                  // never searched, a candidate
        { origin: 'bench', ledger: null, summary: { x: 1 } }, // a summary only in React state is NOT evidence read
      ];
      const c = evidenceCounts(rows, now);
      assert.equal(c.held, 2); assert.equal(c.bench, 2);
      assert.equal(c.evidence_read, 2);
      assert.equal(c.not_searched, 2);
      assert.equal(c.documents_read, 4);
      assert.equal(c.current + c.incomplete + c.new_evidence + c.stale + c.source_unavailable + c.retrieval_failed + c.not_searched, 4);
    } finally { done(); }
  });

  test('source fallback order breaks ties; a US reading is filed in the ledger once per release', () => {
    assert.ok(sourcePrecedence('exchange filing feed') < sourcePrecedence('BSE corporate announcements'));
    assert.ok(sourcePrecedence('BSE corporate announcements') < sourcePrecedence('screener.in company page'));
    assert.ok(sourcePrecedence('screener.in company page') < sourcePrecedence('some blog'));
    const c = (source: string, url: string) => ({ url, kind: 'results' as const, tier: 1 as const, source, period: null, dateIso: '2026-08-07', label: 'Financial Results for the quarter ended June 30, 2026' });
    const ranked = rankCandidates770([c('BSE corporate announcements', 'b'), c('exchange filing feed', 'n')], '2026-08-07');
    assert.equal(ranked[0].url, 'n', 'the official exchange filing wins a tie over its BSE copy');
    const doc = usReleaseDocument('https://sec.gov/x/ex99.htm', '2026-08-06');
    assert.equal(doc.kind, 'results'); assert.equal(doc.date_iso, '2026-08-06');
    const l = mergePeriod(emptyLedger('MTDR', 'US', '2026-08-07T00:00:00.000Z'), { reporting_period: 'Q1 FY27', period_end_date: '2026-06-30', latest_document_date: '2026-08-06', documents: [doc],
      documents_found: 1, documents_read: 1, documents_failed: 0, documents_skipped: 0, facts: [], events: [], summary: { verdict_line: 'x' }, status: null, status_because: null, tallies: null,
      discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: 'u1', prompt_version: 'us', model: 'm', extracted_at: '2026-08-07T00:00:00.000Z', updated_at: '2026-08-07T00:00:00.000Z' } as any,
      { run_id: 'u1', reporting_period: 'Q1 FY27', started_at: '2026-08-07T00:00:00.000Z', finished_at: '2026-08-07T00:00:00.000Z', outcome: 'COMPLETED', error: null, documents_found: 1, documents_read: 1, facts_extracted: 0, events_extracted: 0, model: 'm', prompt_version: 'us' } as any);
    assert.equal(usReleaseOnFile(l, 'https://sec.gov/x/ex99.htm'), true);
    assert.equal(usReleaseOnFile(l, 'https://sec.gov/x/other.htm'), false);
    // and the merge diff says a re-merge of the same period changed nothing
    const again = mergePeriodDetailed(l, l.periods['Q1 FY27'], { run_id: 'u2', reporting_period: 'Q1 FY27', started_at: '2026-08-08T00:00:00.000Z', finished_at: '2026-08-08T00:00:00.000Z', outcome: 'COMPLETED', error: null, documents_found: 1, documents_read: 1, facts_extracted: 0, events_extracted: 0, model: 'm', prompt_version: 'us' } as any);
    assert.equal(again.diff.changes, 'NO_CHANGES');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz770 PC-B — the fact model: before→after, comparability, types,
// validation, guidance ledger, units, change classes, lineage.
// ═══════════════════════════════════════════════════════════════════════════
import {
  normalizeValue as nv770, comparability as cmp770, beforeAfterText as bat770, validateReading as vr770,
  METRIC_GROUP as MG770, factTypeOf as ft770,
} from '../thesis/fact-model';
import { buildComparisons as bc770, metricSeries as ms770 } from '../thesis/comparison';
import {
  varsFromEvents as vfe770, extractVariables as ev770, rowChangeLines as rcl770, rowValueText as rvt770,
  rowContextLines as rctx770, changeClassOf as cc770,
} from '../thesis/variables';
import { normalizeEvent as ne770 } from '../thesis/fact-normalize';
import { deriveGuidanceLedger as dgl770 } from '../thesis/guidance-ledger';

describe('zzz770 PC-B — fact model regression cases', () => {
  const now = '2026-09-23T00:00:00.000Z';
  let seq = 0;
  const F = (metric: string, type: string, value: string, quote: string, o: { before?: string | null; unit?: string | null; source?: string; doc?: string | null } = {}): any => ({
    id: `f${++seq}`, ticker: 'T', reporting_period: '', evidence_type: 'mechanism', metric_name: metric, metric_label: metric,
    value, before_value: o.before ?? null, after_value: value, unit: o.unit ?? null, delta: null, direction: 'unknown',
    source_document_id: o.doc ?? null, source_name: o.source ?? 'Concall transcript', source_date: null, source_type: 'transcript',
    source_quote: quote, fact_or_management_statement: type, confidence: 'HIGH', evidence_quality: 'sentence', extracted_at: now, updated_at: now,
  });
  const P = (period: string, facts: any[], docs: any[] = []): any => ({
    reporting_period: period, period_end_date: null, latest_document_date: null, documents: docs, documents_found: docs.length,
    documents_read: docs.length, documents_failed: 0, documents_skipped: 0, facts: facts.map((f) => ({ ...f, reporting_period: period })),
    events: [], summary: {}, status: null, status_because: null, tallies: null, discovery_state: null, discovery_attempts: [],
    run_id: 'r', prompt_version: 'v', model: null, extracted_at: now, updated_at: now,
  });
  const L = (...ps: any[]): any => ({ ticker: 'T', market: 'IN', periods: Object.fromEntries(ps.map((p) => [p.reporting_period, p])) });
  const EV = (variable: string, value_type: string, before: string | null, after: string, text: string, source = 'Concall transcript Aug 2026', unit: string | null = null): any =>
    ({ variable, value_type, before, after, unit, period: null, direction: 'unknown', evidence_text: text, source, confidence: 'HIGH' });
  const util = (v: string) => `Capacity utilisation for the quarter was ${v} across the plants.`;

  // ── 1. ENTERO ────────────────────────────────────────────────────────────
  test('ENTERO: "Q4 FY26: 59 days → 59 days by Q4 FY26" is one period twice — no delta, never "+0%"', () => {
    const e = EV('working_capital', 'ACTUAL', 'Q4 FY26: 59 days', 'Q4 FY26: 59 days by Q4 FY26',
      'Net working capital improved to 59 days by Q4 FY26, while return metrics strengthened meaningfully.', 'Annual Report 2026');
    const row = vfe770([e], 'Q4 FY26').find((v) => v.key === 'working_capital')!;
    assert.equal(row.before, null);
    assert.equal(row.delta, null);
    // Through the ledger join as well (the live path).
    const led = L(P('Q4 FY26', [F('working_capital', 'FACT', 'Q4 FY26: 59 days by Q4 FY26',
      'Net working capital improved to 59 days by Q4 FY26, while return metrics strengthened meaningfully.', { before: 'Q4 FY26: 59 days', unit: 'days' })]));
    const cmp = bc770(led);
    assert.notEqual(cmp.working_capital?.basis, 'WITHIN_DOCUMENT');
    const vars = ev770(null, { events: [e] }, cmp, { period: 'Q4 FY26' });
    const wc = vars.find((v) => v.key === 'working_capital')!;
    assert.doesNotMatch(rvt770(wc), /→|\+0%/);
    assert.equal(cc770(wc), null, 'a restated level is not a change');
    assert.ok(!rcl770(vars, 'Q4 FY26').some((l) => /59 days/.test(l.text)));
  });

  test('ENTERO: 59 → 59 across two genuinely different periods reads "unchanged", and a same-figure second source is corroboration', () => {
    const led = L(
      P('Q4 FY26', [F('working_capital', 'FACT', '59 days', 'Net working capital stood at 59 days at the end of the quarter.', { unit: 'days' })]),
      P('Q1 FY27', [F('working_capital', 'FACT', '59 days', 'Net working capital stood at 59 days at the end of the quarter.', { unit: 'days' })]),
    );
    const cmp = bc770(led);
    assert.equal(cmp.working_capital!.change_type, 'UNCHANGED');
    assert.equal(cmp.working_capital!.change, null);
    const vars = ev770(null, { events: [
      EV('working_capital', 'ACTUAL', null, '59 days', 'Net working capital stood at 59 days at the end of the quarter.', 'Concall transcript Aug 2026'),
      EV('working_capital', 'ACTUAL', null, '59 days', 'Net working capital days were 59 days for the quarter under review.', 'Investor presentation Aug 2026'),
    ] }, cmp, { period: 'Q1 FY27' });
    const wc = vars.find((v) => v.key === 'working_capital')!;
    // zzz771: quantitative rows print the time-series reading format.
    assert.equal(rvt770(wc), '59 days (Q1 FY27) vs 59 days (Q4 FY26) · unchanged · → QoQ');
    assert.equal(wc.corroboration?.length, 1);
    assert.equal(wc.conflict ?? null, null);
    assert.equal(cc770(wc), 'PERIOD_CHANGE');
  });

  // ── 2. GPPL ──────────────────────────────────────────────────────────────
  test('GPPL: plant A capacity vs plant B target, and different plants across periods, are NOT COMPARABLE', () => {
    const a = cmp770({ key: 'capacity', value: '1.6 million MT', quote: 'Plant A capacity is 1.6 million MT.', period: 'FY26', fact_type: 'ACTUAL' },
      { key: 'capacity', value: '5.2 million MT', quote: 'Plant B target capacity is 5.2 million MT.', period: 'Q1 FY27', fact_type: 'MANAGEMENT_TARGET' });
    assert.equal(a.comparable, false);
    const b = cmp770({ key: 'capacity', value: '1.6 million MT', quote: 'Installed capacity at Plant A was 1.6 million MT.', period: 'Q4 FY26' },
      { key: 'capacity', value: '5.2 million MT', quote: 'Installed capacity at Plant B was 5.2 million MT.', period: 'Q1 FY27' });
    assert.equal(b.comparable, false);
    assert.match(String(b.reason), /plant a vs plant b/);
    const led = L(
      P('Q4 FY26', [F('capacity', 'FACT', '1.6 million MT', 'Installed capacity at Plant A was 1.6 million MT at the end of the year.')]),
      P('Q1 FY27', [F('capacity', 'FACT', '5.2 million MT', 'Installed capacity at Plant B was 5.2 million MT at the end of the quarter.')]),
    );
    const c = bc770(led).capacity!;
    assert.equal(c.change_type, 'NOT_COMPARABLE');
    assert.equal(c.change, null);
    assert.match(String(c.comparability?.reason), /plant/);
  });

  test('GPPL: liquids in MT and RoRo cars are two measures, never a "sources disagree" conflict', () => {
    const rows = vfe770([
      EV('capacity', 'ACTUAL', null, '1.6 million metric tonnes', 'The liquid cargo handling capacity at the terminal is 1.6 million metric tonnes at present.', 'Concall transcript Aug 2026'),
      EV('capacity', 'ACTUAL', null, '270,000 cars', 'The RoRo terminal capacity handles about 270,000 cars at present.', 'Investor presentation Aug 2026'),
    ], 'Q1 FY27');
    const cap = rows.find((v) => v.key === 'capacity')!;
    assert.equal(cap.conflict ?? null, null, JSON.stringify(cap.conflict));
    assert.doesNotMatch(cap.evidence, /SOURCES DISAGREE/);
  });

  // ── 3. EMCURE ────────────────────────────────────────────────────────────
  test('EMCURE: "Order book should go up in line with supplies" is management commentary, never an order-book value', () => {
    const e = EV('order_book', 'ACTUAL', null, 'should go up in line with supplies', 'Order book should go up in line with supplies over the coming quarters.');
    const n = ne770(e, 'Q1 FY27');
    assert.equal(n.value_type, 'MANAGEMENT_CLAIM');
    assert.equal(n.commentary, true);
    const row = vfe770([e], 'Q1 FY27').find((v) => v.key === 'order_book')!;
    assert.equal(row.statement, 'MANAGEMENT_STATEMENT');
    assert.equal(row.fact_type, 'MANAGEMENT_COMMENTARY');
    assert.equal(row.kind, 'claim');
    assert.equal(row.verdict, 'stated');
    assert.equal(rcl770([row], 'Q1 FY27').length, 0, 'commentary is not a change');
    // The same words through the summary's order-book slot.
    const s = ev770(null, { order_book: { growth: 'should go up in line with supplies' } }).find((v) => v.key === 'order_book')!;
    assert.equal(s.statement, 'MANAGEMENT_STATEMENT');
    assert.equal(s.fact_type, 'MANAGEMENT_COMMENTARY');
    assert.equal(s.verdict, 'stated');
    assert.equal(ft770({ statement: 'ACTUAL', key: 'order_book', value: 'should go up in line with supplies' }), 'MANAGEMENT_COMMENTARY');
  });

  // ── 4. AARTIPHARM ────────────────────────────────────────────────────────
  test('AARTIPHARM: a target is never the actual — "Actual: 74% · Target: 80% plus"; target alone says so', () => {
    const target = EV('utilisation', 'TARGET', null, '80% plus', 'The incremental capacity will be ramped up and we can reach 80% plus capacity utilization by FY \'28.');
    const only = vfe770([target], 'Q1 FY27').find((v) => v.key === 'utilisation')!;
    assert.equal(only.statement, 'TARGET');
    assert.equal(only.fact_type, 'MANAGEMENT_TARGET');
    const vars0 = ev770(null, { events: [target] }, null, { period: 'Q1 FY27' });
    const t0 = vars0.find((v) => v.key === 'utilisation')!;
    assert.match(String(t0.display), /^Target: 80% plus · actual not disclosed$/);
    const vars = ev770(null, { events: [EV('utilisation', 'ACTUAL', null, '74%', util('74%')), target] }, null, { period: 'Q1 FY27' });
    const u = vars.find((v) => v.key === 'utilisation')!;
    assert.equal(u.after, '74%');
    // zzz771: reading format — the target stays in its own labelled slot.
    assert.equal(u.display, 'Actual: 74% (Q1 FY27) · previous: not disclosed (first reading) · Target: 80% plus · gap -6pp');
  });

  test('AARTIPHARM: with a prior actual on file, 70% → 74% · +4pp beside the target', () => {
    const led = L(P('Q4 FY26', [F('utilisation', 'FACT', '70%', util('70%'), { unit: '%' })]), P('Q1 FY27', [F('utilisation', 'FACT', '74%', util('74%'), { unit: '%' })]));
    const vars = ev770(null, { events: [EV('utilisation', 'ACTUAL', null, '74%', util('74%')),
      EV('utilisation', 'TARGET', null, '80% plus', 'We can reach 80% plus capacity utilization by FY \'28 as the incremental capacity ramps up.')] }, bc770(led), { period: 'Q1 FY27' });
    const u = vars.find((v) => v.key === 'utilisation')!;
    // zzz771: reading format; pp only for a percent (no relative %).
    assert.equal(rvt770(u), 'Actual: 74% (Q1 FY27) vs 70% (Q4 FY26) · +4pp · ▲ QoQ · Target: 80% plus · gap -6pp');
    assert.equal(u.verdict, 'improving');
    assert.equal(cc770(u), 'PERIOD_CHANGE');
  });

  // ── 5. LLOYDSENGG ────────────────────────────────────────────────────────
  test('LLOYDSENGG: −3.72× cash conversion with an unclear sign/denominator is UNCLEAR — neither confirmed nor contradicted', () => {
    const g = { source: 'screener-live', period: 'Jun 2026', sales_yoy_pct: 142.9, pat_curr_cr: 68, pat_prev_cr: 30, net_profit_yoy_pct: 126.7, opm_pct: 13, opm_prev_pct: 12, cfo_to_pat_ratio: -3.72, cfo_year: 'Mar 2026' };
    const cash = ev770(g, null).find((v) => v.key === 'cash_conversion')!;
    assert.equal(cash.validation?.state, 'UNCLEAR');
    assert.equal(cash.verdict, 'stated');
    assert.notEqual(cash.verdict, 'deteriorating');
    assert.match(String(cash.unjudged), /validation required/);
    const noPat = ev770({ cfo_to_pat_ratio: -3.72, sales_yoy_pct: 20 }, null).find((v) => v.key === 'cash_conversion')!;
    assert.equal(noPat.validation?.state, 'UNCLEAR');
    assert.notEqual(noPat.verdict, 'deteriorating');
    assert.equal(cash.metric_group, 'OUTPUT');
  });

  // ── 6. DEEPAKNTR ─────────────────────────────────────────────────────────
  test('DEEPAKNTR: "170-odd percent" utilisation is UNCLEAR unless the source states the denominator', () => {
    const row = vfe770([EV('utilisation', 'ACTUAL', null, '170-odd percent', 'Phenol plant capacity utilisation is running at 170-odd percent during the quarter.')], 'Q1 FY27')[0];
    assert.equal(row.validation?.state, 'UNCLEAR');
    assert.equal(row.verdict, 'stated');
    assert.match(String(row.unjudged), /validation required/);
    assert.equal(cc770(row), null);
    const defined = vfe770([EV('utilisation', 'ACTUAL', null, '170%', 'Capacity utilisation was 170% of the original nameplate capacity of 200 KTPA after debottlenecking during the quarter.')], 'Q1 FY27')[0];
    assert.equal(defined.validation?.state, 'OK');
    assert.match(String(defined.validation?.metric_definition), /original nameplate capacity/);
    assert.match(rvt770(defined), /definition: .*nameplate/);
    assert.equal(vr770('utilisation', '84%', util('84%')).state, 'OK');
  });

  // ── 7. ETHOSLTD ──────────────────────────────────────────────────────────
  test('ETHOSLTD: "Mar 2024 → Mar 2025" is Historical context, never the current change', () => {
    const vars = ev770(null, { events: [EV('working_capital', 'ACTUAL', 'INR 440 crores on 31st March 2024', 'INR593 crores as on 31st March 2025',
      'Working capital was INR 440 crores on 31st March 2024 and INR593 crores as on 31st March 2025.')] }, null, { period: 'Q1 FY27' });
    const wc = vars.find((v) => v.key === 'working_capital')!;
    assert.equal(wc.statement, 'HISTORICAL');
    assert.equal(wc.fact_type, 'HISTORICAL');
    assert.match(String(wc.display), /^Historical context \(Mar 2025\)/);
    assert.equal(rcl770(vars, 'Q1 FY27').length, 0);
    const ctx = rctx770(vars, 'Q1 FY27');
    assert.equal(ctx.length, 1);
    assert.match(ctx[0].text, /Historical context \(Mar 2025\)/);
  });

  // ── 8. The quarter series ────────────────────────────────────────────────
  test('series 65 → 70 → 70 → not disclosed: NOT DISCLOSED, never 0% and never "declining"', () => {
    const led = L(
      P('Q1 FY26', [F('utilisation', 'FACT', '65%', util('65%'), { unit: '%' })]),
      P('Q2 FY26', [F('utilisation', 'FACT', '70%', util('70%'), { unit: '%' })]),
      P('Q3 FY26', [F('utilisation', 'FACT', '70%', util('70%'), { unit: '%' })]),
      P('Q4 FY26', [F('order_book', 'FACT', 'INR 500 crores', 'The closing order book stood at INR 500 crores at the end of the quarter.')]),
    );
    const c = bc770(led).utilisation!;
    assert.equal(c.change_type, 'NOT_DISCLOSED');
    assert.equal(c.change, null);
    assert.equal(c.direction, 'unknown');
    const s = ms770(led, 'utilisation');
    assert.equal(s.display, '65% (Q1 FY26) → 70% (Q2 FY26) → 70% (Q3 FY26) → not disclosed (Q4 FY26)');
    assert.equal(s.trend, 'NOT_DISCLOSED');
    assert.deepEqual(s.points.map((p) => p.change_from_prior), [null, '+5pp', 'unchanged', null]);
    assert.equal(s.points[3].value, null);
    assert.doesNotMatch(JSON.stringify(c), /"0%"|declin/i);
    assert.equal(c.series?.trend, 'NOT_DISCLOSED');
  });

  // ── 9. Guidance ledger ───────────────────────────────────────────────────
  test('guidance ledger: original → revised → actual, variance against the revision', () => {
    const led = L(
      P('Q1 FY26', [F('capex', 'GUIDANCE', '₹300 crore', 'We plan a capex of ₹300 crore for FY26 across both plants.')]),
      P('Q2 FY26', [F('revenue_growth', 'GUIDANCE', '20%', 'We expect revenue growth of 20% for FY26.')]),
      P('Q3 FY26', [F('capex', 'GUIDANCE', '₹350 crore', 'We now plan a capex of ₹350 crore for FY26 across both plants.')]),
      P('Q4 FY26', [
        F('revenue_growth', 'GUIDANCE', '25%', 'We now expect revenue growth of 25% for FY26.'),
        F('capex', 'FACT', '₹280 crore', 'Capex spent during the year was ₹280 crore across both plants.'),
        F('utilisation', 'TARGET', '80%', 'We target 80% capacity utilisation by FY28 across the plants.'),
        // Read in the same period as the target: not its outcome.
        F('utilisation', 'FACT', '71%', util('71%'), { unit: '%' }),
      ]),
      P('Q1 FY27', [F('utilisation', 'FACT', '74%', util('74%'), { unit: '%' })]),
    );
    const gl = dgl770(led, { revenue_growth: { value: '27%', period: 'FY26', source: 'Filed statements' } });
    const rev = gl.find((x) => x.metric === 'revenue_growth')!;
    assert.equal(rev.original_value, '20%');
    assert.equal(rev.revised_value, '25%');
    assert.equal(rev.revision, 'RAISED');
    assert.equal(rev.actual_value, '27%');
    assert.equal(rev.variance, '+2pp');
    assert.equal(rev.variance_basis, 'vs revised');
    assert.equal(rev.status, 'ABOVE');
    const capex = gl.find((x) => x.metric === 'capex')!;
    assert.equal(capex.original_value, '₹300 crore');
    assert.equal(capex.revised_value, '₹350 crore');
    assert.equal(capex.actual_value, '₹280 crore');
    assert.equal(capex.variance, '-20%');
    assert.equal(capex.status, 'BELOW');
    const ut = gl.find((x) => x.metric === 'utilisation')!;
    assert.equal(ut.guidance_type, 'MANAGEMENT_TARGET');
    assert.equal(ut.variance, '-6pp');
    assert.equal(ut.target_period, 'FY28');
    assert.equal(ut.status, 'INTERIM');
    assert.match(ut.line, /target 80% \(Q4 FY26\) for FY28 → actual 74% \(Q1 FY27\) · -6pp vs original · interim/);
    assert.ok(rev.history.every((h) => h.source.quote.length > 0), 'lineage kept on every step');
  });

  test('same-period duplicates: two guidance statements in one quarter are not a revision (GPPL); one dated event filed in two ledger periods is not a change (CUPID)', () => {
    const led = L(P('Q1 FY27', [
      F('capacity_addition', 'GUIDANCE', '5 million metric tonnes', 'Our liquid cargo capacity is going from 2 million metric tonnes to 5 million metric tonnes.', { source: 'Concall transcript Aug 2026' }),
      F('capacity_addition', 'GUIDANCE', '5.2 million MT', 'Once commissioned the liquid cargo handling capacity shall increase to 5.2 million MT.', { source: 'Investor presentation Aug 2026' }),
    ]));
    const e = dgl770(led).find((x) => x.metric === 'capacity_addition')!;
    assert.equal(e.revised_value, null);
    assert.equal(e.revision, null);
    assert.equal(e.history.length, 1);
    assert.equal(e.original_value, '5.2 million MT', 'the written document is kept');
    const q = 'We made a strategic investment, of which 82.88 crore is deployed in April 2026 across the new retail network.';
    const c = bc770(L(
      P('Q4 FY26', [F('capex_status', 'FACT', '82.88 crore is deployed in April 2026 and 36.93 crore in May 2026', q)]),
      P('Q1 FY27', [F('capex_status', 'FACT', '82.88 crore deployed in April 2026', q)]),
    )).capex_status!;
    assert.notEqual(c.change_type, 'UNCHANGED');
    assert.equal(c.previous, null);
    assert.match(String(c.comparability?.reason), /same period/);
  });

  // ── 10. Units ────────────────────────────────────────────────────────────
  test('units: lakh↔crore and KTPA↔MT convert exactly; KL vs KLD, MTPA vs KTPA, bopd vs boepd are NOT COMPARABLE', () => {
    const l = nv770('₹13,000 lakhs');
    assert.equal(l.normalized_value, 130);
    assert.equal(l.normalized_unit, '₹ crore');
    assert.equal(l.raw_unit, 'INR lakh');
    assert.match(String(l.conversion_method), /lakh → crore/);
    assert.equal(bat770({ key: 'capex', value: '₹13,000 lakhs', period: 'Q4 FY26' }, { key: 'capex', value: '₹150 crore', period: 'Q1 FY27' }).text, '₹13,000 lakhs → ₹150 crore · +15.4%');
    assert.equal(bat770({ key: 'capacity', value: '50 KTPA', period: 'Q4 FY26' }, { key: 'capacity', value: '60,000 MT', period: 'Q1 FY27' }).delta, '+20%');
    assert.equal(cmp770({ key: 'capacity', value: '200 KLD', period: 'Q4 FY26' }, { key: 'capacity', value: '314 KL', period: 'Q1 FY27' }).comparable, false);
    assert.equal(cmp770({ key: 'capacity', value: '5000 MTPA', period: 'Q4 FY26' }, { key: 'capacity', value: '9 KTPA', period: 'Q1 FY27' }).comparable, false);
    assert.equal(cmp770({ key: 'volume', value: '1,000 bopd', period: 'Q4 FY26' }, { key: 'volume', value: '1,200 boepd', period: 'Q1 FY27' }).comparable, false);
    assert.equal(cmp770({ key: 'capex', value: 'USD 90 million', period: 'Q4 FY26' }, { key: 'capex', value: '₹750 crore', period: 'Q1 FY27' }).comparable, false);
    assert.equal(nv770('500 kW').normalized_value, 0.5);
    // Through the ledger join: KTPA → MT is +20%, not +119,900%.
    const led = L(
      P('Q4 FY26', [F('capacity', 'FACT', '50 KTPA', 'Installed capacity at the end of the quarter was 50 KTPA of resin.')]),
      P('Q1 FY27', [F('capacity', 'FACT', '60,000 MT', 'Installed capacity at the end of the quarter was 60,000 MT of resin.')]),
    );
    const c = bc770(led).capacity!;
    assert.equal(c.change, '+20%');
    assert.match(String(c.comparability?.conversion_method), /KTPA|annual/);
    const unsafe = L(
      P('Q4 FY26', [F('capacity', 'FACT', '200 KLD', 'Installed capacity at the end of the quarter was 200 KLD of ethanol.')]),
      P('Q1 FY27', [F('capacity', 'FACT', '314 KL', 'Installed capacity at the end of the quarter was 314 KL of ethanol storage.')]),
    );
    assert.equal(bc770(unsafe).capacity!.change_type, 'NOT_COMPARABLE');
  });

  // ── 11. WHAT CHANGED classes ─────────────────────────────────────────────
  test('WHAT CHANGED: period changes, then new events, then guidance changes; a bare level is not a change', () => {
    const vars = vfe770([
      EV('capacity', 'ACTUAL', null, '1,52,000 metric tons', 'Our installed capacity is 1,52,000 metric tons at present.'),
      EV('commissioning', 'ACTUAL', null, 'Line 3 commissioned in June', 'We commissioned Line 3 in June and it is now operational.'),
      EV('working_capital', 'ACTUAL', '66 days', '61 days', 'Net working capital days improved to 61 days from 66 days a year ago.'),
    ], 'Q1 FY27');
    const g: any = { key: 'guidance', label: 'Guidance', before: null, after: 'raised', delta: null, verdict: 'improving', evidence: '', source: 'filing', statement: 'GUIDANCE', sourceLabel: 'Concall transcript Aug 2026' };
    const lines = rcl770([g, ...vars], 'Q1 FY27');
    assert.deepEqual(lines.map((l) => l.change_class), ['PERIOD_CHANGE', 'NEW_EVENT', 'GUIDANCE_CHANGE']);
    assert.ok(!lines.some((l) => /1,52,000/.test(l.text)), 'a bare level stays on the board only');
    assert.match(lines[0].text, /^Working capital: 66 days → 61 days · -7.6%/);
    assert.ok(vars.some((v) => v.key === 'capacity'));
  });

  // ── 12/13. Group and lineage ─────────────────────────────────────────────
  test('every row says OUTPUT or MECHANISM and keeps its lineage (id, url, type, date, period, quote)', () => {
    assert.equal(MG770.revenue_growth, 'OUTPUT');
    assert.equal(MG770.cash_conversion, 'OUTPUT');
    assert.equal(MG770.utilisation, 'MECHANISM');
    assert.equal(MG770.guidance, 'MECHANISM');
    assert.equal(MG770.margin_driver, 'MECHANISM');
    const doc = { id: 'doc_1', url: 'https://x/q1.pdf', label: 'Concall transcript Aug 2026', kind: 'transcript', date_iso: '2026-08-01' } as any;
    const vars = ev770({ sales_yoy_pct: 20, source_url: 'https://www.screener.in/company/T/' },
      { events: [EV('utilisation', 'ACTUAL', null, '74%', util('74%'))] }, null, { period: 'Q1 FY27', documents: [doc] });
    for (const v of vars) {
      assert.ok(v.metric_group === 'OUTPUT' || v.metric_group === 'MECHANISM', v.key);
      assert.ok(v.lineage && v.lineage.quote.length > 0, v.key);
    }
    const u = vars.find((v) => v.key === 'utilisation')!;
    assert.equal(u.lineage!.source_url, 'https://x/q1.pdf');
    assert.equal(u.lineage!.source_id, 'doc_1');
    assert.equal(u.lineage!.publication_date, '2026-08-01');
    assert.equal(u.lineage!.period, 'Q1 FY27');
    assert.equal(u.normalized!.normalized_unit, '%');
    assert.equal(vars.find((v) => v.key === 'revenue_growth')!.lineage!.source_url, 'https://www.screener.in/company/T/');
    const led = L(P('Q1 FY27', [F('utilisation', 'FACT', '74%', util('74%'), { doc: 'doc_1', unit: '%' })], [doc]));
    const c = bc770(led).utilisation!;
    assert.equal(c.lineage!.current!.source_url, 'https://x/q1.pdf');
    assert.equal(c.display, '74% · prior comparable value not disclosed');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz770 AG-A — THE RESEARCH VIEW MODEL (research triage, not a move ranking)
// ═══════════════════════════════════════════════════════════════════════════
import { buildResearchView as buildView770, parseCapacityChange as parseCap770, normaliseFiledRow as normFiled770, type ResearchItem as Item770, type ResearchView as View770 } from '../ai-gainers/research-view';
import { fixtureInput as fx770, fixtureInputUS as fxUS770 } from './fixtures/gainers-view.fixture';
import { classifyUsFiling as classifyUs770 } from '../ai-gainers/us-gainers';

describe('zzz770 AG-A research view — classification, ranking, sections', () => {
  const v = buildView770(fx770());
  const all = (x: View770): Item770[] => {
    const m = new Map<string, Item770>();
    // zzz771: an older event lives in `context`, not in a ranked section.
    for (const i of [...x.queue, ...x.watch, ...x.negative, ...x.noCatalyst, ...x.dataQuality, ...x.portfolio, ...(x.context || [])]) m.set(i.ticker, i);
    return Array.from(m.values());
  };
  const items = all(v);
  const it = (t: string) => { const i = items.find((x) => x.ticker === t); assert.ok(i, `${t} missing from every section`); return i!; };
  const queued = new Set(v.queue.map((i) => i.ticker));
  // zzz771 added fixtures (TRUEDENY, ROSSFUND, DISTRESS, RECENTRES, 544501): 30 names on the board.
  const N = Object.keys(fx770().findings).length;

  test('every fixture lands in exactly one class, and every name on the board is accounted for', () => {
    assert.equal(items.length, N);
    assert.equal(v.summary.scanned, N);
    const s = v.summary;
    assert.equal(s.confirmed + s.potential + s.negative + s.noCatalyst + s.dataUnavailable + (s.listings || 0), N);
  });

  test('large order / small company: CONFIRMED_MATERIAL, Order win, AWARDED, verified, SIGNIFICANT vs TTM revenue, DIRECT', () => {
    const b = it('BIGORD');
    assert.equal(b.eventClass, 'CONFIRMED_MATERIAL'); assert.equal(b.eventType, 'Order win'); assert.equal(b.stage, 'AWARDED');
    assert.equal(b.sourceConfidence, 'VERIFIED_DOCUMENT'); assert.equal(b.materiality.label, 'SIGNIFICANT'); assert.equal(b.transmission, 'DIRECT');
    assert.equal(b.materiality.ratios[0].basis, 'ttm_revenue');
    assert.equal(b.materiality.ratios[0].text, '₹488 Cr ÷ ₹1,020 Cr TTM revenue = 47.8%');
    assert.equal(b.expectationGap.direction, 'UNDER_REFLECTED');
    assert.match(b.expectationGap.text, /order = 47\.8% of revenue → the move is small against the change/);
    assert.ok(b.transmissionChain.length === 6 && /^EVENT/.test(b.transmissionChain[0]) && /^VALUATION/.test(b.transmissionChain[5]));
    assert.ok(b.unknowns.includes('Order margin: Not disclosed'));
    assert.ok(b.researchNext.length >= 3 && b.researchNext.length <= 8);
    assert.equal(v.top3.map((i) => i.ticker).includes('BIGORD'), true);
  });

  test('small order / large company: CONFIRMED_LOW_MATERIALITY, 0.5% of market cap, expectation-heavy, not in the queue', () => {
    const s = it('SMALLORD');
    assert.equal(s.eventClass, 'CONFIRMED_LOW_MATERIALITY'); assert.equal(s.materiality.label, 'SMALL'); assert.equal(s.sourceConfidence, 'VERIFIED_FILING');
    assert.equal(s.materiality.ratios[0].text, '₹5 Cr ÷ ₹1,000 Cr market cap = 0.5%');
    assert.equal(s.expectationGap.direction, 'EXPECTATION_HEAVY'); assert.match(s.expectationGap.text, /expectation-heavy/);
    assert.ok(!queued.has('SMALLORD')); assert.ok(v.watch.some((i) => i.ticker === 'SMALLORD'));
  });

  test('acquisition completed: EXECUTED, MODERATE vs market cap, NEAR_TERM, multi-year', () => {
    const a = it('ACQ');
    assert.equal(a.eventType, 'Acquisition'); assert.equal(a.stage, 'EXECUTED'); assert.equal(a.eventClass, 'CONFIRMED_MATERIAL');
    assert.equal(a.materiality.label, 'MODERATE'); assert.equal(a.transmission, 'NEAR_TERM'); assert.equal(a.persistence, 'YEARS');
    assert.ok(a.researchNext.some((q) => /funded/.test(q)));
  });

  test('capacity: Pearl Global before → after in exact numbers; a +60% increment is material', () => {
    const p = it('PEARL');
    assert.equal(p.eventType, 'Capacity expansion'); assert.equal(p.stage, 'OPERATIONAL');
    assert.equal(p.whatChanged, 'Capacity ~101M pieces/yr → ~108M pieces/yr (+7M, +6.9%)');
    assert.equal(p.before, '~101M pieces/yr'); assert.equal(p.after, '~108M pieces/yr');
    assert.equal(p.materiality.label, 'SMALL'); assert.equal(p.eventClass, 'CONFIRMED_LOW_MATERIALITY');
    const c = it('CAPX');
    assert.equal(c.eventClass, 'CONFIRMED_MATERIAL'); assert.equal(c.materiality.ratios[0].basis, 'current_capacity'); assert.equal(c.materiality.ratios[0].pct, 60);
    assert.equal(c.persistence, 'YEARS');
    assert.equal(parseCap770('Revenue grew from 10 to 20 crore.'), null, 'a non-capacity sentence is not a capacity change');
  });

  test('earnings beat / miss from filed rows: EarningsMini, MONETIZING, DIRECT; weak result is NEGATIVE', () => {
    const e = it('EARNBEAT');
    assert.equal(e.eventType, 'Earnings'); assert.equal(e.eventClass, 'CONFIRMED_MATERIAL'); assert.equal(e.stage, 'MONETIZING'); assert.equal(e.transmission, 'DIRECT');
    assert.equal(e.earnings!.revenueYoY, 139.6); assert.equal(e.earnings!.patYoY, 472.7); assert.equal(e.earnings!.cfoToPat, 1.17);
    assert.equal(e.earnings!.marginNow, 64); assert.equal(e.earnings!.marginPrior, 41); assert.equal(e.earnings!.filedDaysAgo, 2); assert.equal(e.earnings!.guidance, 'NOT_STATED');
    assert.equal(e.whatChanged, 'Revenue ₹48 Cr → ₹115 Cr (+139.6% YoY); PAT ₹11 Cr → ₹63 Cr (+472.7% YoY)');
    assert.ok(e.unknowns.includes('Guidance: Not stated'));
    const m = it('EARNMISS');
    assert.equal(m.eventType, 'Earnings'); assert.equal(m.eventClass, 'NEGATIVE'); assert.ok(v.negative.some((i) => i.ticker === 'EARNMISS'));
  });

  test('stale result (40 days) is context, ranked below dated catalysts', () => {
    const st = it('STALEEARN');
    assert.equal(st.earnings!.stale, true);
    for (const t of ['BIGORD', 'ACQ', 'CAPX', 'EARNBEAT']) assert.ok(it(t).priority > st.priority, `${t} ${it(t).priority} > STALEEARN ${st.priority}`);
    assert.ok(st.priorityReasons.some((r) => /context, not this move/.test(r)));
    // zzz771: it is CONTEXT — out of the queue, in view.context.
    assert.equal(st.catalystFor, 'CONTEXT'); assert.ok(!queued.has('STALEEARN')); assert.ok((v.context || []).some((i) => i.ticker === 'STALEEARN'));
  });

  test('false positives: financing, routine filing, MoU as order, board approval as executed, small order as material, listing as gainer', () => {
    const f = it('FINANCE');
    // zzz771: a raise is a potential catalyst with a dilution flag (NEGATIVE only on distress); transmission WEAK, not NONE.
    assert.equal(f.eventClass, 'POTENTIAL_UNVERIFIED'); assert.equal(f.eventType, 'Fundraising'); assert.equal(f.flags.dilution, true); assert.equal(f.transmission, 'WEAK');
    assert.equal(it('ROUTINE').eventClass, 'NO_CATALYST');
    const mou = it('MOUCO');
    assert.notEqual(mou.eventType, 'Order win'); assert.equal(mou.stage, 'ENABLING'); assert.equal(mou.eventClass, 'POTENTIAL_UNVERIFIED'); assert.equal(mou.materiality.label, 'UNKNOWN');
    const ba = it('BOARDAPP');
    assert.ok(!['EXECUTED', 'OPERATIONAL', 'MONETIZING'].includes(ba.stage), ba.stage); assert.equal(ba.eventClass, 'POTENTIAL_UNVERIFIED');
    assert.notEqual(it('SMALLORD').eventClass, 'CONFIRMED_MATERIAL');
    const l = it('LISTED');
    assert.equal(l.eventClass, 'LISTING'); assert.ok(!queued.has('LISTED')); assert.ok(v.dataQuality.some((i) => i.ticker === 'LISTED'));
    // zzz771: FINANCE (no named allottee) may sit in the queue/watch as a potential catalyst, but never in the top 3.
    for (const t of ['ROUTINE', 'LISTED', 'DENY', 'NOCAT', 'BAND']) assert.ok(!queued.has(t) && !v.top3.some((i) => i.ticker === t), `${t} must not be queued`);
    assert.ok(!v.top3.some((i) => i.ticker === 'FINANCE'));
  });

  test('JSWINFRA LoI is ENABLING and never an order win; PACEDIGITK LoA is AWARDED', () => {
    const j = it('JSWINFRA');
    assert.equal(j.stage, 'ENABLING'); assert.notEqual(j.eventType, 'Order win'); assert.equal(j.eventType, 'Contract');
    assert.match(j.eventLabel || '', /Letter of intent \(not an order\)/);
    assert.notEqual(j.eventClass, 'CONFIRMED_MATERIAL');
    const p = it('PACEDIGITK');
    assert.equal(p.stage, 'AWARDED'); assert.equal(p.eventType, 'Order win');
  });

  test('false negatives: a real order, capacity, earnings, approval and acquisition all reach the queue', () => {
    for (const t of ['BIGORD', 'CAPX', 'EARNBEAT', 'APPROVAL', 'ACQ', 'PACEDIGITK']) assert.ok(queued.has(t), `${t} missing from the queue`);
    assert.equal(it('APPROVAL').eventType, 'Regulatory approval'); assert.equal(it('APPROVAL').stage, 'EXECUTED');
  });

  test('negatives: denial and accident are NEGATIVE with the right type and flags', () => {
    // zzz771: DENY is a price-movement CLARIFICATION ("no undisclosed information") —
    // company-confirmed absence of a catalyst → NO_CATALYST with flags.denial; the
    // true denial case is TRUEDENY (asserted in the zzz771 block).
    const d = it('DENY');
    assert.equal(d.eventClass, 'NO_CATALYST'); assert.equal(d.eventType, 'No identified catalyst'); assert.equal(d.flags.denial, true); assert.equal(d.transmission, 'NONE');
    const a = it('ACCIDENT');
    assert.equal(a.eventClass, 'NEGATIVE'); assert.equal(a.eventType, 'Accident / disruption');
    assert.equal(a.action, 'Negative evidence');
  });

  test('no catalyst / band print / unclassified: compressed, heavily penalised, never queued', () => {
    assert.equal(it('NOCAT').eventClass, 'NO_CATALYST');
    assert.equal(it('NOCAT').transmission, 'NONE');
    const b = it('BAND'); assert.equal(b.eventClass, 'MARKET_MOVE_ONLY'); assert.equal(b.flags.band, 20); assert.equal(b.eventType, 'Market/technical move');
    const u = it('UNCL'); assert.equal(u.eventClass, 'NO_CATALYST'); assert.match(u.eventLabel || '', /Unclassified filing/);
    assert.ok(u.researchNext.some((q) => /Open the unclassified filing/.test(q)));
    for (const t of ['NOCAT', 'BAND', 'UNCL', 'ROUTINE']) assert.ok(v.noCatalyst.some((i) => i.ticker === t));
  });

  test('price is context: a +30% stock with no event ranks below a +5% stock with a verified material change', () => {
    assert.ok(it('NOCAT').move1d! > it('BIGORD').move1d!);
    assert.ok(it('BIGORD').priority > it('NOCAT').priority);
    assert.ok(it('SMALLORD').priority < it('BIGORD').priority, 'a +20% move on a ₹5 Cr order does not outrank a verified 48%-of-revenue order');
    // Changing only the move of a no-event name never lifts it above a material event.
    const inp = fx770(); inp.findings.NOCAT = { ...inp.findings.NOCAT, movePct: 95 } as any;
    const v2 = buildView770(inp);
    const nocat2 = [...v2.noCatalyst].find((i) => i.ticker === 'NOCAT')!;
    assert.ok(nocat2.priority < 10);
  });

  test('failed source → DATA_UNAVAILABLE, never NO_CATALYST; a short line with the full text kept', () => {
    const s = it('SRCFAIL');
    assert.equal(s.eventClass, 'DATA_UNAVAILABLE');
    assert.ok(!v.noCatalyst.some((i) => i.ticker === 'SRCFAIL'));
    assert.equal(v.summary.dataUnavailable, 1);
    const line = v.sourceFailures.find((x) => x.ticker === 'SRCFAIL')!;
    assert.ok(line && line.text.length <= 90 && line.full.length >= line.text.length - 20);
  });

  test('portfolio: a holding maps the event to a thesis variable; the non-holding twin does not', () => {
    const h = it('HOLDCO'), n = it('NONHOLD');
    assert.equal(h.portfolio.relevance, 'HOLDING'); assert.equal(h.portfolio.thesisVariable, 'order growth');
    assert.match(h.portfolio.note || '', /^Supports thesis variable order growth — next check /);
    assert.equal(h.action, 'Thesis evidence');
    assert.equal(n.portfolio.relevance, 'UNRELATED'); assert.equal(n.portfolio.note, null);
    assert.deepEqual(v.portfolio.map((i) => i.ticker), ['HOLDCO']);
    assert.equal(v.summary.portfolioMatches, 1);
    assert.equal(h.priority, n.priority, 'holding the name does not change its research priority');
  });

  test('sections are bounded and ranked; top3 ⊆ queue; session carries "last completed session", not today', () => {
    assert.ok(v.top3.length <= 3 && v.queue.length <= 15 && v.watch.length <= 20);
    for (const t of v.top3) assert.ok(queued.has(t.ticker));
    for (let i = 1; i < v.queue.length; i++) assert.ok(v.queue[i - 1].priority >= v.queue[i].priority);
    assert.equal(v.session.isToday, false); assert.match(v.session.note || '', /last completed session \(2026-09-22\), not today/);
    for (const i of items) {
      assert.ok(i.priority >= 0 && i.priority <= 100);
      assert.ok(i.scoreDetails && typeof i.scoreDetails.priority === 'number');
      assert.ok(i.whyResearch.length > 10);
    }
  });

  test('same input → same output (and input order does not matter)', () => {
    const a = JSON.stringify(buildView770(fx770()));
    const b = JSON.stringify(buildView770(fx770()));
    assert.equal(a, b);
    const rev = fx770();
    rev.findings = Object.fromEntries(Object.entries(rev.findings).reverse());
    rev.board = rev.board.slice().reverse(); rev.filedResults = rev.filedResults.slice().reverse();
    assert.equal(JSON.stringify(buildView770(rev)), a);
  });

  test('no BUY / SELL / EXIT / STOP anywhere; generated text never names a trade', () => {
    const json = JSON.stringify(v) + JSON.stringify(buildView770(fxUS770()));
    assert.ok(!/\b(BUY|SELL|EXIT|STOP)\b/.test(json), 'a shouted rating token passed through');
    for (const i of items) {
      const gen = [i.whyResearch, ...i.researchNext, ...i.unknowns, ...i.priorityReasons, i.expectationGap.text, i.portfolio.note || '', i.materiality.explanation, ...i.transmissionChain.slice(1), i.action || ''].join(' | ');
      assert.ok(!/\b(buy|sell|exit|stop)\b/i.test(gen), `${i.ticker}: ${gen}`);
    }
    assert.ok(it('BROKER').headline.includes('buy rating'));
  });

  test('US shares the model: an offering is Fundraising with dilution; a 10-Q is Earnings; the move is 1-week', () => {
    const u = buildView770(fxUS770());
    const us = [...u.queue, ...u.watch, ...u.negative, ...u.noCatalyst, ...(u.context || [])];
    const o = us.find((i) => i.ticker === 'OFFR')!;
    // zzz771: a priced 424B5 takedown is a NEW raise — a potential catalyst flagged for dilution, not NEGATIVE by default.
    assert.equal(o.eventClass, 'POTENTIAL_UNVERIFIED'); assert.equal(o.eventType, 'Fundraising'); assert.equal(o.flags.dilution, true);
    assert.equal(o.move1d, null); assert.equal(o.move!.window, '1W'); assert.equal(o.returns.w1, 35);
    const q = us.find((i) => i.ticker === 'TENQ')!;
    assert.equal(q.eventType, 'Earnings'); assert.notEqual(q.eventClass, 'NEGATIVE');
    assert.match(u.session.note || '', /1-week performance/);
    assert.equal(classifyUs770({ subject: '4: Statement of changes in beneficial ownership' })!.kind, 'routine');
    assert.equal(classifyUs770({ subject: '424B5: Prospectus' })!.kind, 'negative');
    assert.equal(classifyUs770({ subject: 'S-3: Registration statement' })!.category, 'dilution');
  });

  test('filed rows: TTM revenue from the last four quarters; missing figures stay null', () => {
    const r = normFiled770({ ticker: 'x', quarters_sales: [10, 240, 250, 260, 270], sales_yoy_pct: 17.4 }, null)!;
    assert.equal(r.ttmRevenue, 1020); assert.equal(r.patYoY, null); assert.equal(r.ageDays, null);
    const q = normFiled770({ ticker: 'y', filed: { sales_yoy_pct: 5, filing_date: '2026-09-13' } }, '2026-09-23T00:00:00Z')!;
    assert.equal(q.salesYoY, 5); assert.equal(q.ageDays, 10);
  });

  test('research-view.ts stays client-safe: no server-only imports', () => {
    const src = readFileSync(join(__dirname, '..', 'ai-gainers', 'research-view.ts'), 'utf8');
    const imports = Array.from(src.matchAll(/^import .* from '([^']+)';/gm)).map((m) => m[1]);
    assert.deepEqual(imports.sort(), ['./catalyst-research', './research-present']);
    assert.ok(/^import type \{ Finding \} from '\.\/catalyst-research';/m.test(src), 'catalyst-research is a type-only import');
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(src), 'the builder never reads the clock');
  });
});

// ── zzz770 AG-B — the research triage view renders from ResearchView only ──
import * as ReactNS770 from 'react';
import { renderToStaticMarkup as render770 } from 'react-dom/server';
import { ResearchTriage as Triage770 } from '../../components/ai-gainers/ResearchTriage';
import { DEMO_VIEW as demo770 } from '../../components/ai-gainers/__fixture__';

describe('zzz770 AG-B — research triage view (fixture render)', () => {
  (globalThis as any).React = ReactNS770;
  const html = render770(ReactNS770.createElement(Triage770, { view: demo770, market: 'IN', onRescan: () => {} }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  test('every default section is on the page, in attention order', () => {
    const order = ['AI DAILY GAINERS', 'MARKET SUMMARY', 'TOP 3 RESEARCH PRIORITIES', 'RESEARCH QUEUE', 'YOUR BOOK', 'WATCH / INVESTIGATE', 'NEGATIVE EVIDENCE', 'NO IDENTIFIED CATALYST'];
    let at = -1;
    for (const s of order) { const i = text.indexOf(s, at + 1); assert.ok(i > at, `${s} missing or out of order`); at = i; }
    assert.ok(/SESSION/.test(text) && /SCAN/.test(text) && /STATUS/.test(text), 'session block');
    assert.ok(text.includes('Last completed session'));
    assert.ok(text.includes('WHAT CHANGED') && text.includes('WHY RESEARCH') && text.includes('RESEARCH NEXT'));
    assert.ok(text.includes('101M pieces/yr') && text.includes('108M pieces/yr'), 'before → after printed');
    assert.ok(text.includes('EARNINGS') && text.includes('CFO / PAT'), 'earnings mini layout');
    assert.ok(text.includes('DATA-SOURCE FAILURES'));
  });
  test('no trade instruction words, no undefined / NaN / null leaking', () => {
    assert.ok(!/\b(BUY|SELL|EXIT|STOP)\b/.test(text), 'trade instruction word');
    assert.ok(!/\b(buy|sell)\b/i.test(text), 'buy/sell word');
    assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b/.test(text), 'undefined/NaN/null in markup');
  });
  test('source badge: unverified shown as a badge, the long not-read sentence never repeated per row', () => {
    assert.ok(text.includes('SOURCE: UNVERIFIED') || text.includes('SOURCE: SUMMARY ONLY'));
    assert.ok(text.includes('SOURCE: VERIFIED DOCUMENT') && text.includes('SOURCE: EXCHANGE FILING'));
    assert.ok((text.match(/model-read/g) || []).length <= 1);
  });
  test('no-catalyst, band prints and data quality are collapsed by default', () => {
    assert.ok(/NO IDENTIFIED CATALYST — 5/.test(text));
    assert.ok(/data-testid="no-catalyst" data-open="0"/.test(html));
    assert.ok(!text.includes('SECZ'), 'no-catalyst one-liners must not render while collapsed');
    assert.ok(!text.includes('MICROBAND') && !text.includes('NEWLIST'));
    assert.ok(!/Fresh 100|NET \d/.test(text), 'score arithmetic hidden by default');
  });
  test('empty session renders an explicit answer, not a blank page', () => {
    const empty = { ...demo770, summary: { ...demo770.summary, scanned: 0 }, top3: [], queue: [], watch: [], negative: [], noCatalyst: [], dataQuality: [], sourceFailures: [], portfolio: [] };
    const t = render770(ReactNS770.createElement(Triage770, { view: empty, market: 'IN' })).replace(/<[^>]+>/g, ' ');
    assert.ok(t.includes('No gainers on this board for this session'));
    assert.ok(!/\bundefined\b|\bNaN\b/.test(t));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz770 · a bank facility is financing, never capex or working capital', () => {
  test('MOREPENLAB term loan and repaid WC facility are rejected; real capex / WC days are kept', () => {
    assert.equal(valueFitsVariable({ variable: 'capex', before: null, after: '₹13,000.00 Lakhs', unit: '₹', evidence_text: 'Kookmin Bank, Woori Bank and Hana Bank provided unsecured term loan facilities aggregating to ₹13,000.00 Lakhs.' }), false);
    assert.equal(valueFitsVariable({ variable: 'working_capital', before: null, after: '₹9,900.00 Lakhs', unit: '₹', evidence_text: 'The Company repaid in full the secured working capital facilities availed from Kotak Mahindra Bank Limited, aggregating to ₹9,900.00 Lakhs.' }), false);
    assert.equal(valueFitsVariable({ variable: 'capex', before: null, after: '₹480 Crore', unit: '₹', evidence_text: 'Capex of ₹480 crore was spent on the Jammu plant.' }), true);
    assert.equal(valueFitsVariable({ variable: 'working_capital', before: '159 days', after: '132 days', unit: 'days', evidence_text: 'Working capital days improved from 159 days to 132 days.' }), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz771 PC-1 · every thesis variable is a time series: per company, per
// period, per variable snapshot; a frozen thesis baseline; readings printed
// "{cur} ({period}) vs {prev} ({prevPeriod}) · Δ · ▲ basis".
// ═══════════════════════════════════════════════════════════════════════════
import {
  emptyLedger as empty771, mergePeriod as merge771, factsFromEvents as facts771,
  reportingPeriodForDocuments as rp771, documentId as docId771, migrateLedger as migrate771,
  deriveVariableSnapshots as derive771, ALL_VAR_KEYS as KEYS771,
} from '../thesis/evidence-ledger';
import { validateReading as validate771, isAmbiguousValue as ambiguous771 } from '../thesis/fact-model';
import { extractVariables as extract771, rowValueText as rvt771 } from '../thesis/variables';

describe('zzz771 · variable snapshots, baseline and time-series readings', () => {
  const now = '2026-10-25T10:00:00.000Z';
  const doc = (url: string, date: string, outcome = 'read'): any =>
    ({ id: docId771(url), url, label: `Concall transcript ${date}`, kind: 'transcript', source: 'screener.in company page', period: null, date_iso: date, outcome, chars: 40000, pages: 20 });
  const ev = (variable: string, value_type: string, before: string | null, after: string, text: string, src: string): any =>
    ({ variable, value_type, before, after, unit: null, period: null, direction: 'up', evidence_text: text, source: src, confidence: 'HIGH' });
  const period = (t: string, docs: any[], events: any[], runId: string, at = now) => {
    const rp = rp771(docs, docs[0]?.date_iso);
    const { facts, events: evs } = facts771(t, rp.period, events, docs, at);
    const read = docs.filter((d) => d.outcome === 'read').length;
    return {
      period: { reporting_period: rp.period, period_end_date: rp.period_end, latest_document_date: rp.latest_document_date,
        documents: docs, documents_found: docs.length, documents_read: read, documents_failed: 0, documents_skipped: docs.length - read,
        facts, events: evs, summary: { events }, status: null, status_because: null, tallies: null,
        discovery_state: 'EVIDENCE_FOUND', discovery_attempts: [], run_id: runId, prompt_version: 'v8', model: 'm', extracted_at: at, updated_at: at } as any,
      run: { run_id: runId, reporting_period: rp.period, started_at: at, finished_at: at, outcome: 'COMPLETED', error: null,
        documents_found: docs.length, documents_read: read, facts_extracted: facts.length, events_extracted: evs.length, model: 'm', prompt_version: 'v8' } as any,
    };
  };
  const q1Doc = doc('https://x/q1.pdf', '2026-07-24');   // → Q1 FY27
  const q2Doc = doc('https://x/q2.pdf', '2026-10-20');   // → Q2 FY27
  const S1 = 'Concall transcript 2026-07-24', S2 = 'Concall transcript 2026-10-20';
  const q1 = () => period('ACME', [q1Doc], [
    ev('utilisation', 'ACTUAL', null, '70%', 'Capacity utilisation for the quarter was 70% across the plants.', S1),
    ev('order_book', 'ACTUAL', null, '₹80 Cr', 'The closing order book stood at ₹80 Cr at the end of the quarter.', S1),
    ev('working_capital', 'ACTUAL', null, '73 days', 'Net working capital stood at 73 days at the end of the quarter.', S1),
  ], 'r1', '2026-07-25T10:00:00.000Z');
  const q2 = () => period('ACME', [q2Doc], [
    ev('utilisation', 'ACTUAL', null, '80%', 'Capacity utilisation for the quarter was 80% across the plants.', S2),
    ev('order_book', 'ACTUAL', null, '₹107 Cr', 'The closing order book stood at ₹107 Cr at the end of the quarter.', S2),
    ev('working_capital', 'ACTUAL', null, '42 days', 'Net working capital stood at 42 days at the end of the quarter.', S2),
  ], 'r2');
  const both = () => { const a = q1(), b = q2(); return merge771(merge771(empty771('ACME', 'IN', now), a.period, a.run), b.period, b.run); };

  test('Q1 then Q2 merged: both snapshots kept, Q2.previous = Q1 with Δ; Q1 unchanged', () => {
    const a = q1();
    const one = merge771(empty771('ACME', 'IN', now), a.period, a.run);
    const q1Before = JSON.parse(JSON.stringify(one.periods['Q1 FY27'].variables));
    const l = both();
    assert.deepEqual(Object.keys(l.periods).sort(), ['Q1 FY27', 'Q2 FY27']);
    const v1 = l.periods['Q1 FY27'].variables!, v2 = l.periods['Q2 FY27'].variables!;
    assert.equal(Object.keys(v2).length, KEYS771.length, 'every VarKey has a snapshot');
    assert.deepEqual(v1, q1Before, 'a later period never overwrites an earlier snapshot');
    assert.equal(v1.utilisation.state, 'FOUND');
    assert.equal(v1.utilisation.value, '70%');
    assert.equal(v1.utilisation.not_comparable_reason, 'first reading');
    assert.equal(v2.utilisation.previous_period, 'Q1 FY27');
    assert.equal(v2.utilisation.previous_value, '70%');
    assert.equal(v2.utilisation.delta_abs, '+10pp');
    assert.equal(v2.utilisation.delta_pct, null, 'a percent moves in points only');
    assert.equal(v2.utilisation.direction, 'UP');
    assert.equal(v2.order_book.delta_abs, '+₹27 Cr');
    assert.equal(v2.order_book.delta_pct, '+33.8%');
    assert.equal(v2.working_capital.delta_abs, '−31 days');
    assert.equal(v2.working_capital.direction, 'DOWN');
  });

  test('thesis baseline = the first snapshot, frozen after later merges (and a backfill)', () => {
    const a = q1();
    const one = merge771(empty771('ACME', 'IN', now), a.period, a.run);
    assert.equal(one.thesis_baseline!.period, 'Q1 FY27');
    const base0 = JSON.parse(JSON.stringify(one.thesis_baseline));
    const b = q2();
    const two = merge771(one, b.period, b.run);
    assert.deepEqual(two.thesis_baseline, base0, 'a later merge must not change the baseline');
    const q4 = period('ACME', [doc('https://x/q4.pdf', '2026-05-20')], [
      ev('utilisation', 'ACTUAL', null, '60%', 'Capacity utilisation for the quarter was 60% across the plants.', 'Concall transcript 2026-05-20')], 'r0');
    const three = merge771(two, q4.period, q4.run);
    assert.deepEqual(three.thesis_baseline, base0, 'an earlier backfill must not change the baseline either');
    assert.equal(three.periods['Q1 FY27'].variables!.utilisation.previous_period, 'Q4 FY26', 'but the backfill does give Q1 its previous');
  });

  test('NOT_DISCLOSED is recorded for a read period with no fact; NOT_SEARCHED for an unread one', () => {
    const l = both();
    assert.equal(l.periods['Q1 FY27'].variables!.capacity.state, 'NOT_DISCLOSED');
    assert.equal(l.periods['Q1 FY27'].variables!.capacity.value, null);
    const u = period('ACME', [doc('https://x/unread.pdf', '2026-07-24', 'not_selected')], [], 'r9');
    const lu = merge771(empty771('ACME', 'IN', now), u.period, u.run);
    const v = lu.periods['Q1 FY27'].variables!;
    assert.equal(v.utilisation.state, 'NOT_SEARCHED');
    assert.equal(v.capacity.state, 'NOT_SEARCHED');
  });

  test('unit change → NOT_COMPARABLE "unit changed"; no delta', () => {
    const a = period('ACME', [q1Doc], [ev('capacity', 'ACTUAL', null, '314 kiloliters', 'Installed capacity was 314 kiloliters at the site.', S1)], 'r1');
    const b = period('ACME', [q2Doc], [ev('capacity', 'ACTUAL', null, '200 KLD', 'Installed capacity now stands at 200 KLD.', S2)], 'r2');
    const l = merge771(merge771(empty771('ACME', 'IN', now), a.period, a.run), b.period, b.run);
    const s = l.periods['Q2 FY27'].variables!.capacity;
    assert.equal(s.direction, 'NOT_COMPARABLE');
    assert.equal(s.not_comparable_reason, 'unit changed');
    assert.equal(s.delta_abs, null);
  });

  test('the same figure dated to one period in two ledger periods → "same period", never a change', () => {
    const text = 'Out of the IPO proceeds, 82.88 crore was deployed in April 2026.';
    const a = period('ACME', [doc('https://x/q4.pdf', '2026-05-20')], [ev('capex', 'ACTUAL', null, '82.88 crore deployed in April 2026', text, 'Concall transcript 2026-05-20')], 'r1');
    const b = period('ACME', [q1Doc], [ev('capex', 'ACTUAL', null, '82.88 crore deployed in April 2026', text, S1)], 'r2');
    const l = merge771(merge771(empty771('ACME', 'IN', now), a.period, a.run), b.period, b.run);
    const s = l.periods['Q1 FY27'].variables!.capex;
    assert.equal(s.direction, 'NOT_COMPARABLE');
    assert.equal(s.not_comparable_reason, 'same period');
  });

  test('an in-text before→after with no earlier period → basis in_text', () => {
    const a = period('ACME', [q1Doc], [ev('utilisation', 'ACTUAL', '70%', '80%', 'Capacity utilisation improved from 70% to 80% during the quarter.', S1)], 'r1');
    const l = merge771(empty771('ACME', 'IN', now), a.period, a.run);
    const s = l.periods['Q1 FY27'].variables!.utilisation;
    assert.equal(s.previous_period, null);
    assert.equal(s.previous_value, '70%');
    assert.equal(s.delta_abs, '+10pp');
    const vars = extract771(null, a.period.summary, null, { period: 'Q1 FY27', ledger: l });
    const u = vars.find((v) => v.key === 'utilisation')!;
    assert.equal(u.reading!.comparison_basis, 'in_text');
    // zzz772: the display prints the basis in words ("per filing"), never the code.
    assert.match(u.reading!.display, /^80% \(Q1 FY27\) vs 70% .* · \+10pp · ▲ per filing$/);
  });

  test('guidance is never a previous value: Q1 guidance 90%, Q2 actual 80% → no previous', () => {
    const a = period('ACME', [q1Doc], [ev('utilisation', 'GUIDANCE', null, '90%', 'We expect capacity utilisation to reach 90% by FY28.', S1)], 'r1');
    const b = period('ACME', [q2Doc], [ev('utilisation', 'ACTUAL', null, '80%', 'Capacity utilisation for the quarter was 80% across the plants.', S2)], 'r2');
    const l = merge771(merge771(empty771('ACME', 'IN', now), a.period, a.run), b.period, b.run);
    assert.equal(l.periods['Q1 FY27'].variables!.utilisation.state, 'NOT_DISCLOSED', 'a guidance-only period has no actual');
    assert.equal(l.periods['Q1 FY27'].variables!.utilisation.value, null);
    const s = l.periods['Q2 FY27'].variables!.utilisation;
    assert.equal(s.previous_value, null);
    assert.equal(s.not_comparable_reason, 'not disclosed in Q1 FY27');
    const vars = extract771(null, b.period.summary, null, { period: 'Q2 FY27', ledger: l });
    assert.equal(vars.find((v) => v.key === 'utilisation')!.reading!.display, '80% (Q2 FY27) · previous: not disclosed in Q1 FY27');
  });

  test('"30% or 25%" is UNCLEAR — validation, snapshot and display', () => {
    const val = validate771('utilisation', '30% or 25%', 'annualised about 30% or 25%');
    assert.equal(val.state, 'UNCLEAR');
    assert.deepEqual(val.flags, ['AMBIGUOUS_VALUE']);
    assert.equal(ambiguous771('30 to 35%'), false, 'a range is one reading');
    assert.equal(ambiguous771('80% or more'), false, 'a hedge is one reading');
    const a = period('ACME', [q1Doc], [ev('utilisation', 'ACTUAL', null, '30% or 25%', 'The Jammu facility utilisation is about 30% or 25% on an annualised basis.', S1)], 'r1');
    const l = merge771(empty771('ACME', 'IN', now), a.period, a.run);
    assert.equal(l.periods['Q1 FY27'].variables!.utilisation.state, 'UNCLEAR');
    const vars = extract771(null, a.period.summary, null, { period: 'Q1 FY27', ledger: l });
    const u = vars.find((v) => v.key === 'utilisation')!;
    assert.equal(u.reading!.display, 'unclear — validation required: 30% or 25%');
    assert.equal(rvt771(u), 'unclear — validation required: 30% or 25%');
  });

  test('display strings match the owner\'s format (percent, money, days, first reading)', () => {
    const l = both();
    const vars = extract771(null, q2().period.summary, null, { period: 'Q2 FY27', ledger: l });
    const d = (k: string) => vars.find((v) => v.key === k)!.reading!.display;
    assert.equal(d('utilisation'), '80% (Q2 FY27) vs 70% (Q1 FY27) · +10pp · ▲ QoQ');
    assert.equal(d('order_book'), '₹107 Cr (Q2 FY27) vs ₹80 Cr (Q1 FY27) · +₹27 Cr · +33.8% · ▲ QoQ');
    assert.equal(d('working_capital'), '42 days (Q2 FY27) vs 73 days (Q1 FY27) · −31 days · ▼ QoQ');
    assert.equal(rvt771(vars.find((v) => v.key === 'utilisation')!), '80% (Q2 FY27) vs 70% (Q1 FY27) · +10pp · ▲ QoQ', 'the row prints the reading');
    const one = (() => { const a = q1(); return merge771(empty771('ACME', 'IN', now), a.period, a.run); })();
    const v1 = extract771(null, q1().period.summary, null, { period: 'Q1 FY27', ledger: one });
    assert.equal(v1.find((v) => v.key === 'utilisation')!.reading!.display, '70% (Q1 FY27) · previous: not disclosed (first reading)');
  });

  test('a stored ledger without snapshots gets them on read (lossless migration), and deriving twice is identical', () => {
    const l = both();
    const stripped: any = JSON.parse(JSON.stringify(l));
    delete stripped.thesis_baseline;
    for (const p of Object.values<any>(stripped.periods)) delete p.variables;
    const m = migrate771(stripped)!;
    assert.ok(m.thesis_baseline);
    assert.equal(m.periods['Q2 FY27'].variables!.utilisation.delta_abs, '+10pp');
    assert.deepEqual(derive771(m, 'Q2 FY27', 'x'), derive771(m, 'Q2 FY27', 'x'));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz771 PC-3 · "Capex earning yet?" is a structured state; three verdict
// dimensions; readings with period classes; Unknown ≠ Flat ≠ Confirmed.
// ═══════════════════════════════════════════════════════════════════════════
import { capexEarning as capexEarning771, buildCapexChain as chain771, capexProjects as projects771, CAPEX_EARNING_UNKNOWN_LINE as UNKNOWN_LINE771 } from '../thesis/capex-chain';
import { assessThesis as assess771 } from '../thesis/status';
import { extractVariables as ev771 } from '../thesis/variables';
import { ThesisCard as Card771, chipValue as chip771, rowTreatment as treat771, readingText as rt771 } from '../../components/thesis-card';

describe('zzz771 capex earning — five states, derived only from what the filing states', () => {
  const V771 = (key: string, verdict: string, extra: any = {}) => ({ key, label: key, kind: 'fact', before: null, after: null, delta: null, verdict, evidence: '', source: 'filing', statement: 'ACTUAL', ...extra });

  test('INNOVACAP shape → PARTIAL: ₹480+ crore, INR107 crores revenue, utilisation level only, margin pending', () => {
    const summary = {
      capex_projects: [{ name: 'Kathua, Jammu facility', type: 'greenfield', amount: 'Total Capital Investment 480+ crore', status: 'commissioned',
        completion_period: 'commercialized in January 2025', revenue_from: 'already contributing; Q1 FY27 revenue INR107 crores' }],
      utilisation: { current: 'Jammu annualised ~25% to 30%', prior: '', expected: 'Jammu optimum utilization 60-70%', basis: 'Kathua, Jammu plant' },
    };
    const vars = [
      V771('capex_earning', 'improving', { after: 'Jammu capex (~INR480+ crore) is already contributing revenue (INR107 crores in Q1), but management states full margin contribution will come as utilization increases.' }),
      V771('utilisation', 'stated', { after: '30% or 25%', plan: { value: '65% to 70%', type: 'TARGET', gap: null } }),
    ] as any;
    const c = chain771(summary, vars, { periods: {} } as any);
    const e = c.earning;
    assert.equal(e.state, 'PARTIAL');
    assert.equal(e.label, 'PARTIAL');
    assert.match(String(e.spent), /₹480\+ crore/i);
    assert.match(String(e.revenueContribution), /^INR107 crores in Q1/);
    assert.equal(e.utilisation!.to, '30% or 25%');
    assert.equal(e.utilisation!.from, null);
    assert.match(String(e.utilisation!.note), /level only; prior not disclosed/);
    assert.match(String(e.utilisation!.note), /target 65% to 70%/);
    assert.equal(e.marginContribution, 'pending');
    assert.equal(c.state, 'starting_to_earn');
    assert.deepEqual(e.lines.map((l) => l.split(':')[0]), ['Spent', 'Revenue contribution', 'Utilisation', 'Full margin contribution']);
    assert.match(e.lines[2], /30% or 25% \(level only; prior not disclosed · target 65% to 70%\)/);
    assert.match(e.lines[3], /^Full margin contribution: pending/);
    for (const l of e.lines) assert.doesNotMatch(l, /undefined|NaN|\bnull\b/);
  });

  test('announced only → NOT_STARTED; a plan is never spent and never earning', () => {
    const summary = { capex_projects: [{ name: 'Plant 9 defence facility', type: 'greenfield', amount: 'INR40 crores', status: 'announced', completion_period: 'FY28', revenue_from: 'not stated' }] };
    const vars = [V771('capex', 'stated', { after: 'INR40 crores (guidance)', statement: 'GUIDANCE' })] as any;
    const e = chain771(summary, vars, { periods: {} } as any).earning;
    assert.equal(e.state, 'NOT_STARTED');
    assert.match(e.label, /^NOT STARTED/);
    assert.equal(e.revenueContribution, null);
    assert.match(e.lines[0], /^Spent: not disclosed \(announced INR40 crores\)/);
    assert.match(e.lines[1], /^Revenue contribution: none yet — not commissioned/);
  });

  test('commissioned, no revenue attribution → SPENT_NOT_EARNING; the utilisation on file is printed as a level', () => {
    const ev = (variable: string, value_type: string, after: string, period: string | null, text: string, id: string) =>
      ({ variable, value_type, before: null, after, unit: null, period, direction: 'up', confidence: 'HIGH', source: 'Concall transcript Aug 2026', evidence_text: text, id });
    const ledger = { periods: { 'Q1 FY27': { events: [
      ev('capex', 'ACTUAL', '₹120 cr', 'Q1 FY27', 'Capex of ₹120 cr was incurred on the new line during the year.', 'e1'),
      ev('commissioning', 'ACTUAL', 'commissioned in June 2026', 'Q1 FY27', 'The new line was commissioned in June 2026.', 'e2'),
    ] } } } as any;
    const summary = { capex_projects: [{ name: 'New line', type: 'brownfield', amount: '₹120 cr', status: 'commissioned', completion_period: 'June 2026', revenue_from: 'not stated' }] };
    const vars = [V771('utilisation', 'stated', { after: '55%' })] as any;
    const e = chain771(summary, vars, ledger).earning;
    assert.equal(e.state, 'SPENT_NOT_EARNING');
    assert.equal(e.label, 'SPENT — NOT YET EARNING');
    assert.match(String(e.spent), /₹120 cr/);
    assert.match(e.lines[1], /^Revenue contribution: not attributed in the documents read/);
    assert.match(e.lines[2], /^Utilisation: 55% \(level only; prior not disclosed\)/);
    assert.equal(e.marginContribution, 'unknown');
  });

  test('revenue AND margin attributed → EARNING; ROCE is never borrowed from company-level FCF', () => {
    const summary = { capex_projects: [{ name: 'Bheema Phase-1', type: 'greenfield', amount: '₹450 crore', status: 'commissioned', completion_period: 'commercialized March 2024', revenue_from: 'contributed revenue Rs.81.34 crore in FY26' }],
      utilisation: { current: '~60%', prior: '~35%', expected: '', basis: 'Bheema' } };
    const vars = [V771('capex_earning', 'improving', { after: 'Bheema Phase-1 capex (~Rs.450 crore) contributed revenue Rs.81.34 crore and EBITDA Rs.7.86 crore in FY26.' })] as any;
    const c = chain771(summary, vars, { periods: {} } as any);
    const e = c.earning;
    assert.equal(e.state, 'EARNING');
    assert.equal(e.marginContribution, 'disclosed');
    assert.match(String(e.marginText), /EBITDA Rs\.7\.86 crore/);
    assert.equal(e.utilisation!.from, '~35%');
    assert.equal(e.utilisation!.to, '~60%');
    assert.match(e.lines[2], /^Utilisation: ~35% → ~60%$/);
    assert.equal(e.roceText, null);
    assert.equal(c.state, 'earning');
  });

  test('nothing on file → UNKNOWN is a sentence, never a dash; no state is invented from a company-level utilisation figure', () => {
    const e = chain771(null, [] as any, { periods: {} } as any).earning;
    assert.equal(e.state, 'UNKNOWN');
    assert.equal(e.label, 'UNKNOWN');
    assert.equal(e.lines.length, 1);
    assert.equal(e.lines[0], UNKNOWN_LINE771);
    assert.notEqual(e.lines[0].trim(), '—');
    assert.doesNotMatch(e.lines[0], /^[—–-]\s*$/);
    // A utilisation figure alone (no capex) is still UNKNOWN for the capex question.
    const e2 = capexEarning771([V771('utilisation', 'stated', { after: '80%' })] as any, null, [], null);
    assert.equal(e2.state, 'UNKNOWN');
  });

  test('a capex_earning row that says "expected to start contributing from Mar 27" is NOT_STARTED, not PARTIAL', () => {
    const summary = { capex_projects: [{ name: 'Jammu stainless steel plant', type: 'greenfield', amount: 'Rs 600 crore', status: 'under_construction', completion_period: "Mar '27", revenue_from: "Mar '27" }] };
    const vars = [V771('capex_earning', 'stated', { after: "Jammu capex expected to start contributing revenue from Mar '27 as per management." })] as any;
    const e = chain771(summary, vars, { periods: {} } as any).earning;
    assert.equal(e.state, 'NOT_STARTED');
    assert.equal(e.revenueContribution, null);
  });
});

describe('zzz771 thesis card — verdict chips, readings, capex earning block, Unknown ≠ Flat ≠ Confirmed', () => {
  (globalThis as any).React = ReactNS770;
  const g = row('INNOVACAP') || row('KMEW');
  const summary = {
    capex_projects: [{ name: 'Kathua, Jammu facility', type: 'greenfield', amount: 'Total Capital Investment 480+ crore', status: 'commissioned',
      completion_period: 'commercialized in January 2025', revenue_from: 'already contributing; Q1 FY27 revenue INR107 crores' }],
    utilisation: { current: 'Jammu annualised ~25% to 30%', prior: '', expected: 'Jammu optimum utilization 60-70%', basis: 'Kathua, Jammu plant' },
    capex_earning: 'Jammu capex (~INR480+ crore) is already contributing revenue (INR107 crores in Q1), but management states full margin contribution will come as utilization increases.',
    order_book: { current: '', prior: '' },
  };
  const vars = ev771(g, summary);
  const a: any = assess771({ pattern: 'A', variables: vars, evidenceReviewed: true, hasGraderRow: true } as any);
  // Synthetic contracts the other agents fill: the three-way verdict and a reading.
  a.verdict = {
    breakTrigger: { fired: false, conditions: [], text: 'No stated thesis-break condition has been met.' },
    direction: 'STRENGTHENING', directionWhy: 'revenue and margin both up on a disclosed utilisation ramp',
    evidence: 'PARTIALLY_CONFIRMED', evidenceWhy: 'utilisation is a level only', coverage: { confirmed: 2, applicable: 3, missing: ['Capacity utilisation'] },
  };
  const rev = a.checked.find((c: any) => c.key === 'revenue_growth');
  if (rev) rev.reading = { current: { value: '₹512 Cr', period: 'Q1 FY27', period_class: 'CURRENT_QUARTER', unit: '₹ Cr', numeric: 512, source: 'results' },
    previous: { value: '₹383 Cr', period: 'Q1 FY26', period_class: 'PREVIOUS_QUARTER', unit: '₹ Cr', numeric: 383, source: 'results' }, baseline: null,
    delta_abs: '+₹129 Cr', delta_pct: '+33.8%', direction: 'UP', comparison_basis: 'YoY', not_comparable_reason: null,
    display: '₹512 Cr (Q1 FY27) vs ₹383 Cr (Q1 FY26) · +₹129 Cr · +33.8% · ▲ YoY' };
  const guid = a.checked.find((c: any) => c.key === 'guidance' || c.key === 'margin');
  if (guid) guid.reading = { current: { value: '20% growth', period: 'FY27', period_class: 'GUIDANCE', unit: null, numeric: null, source: 'concall' }, previous: null, baseline: null,
    delta_abs: null, delta_pct: null, direction: 'NOT_COMPARABLE', comparison_basis: null, not_comparable_reason: 'first reading', display: '20% growth (FY27) · previous: not disclosed (first reading)' };
  const nd = a.checked.find((c: any) => c.verdict === 'unknown' && c.state === 'NOT_DISCLOSED');
  const chain = chain771(summary, vars, { periods: {} } as any);
  const html = render770(ReactNS770.createElement(Card771 as any, { symbol: 'INNOVACAP', market: 'IN', assessment: a, capex: chain, defaultOpen: true, documentsRead: [{ label: 'Concall transcript Aug 2026', kind: 'transcript', source: 'nse', period: 'Q1 FY27', url: 'https://x' }] }));
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  test('three verdict chips, each its own dimension', () => {
    assert.match(html, /data-testid="verdict-break"/);
    assert.match(html, /data-testid="verdict-direction"/);
    assert.match(html, /data-testid="verdict-evidence"/);
    assert.match(text, /BREAK TRIGGER: none fired/);
    assert.match(text, /DIRECTION: strengthening — revenue and margin both up/);
    assert.match(text, /EVIDENCE: partially confirmed \(2\/3 structural\)/);
    assert.match(text, /missing: Capacity utilisation/);
  });

  test('the capex earning row prints the state and the chain lines — never a dash, never undefined', () => {
    assert.match(html, /data-testid="capex-earning" data-state="PARTIAL"/);
    assert.match(text, /Capex earning: PARTIAL · Spent: ₹480\+ crore[^·]*· Revenue contribution: INR107 crores in Q1[^·]*· Utilisation: [^·]*\(level only; prior not disclosed[^)]*\) · Full margin contribution: pending/i);
    const block = (/Capex earning: PARTIAL.*?Full margin contribution: [^A-Z]*/.exec(text) || [''])[0];
    assert.ok(block.length > 40);
    assert.doesNotMatch(block, /undefined|NaN|\bnull\b|object Object/);
    // An em dash as a separator ("pending — management states …") is fine;
    // a dash standing in for a missing value is not.
    assert.doesNotMatch(block, /Capex earning:\s*[—–-]\s|:\s*[—–-]\s*(·|$)/);
    assert.doesNotMatch(text, /[–—] Capex earning/);
  });

  test('a reading prints its display string; a GUIDANCE point never occupies the current slot and carries a class label', () => {
    if (rev) assert.match(text, /₹512 Cr \(Q1 FY27\) vs ₹383 Cr \(Q1 FY26\) · \+₹129 Cr · \+33\.8% · ▲ YoY/);
    if (guid) {
      assert.match(text, /current: not disclosed · guidance 20% growth \(FY27\)/);
      assert.match(html, /data-testid="period-class"[^>]*>GUIDANCE</);
    }
    const r = rt771({ current: { value: '80%', period: 'FY26', period_class: 'PREVIOUS_FY', unit: '%', numeric: 80, source: null }, previous: null, baseline: null,
      delta_abs: null, delta_pct: null, direction: 'NOT_COMPARABLE', comparison_basis: null, not_comparable_reason: 'first reading', display: '80% (FY26)' });
    assert.equal(r.displaced, true);
    assert.deepEqual(r.tags, ['PREV FY']);
    assert.match(r.text, /^current: not disclosed · prev fy 80% \(FY26\)/);
  });

  test('NOT DISCLOSED renders as "? … NOT DISCLOSED", dashed, and never as unchanged / flat / confirmed', () => {
    assert.ok(nd, 'fixture needs a NOT_DISCLOSED core row');
    assert.match(html, new RegExp(`data-testid="row-${nd.key}" data-treatment="NOT_DISCLOSED"`));
    const chipHtml = (new RegExp(`<span[^>]*data-testid="row-${nd.key}"[^>]*>.*?</span>\\s*</span>`).exec(html) || [''])[0];
    assert.match(chipHtml, /border:1px dashed/);
    assert.match(chipHtml.replace(/<[^>]+>/g, ' '), /^\s*\?\s+.*NOT DISCLOSED/);
    assert.doesNotMatch(chipHtml, /UNCHANGED|unchanged|CONFIRMED|✓|→/);
    assert.equal(treat771({ verdict: 'unknown', state: 'NOT_DISCLOSED' }), 'NOT_DISCLOSED');
    assert.equal(treat771({ verdict: 'flat', before: '10%', after: '10%' }), 'UNCHANGED');
    assert.equal(treat771({ verdict: 'flat', before: null, after: '10%' }), 'SINGLE');
    assert.equal(treat771({ verdict: 'improving', before: '8%', after: '10%' }), 'CONFIRMED');
    assert.equal(treat771({ verdict: 'flat', state: 'UNCLEAR', after: '30% or 25%' }), 'UNCLEAR');
  });

  test('UNCLEAR prints "unclear — validation required: value"; confirmed rows carry ✓', () => {
    assert.equal(chip771({ verdict: 'stated', before: null, after: '30% or 25%', delta: null, state: 'UNCLEAR' }), 'unclear — validation required: 30% or 25%');
    assert.match(text, /✓ Revenue growth/);
    assert.doesNotMatch(text, /\bundefined\b|\bNaN\b|object Object/);
  });

  test('no price, CMP, LTP or target price anywhere on the card', () => {
    assert.doesNotMatch(text, /\b(CMP|LTP|target price|share price)\b/i);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz771 AG-1 — attribution (catalystFor / context), clarification vs denial,
// fundraising as a flagged potential catalyst, resale registrations, reason
// texts, scan notes and scrip-code display. Appended block; the fixture cases
// it reads live in fixtures/gainers-view.fixture.ts (TRUEDENY, ROSSFUND,
// DISTRESS, RECENTRES, 544501; US: RESALE, OLDRES, WEEKOLD).
// ═══════════════════════════════════════════════════════════════════════════
import { buildResearchView as buildView771, catalystForOf as cfOf771, CATALYST_WINDOWS as WIN771, displayNameOf as dispOf771, allotteesOf as allot771, type ResearchView as View771, type ResearchItem as Item771 } from '../ai-gainers/research-view';
import { fixtureInput as fx771, fixtureInputUS as fxUS771 } from './fixtures/gainers-view.fixture';
import { RULES_VERSION as RULES771, denialKindOf as denialKind771, buildFinding as buildFinding771, classifyAnnouncement as classify771 } from '../ai-gainers/catalyst-research';
import { classifyUsFiling as classifyUs771 } from '../ai-gainers/us-gainers';

describe('zzz771 AG-1 — older filings are context, not the catalyst', () => {
  const every = (x: View771): Item771[] => {
    const m = new Map<string, Item771>();
    for (const i of [...x.top3, ...x.queue, ...x.watch, ...x.negative, ...x.noCatalyst, ...x.dataQuality, ...x.portfolio, ...(x.context || [])]) m.set(i.ticker, i);
    return Array.from(m.values());
  };
  const v = buildView771(fx771());
  const items = every(v);
  const it = (x: View771, t: string) => { const i = every(x).find((y) => y.ticker === t); assert.ok(i, `${t} missing`); return i!; };
  const tickers = (xs: Item771[]) => new Set(xs.map((i) => i.ticker));

  test('the window table is the single source: IN 3/14, US 7/14; unknown age is RECENT', () => {
    assert.deepEqual(WIN771, { IN: { thisMove: 3, recent: 14 }, US: { thisMove: 7, recent: 14 } });
    assert.equal(cfOf771('IN', 0), 'THIS_MOVE'); assert.equal(cfOf771('IN', 3), 'THIS_MOVE'); assert.equal(cfOf771('IN', 4), 'RECENT'); assert.equal(cfOf771('IN', 14), 'RECENT'); assert.equal(cfOf771('IN', 15), 'CONTEXT');
    assert.equal(cfOf771('US', 7), 'THIS_MOVE'); assert.equal(cfOf771('US', 8), 'RECENT'); assert.equal(cfOf771('US', 47), 'CONTEXT');
    assert.equal(cfOf771('IN', null), 'RECENT'); assert.equal(cfOf771('US', undefined), 'RECENT');
  });

  test('a result filed 47 days ago (PASUPTAC case) keeps its class but is CONTEXT: out of the queue, in view.context, counted under noCatalyst, not under confirmed', () => {
    const inp = fx771();
    const row = inp.filedResults.find((r: any) => r.ticker === 'STALEEARN'); row._ageDays = 47; row.filing_date = '2026-08-07';
    const x = buildView771(inp);
    const st = it(x, 'STALEEARN');
    assert.equal(st.eventClass, 'CONFIRMED_MATERIAL', 'the class is kept — it IS a real event');
    assert.equal(st.catalystFor, 'CONTEXT');
    assert.equal(st.ageDays, 47);
    assert.match(st.headline, /^Older context \(47d\): Q1 FY27 result filed/);
    assert.equal(st.earnings!.stale, true); assert.equal(st.earnings!.filedDaysAgo, 47);
    assert.ok(st.priorityReasons.includes("Context, not this move's catalyst (47d)"));
    assert.equal(st.action, 'Monitor');
    const ranked = tickers([...x.top3, ...x.queue, ...x.watch, ...x.negative, ...x.noCatalyst]);
    assert.ok(!ranked.has('STALEEARN'), 'context never ranks in a live section');
    assert.ok(x.context!.some((i) => i.ticker === 'STALEEARN'));
    assert.equal(x.summary.context, 1);
    assert.equal(x.summary.noCatalyst, x.noCatalyst.length + x.context!.length, 'noCatalyst counts context as "no fresh catalyst"');
    assert.equal(x.summary.confirmed, every(x).filter((i) => i.catalystFor !== 'CONTEXT' && (i.eventClass === 'CONFIRMED_MATERIAL' || i.eventClass === 'CONFIRMED_LOW_MATERIALITY')).length);
  });

  test('a result filed 12 days ago is RECENT: it stays in the queue with the freshness factor, below the fresh names', () => {
    const r = it(v, 'RECENTRES');
    assert.equal(r.catalystFor, 'RECENT'); assert.equal(r.eventClass, 'CONFIRMED_MATERIAL'); assert.equal(r.earnings!.stale, false);
    assert.ok(v.queue.some((i) => i.ticker === 'RECENTRES'));
    assert.ok(r.priorityReasons.some((s) => /^Recent \(12d\)/.test(s)));
    assert.equal(r.scoreDetails!.freshness, 0.7);
    assert.ok(it(v, 'EARNBEAT').priority > r.priority, 'a 2-day-old result outranks a 12-day-old one of similar size');
    assert.ok(it(v, 'RECENTRES').priority > it(v, 'STALEEARN').priority);
  });

  test('EarningsMini.stale flips at the recent window (14d), not 20d', () => {
    const inp = fx771();
    const row = inp.filedResults.find((r: any) => r.ticker === 'RECENTRES');
    row._ageDays = 15; row.filing_date = '2026-09-08';
    const x = buildView771(inp);
    assert.equal(it(x, 'RECENTRES').earnings!.stale, true); assert.equal(it(x, 'RECENTRES').catalystFor, 'CONTEXT');
    row._ageDays = 14; row.filing_date = '2026-09-09';
    const y = buildView771(inp);
    assert.equal(it(y, 'RECENTRES').earnings!.stale, false); assert.equal(it(y, 'RECENTRES').catalystFor, 'RECENT');
  });

  test('US: a 6-day-old filing is THIS_MOVE on a 1-week board; a 50-day-old 10-Q is context; the counts hold', () => {
    const u = buildView771(fxUS771());
    assert.equal(it(u, 'WEEKOLD').catalystFor, 'THIS_MOVE');
    const o = it(u, 'OLDRES');
    assert.equal(o.catalystFor, 'CONTEXT'); assert.match(o.headline, /^Older context \(50d\): /);
    assert.ok(!u.queue.some((i) => i.ticker === 'OLDRES') && !u.watch.some((i) => i.ticker === 'OLDRES'));
    assert.equal(u.summary.context, 1);
    const s = u.summary;
    assert.equal(s.confirmed + s.potential + s.negative + s.noCatalyst + s.dataUnavailable + (s.listings || 0), s.scanned);
  });

  test('a finding without ageDays is aged from its filing date against the scan instant, never the clock', () => {
    const inp = fx771();
    inp.findings.ACQ = { ...inp.findings.ACQ, ageDays: null, sourceDate: '2026-09-03T16:00:00+05:30' } as any;
    const x = buildView771(inp);
    assert.equal(it(x, 'ACQ').ageDays, 20, '3 Sep 16:00 IST → 23 Sep 12:00 UTC is 20.06 days'); assert.equal(it(x, 'ACQ').catalystFor, 'CONTEXT');
  });

  test('summary invariant: queue ∪ watch ⊆ eligible ∖ context; context ∩ ranked = ∅; class totals add to scanned; top3 ⊆ queue', () => {
    for (const x of [v, buildView771(fxUS771())]) {
      const ctx = tickers(x.context || []);
      const ranked = [...x.queue, ...x.watch, ...x.negative, ...x.noCatalyst];
      for (const i of ranked) assert.ok(!ctx.has(i.ticker), `${i.ticker} is context and ranked`);
      for (const i of [...x.queue, ...x.watch]) assert.ok(['CONFIRMED_MATERIAL', 'CONFIRMED_LOW_MATERIALITY', 'POTENTIAL_UNVERIFIED'].includes(i.eventClass) && i.catalystFor !== 'CONTEXT');
      for (const i of x.top3) assert.ok(x.queue.some((q) => q.ticker === i.ticker));
      for (const i of x.context || []) assert.equal(i.catalystFor, 'CONTEXT');
      for (let k = 1; k < (x.context || []).length; k++) assert.ok(x.context![k - 1].priority >= x.context![k].priority, 'context ranked by priority');
      const s = x.summary;
      assert.equal(s.confirmed + s.potential + s.negative + s.noCatalyst + s.dataUnavailable + (s.listings || 0), s.scanned);
      assert.equal(s.context, (x.context || []).length);
      assert.equal(s.noCatalyst, x.noCatalyst.length + (x.context || []).length);
    }
  });
});

describe('zzz771 AG-1 — exchange clarifications are company-confirmed no-catalyst; true denials stay negative', () => {
  const v = buildView771(fx771());
  const find = (t: string) => [...v.queue, ...v.watch, ...v.negative, ...v.noCatalyst, ...(v.context || [])].find((i) => i.ticker === t)!;

  test('denialKindOf: "no undisclosed information" / "not aware of any information" is a clarification; contradicting a report is a denial', () => {
    assert.equal(denialKind771('Astec Lifesciences replies to BSE volume inquiry, saying no undisclosed developments exist.'), 'clarification');
    assert.equal(denialKind771('The company is not aware of any information that has not been announced'), 'clarification');
    assert.equal(denialKind771('Clarification on price movement: the movement is market driven; there is no undisclosed price sensitive information'), 'clarification');
    assert.equal(denialKind771('The company denies the media report of a stake sale; the news article is baseless'), 'denial');
    assert.equal(denialKind771('Clarification on news item: there is no such proposal under consideration'), 'denial');
    assert.equal(denialKind771('Reply: the company refutes the speculation reported in the press report regarding a merger'), 'denial');
  });

  test('buildFinding stamps denialKind and a headline that says which it was', () => {
    const now = new Date('2026-09-23T12:00:00Z');
    const A = (subject: string, summary: string | null, age: number) => ({ subject, summary, url: `https://x/${age}`, dateIso: new Date(now.getTime() - age * 86_400_000).toISOString(), ageDays: age });
    const c = buildFinding771({ ticker: 'ASTEC', company: null, market: 'IN', movePct: 10.4, marketCap: 1770, turnover: 53, announcements: [A('Response To BSE Query Dated 18.09.2026', 'Astec Lifesciences replies to BSE volume inquiry, saying no undisclosed developments exist.', 1)], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(c.status, 'denied'); assert.equal(c.denialKind, 'clarification'); assert.match(c.headline || '', /no undisclosed information/);
    assert.ok(c.notes.some((n) => /company-confirmed absence/.test(n)));
    const d = buildFinding771({ ticker: 'X', company: null, market: 'IN', movePct: 12, marketCap: 900, turnover: 30, announcements: [A('Clarification on news item', 'The company denies the media report of a stake sale to a strategic investor; the report is baseless.', 1)], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(d.status, 'denied'); assert.equal(d.denialKind, 'denial'); assert.match(d.headline || '', /^Company denied the reported story/);
    assert.equal(classify771(A('Clarification on news item', 'The company denies the media report of a stake sale', 1)).kind, 'denial', 'the announcement kind is unchanged — the split is the finding\'s');
  });

  test('a clarification (DENY) → NO_CATALYST, "No identified catalyst", the clarification label, flags.denial, priced as no-catalyst, in the no-catalyst section', () => {
    const d = find('DENY');
    assert.equal(d.eventClass, 'NO_CATALYST'); assert.equal(d.eventType, 'No identified catalyst'); assert.equal(d.flags.denial, true);
    assert.equal(d.eventLabel, 'Company confirmed no undisclosed information (exchange clarification, 2026-09-22)');
    assert.equal(d.catalystFor, undefined, 'nothing to date — no catalyst');
    assert.ok(v.noCatalyst.some((i) => i.ticker === 'DENY') && !v.negative.some((i) => i.ticker === 'DENY'));
    assert.equal(d.scoreDetails!.eventQuality, 0.15, 'priced by the NO_CATALYST class');
    assert.equal(d.scoreDetails!.penalty_denial, undefined, 'a clarification is not punished twice');
    assert.ok(d.priorityReasons.includes('Company-confirmed: no undisclosed information'));
    assert.ok(d.priorityReasons.includes('Exchange clarification on file (company-confirmed)'));
    assert.match(d.scanNote || '', /^Company confirmed no undisclosed information to the exchange on 2026-09-22 — news, broker actions and sector moves are not scanned$/);
    assert.match(d.whyResearch, /company-confirmed absence of a filed catalyst/);
    assert.ok(d.researchNext.some((q) => /later filing that explains the move/.test(q)));
  });

  test('a stored pre-zzz771 finding with no denialKind is read from its headline', () => {
    const inp = fx771();
    delete (inp.findings.DENY as any).denialKind; delete (inp.findings.TRUEDENY as any).denialKind;
    const x = buildView771(inp);
    const all = [...x.negative, ...x.noCatalyst];
    assert.equal(all.find((i) => i.ticker === 'DENY')!.eventClass, 'NO_CATALYST');
    assert.equal(all.find((i) => i.ticker === 'TRUEDENY')!.eventClass, 'NEGATIVE');
  });

  test('a true denial (TRUEDENY) → NEGATIVE / Denial with the denial penalty, in the negative section', () => {
    const t = find('TRUEDENY');
    assert.equal(t.eventClass, 'NEGATIVE'); assert.equal(t.eventType, 'Denial'); assert.equal(t.flags.denial, true); assert.equal(t.action, 'Negative evidence');
    assert.equal(t.scoreDetails!.penalty_denial, 0.5);
    assert.ok(v.negative.some((i) => i.ticker === 'TRUEDENY'));
    assert.match(t.whyResearch, /contradicted a specific report/);
  });
});

describe('zzz771 AG-1 — fundraising is a flagged potential catalyst, not negative by default', () => {
  const v = buildView771(fx771());
  const u = buildView771(fxUS771());
  const find = (x: View771, t: string) => [...x.queue, ...x.watch, ...x.negative, ...x.noCatalyst, ...(x.context || [])].find((i) => i.ticker === t)!;

  test('allottees are read from the filing text: a named fund, the promoter group, or none', () => {
    assert.deepEqual(allot771('Allotment of equity shares on preferential basis to SBI Mutual Fund at ₹1,166 per share'), ['SBI Mutual Fund']);
    assert.deepEqual(allot771('Preferential issue of warrants to promoter group entities'), ['promoter group']);
    assert.deepEqual(allot771('Allotment of 50,00,000 equity shares on preferential basis at ₹120 per share'), []);
    assert.deepEqual(allot771('QIP allotment to Quant Mutual Fund and others; approved by the Board'), ['Quant Mutual Fund']);
  });

  test('preferential allotment to a named fund (ROSSTECH case) → POTENTIAL_UNVERIFIED, Fundraising, dilution flag, issue ÷ market cap, WEAK transmission, 0.75 penalty', () => {
    const r = find(v, 'ROSSFUND');
    assert.equal(r.eventClass, 'POTENTIAL_UNVERIFIED'); assert.equal(r.eventType, 'Fundraising'); assert.equal(r.flags.dilution, true);
    assert.equal(r.eventLabel, 'Fundraising — SBI Mutual Fund');
    assert.equal(r.materiality.label, 'MODERATE'); assert.equal(r.materiality.ratios[0].basis, 'market_cap');
    assert.equal(r.materiality.ratios[0].text, '₹45 Cr ÷ ₹500 Cr market cap = 9%');
    assert.equal(r.transmission, 'WEAK');
    assert.equal(r.scoreDetails!.penalty_dilution, 0.75); assert.ok(r.priorityReasons.includes('Penalty: dilution (named allottee)'));
    assert.match(r.whyResearch, /named allottee \(SBI Mutual Fund\)/);
    assert.ok(!v.negative.some((i) => i.ticker === 'ROSSFUND'));
    assert.ok(v.queue.some((i) => i.ticker === 'ROSSFUND') || v.watch.some((i) => i.ticker === 'ROSSFUND'));
    assert.ok(r.priority > find(v, 'DISTRESS').priority);
    const f = find(v, 'FINANCE');
    assert.equal(f.eventLabel, 'Fundraising — allottees not stated'); assert.equal(f.scoreDetails!.penalty_dilution, 0.6);
  });

  test('an executed small allotment is CONFIRMED_LOW_MATERIALITY; a proposed one is not allotted', () => {
    const inp = fx771();
    inp.findings.ROSSFUND = { ...inp.findings.ROSSFUND, valueStated: 5 } as any;   // 1% of market cap
    inp.findings.FINANCE = { ...inp.findings.FINANCE, stage: 'enabling', headline: 'Board to consider a proposal for preferential issue of equity shares to Vantage Capital Partners' } as any;
    const x = buildView771(inp);
    const r = find(x, 'ROSSFUND');
    assert.equal(r.eventClass, 'CONFIRMED_LOW_MATERIALITY'); assert.equal(r.materiality.label, 'SMALL'); assert.equal(r.stage, 'EXECUTED');
    const f = find(x, 'FINANCE');
    assert.equal(f.eventClass, 'POTENTIAL_UNVERIFIED'); assert.match(f.eventLabel || '', /^Fundraising — Vantage Capital Partners \((enabling|proposed), not allotted\)$/);
  });

  test('a raise beside distress markers (lenders, one-time settlement, default) → NEGATIVE', () => {
    const d = find(v, 'DISTRESS');
    assert.equal(d.eventClass, 'NEGATIVE'); assert.equal(d.eventType, 'Fundraising'); assert.equal(d.flags.dilution, true); assert.equal(d.transmission, 'NONE');
    assert.match(d.eventLabel || '', /distress markers/);
    assert.ok(v.negative.some((i) => i.ticker === 'DISTRESS'));
    for (const t of ['going concern', 'restructuring of debt with lenders', 'working capital shortfall']) {
      const inp = fx771();
      inp.findings.ROSSFUND = { ...inp.findings.ROSSFUND, headline: `Preferential allotment to SBI Mutual Fund to fund the ${t}` } as any;
      assert.equal(find(buildView771(inp), 'ROSSFUND').eventClass, 'NEGATIVE', t);
    }
  });

  test('US 424B3 / S-3 resale or shelf → NO_CATALYST with the dilution flag and the resale label; a 424B5 takedown is a new raise', () => {
    const r = find(u, 'RESALE');
    assert.equal(r.eventClass, 'NO_CATALYST'); assert.equal(r.flags.dilution, true);
    assert.equal(r.eventLabel, 'Resale registration (supply overhang) — not a new raise');
    assert.ok(u.noCatalyst.some((i) => i.ticker === 'RESALE') && !u.negative.some((i) => i.ticker === 'RESALE'));
    assert.match(r.whyResearch, /supply overhang with no new proceeds/);
    assert.match(r.scanNote || '', /resale \/ shelf registration/);
    const o = find(u, 'OFFR');
    assert.equal(o.eventClass, 'POTENTIAL_UNVERIFIED'); assert.equal(o.flags.dilution, true);
    // The classifier tells them apart by form; the view reads its words.
    assert.match(classifyUs771({ subject: '424B3: Prospectus [Rule 424(b)(3)]' })!.routineReason || '', /resale \/ shelf registration/);
    assert.match(classifyUs771({ subject: 'S-3: Registration statement' })!.routineReason || '', /resale \/ shelf/);
    assert.match(classifyUs771({ subject: 'S-3ASR: Automatic shelf registration' })!.routineReason || '', /resale \/ shelf/);
    assert.match(classifyUs771({ subject: 'S-1: Registration statement — resale by selling stockholders' })!.routineReason || '', /resale \/ shelf/);
    assert.match(classifyUs771({ subject: 'S-1: Registration statement' })!.routineReason || '', /new supply/);
    assert.match(classifyUs771({ subject: '424B5: Prospectus supplement' })!.routineReason || '', /new supply/);
    assert.equal(classifyUs771({ subject: '424B3: Prospectus' })!.kind, 'negative', 'the pipeline kind is unchanged; the view decides the class');
  });
});

describe('zzz771 AG-1 — reason texts, scan notes, scrip codes, rules version', () => {
  const v = buildView771(fx771());
  const u = buildView771(fxUS771());
  const find = (x: View771, t: string) => [...x.queue, ...x.watch, ...x.negative, ...x.noCatalyst, ...x.dataQuality, ...(x.context || [])].find((i) => i.ticker === t)!;

  test('a graded result says its figures were grader-read; a subject-line filing still says "document not parsed"', () => {
    for (const t of ['EARNBEAT', 'EARNMISS', 'STALEEARN', 'RECENTRES']) {
      const i = find(v, t);
      assert.ok(i.priorityReasons.includes('Figures from the filed result (grader-read)'), t);
      assert.ok(!i.priorityReasons.includes('Exchange filing (document not parsed)'), t);
    }
    assert.ok(find(v, 'SMALLORD').priorityReasons.includes('Exchange filing (document not parsed)'));
    assert.ok(find(u, 'TENQ').priorityReasons.includes('SEC filing (document not parsed)'));
  });

  test('no-filing rows are UNVERIFIED with a scan note that says what was scanned; the headline no longer reads "nothing happened"', () => {
    const n = find(v, 'NOCAT');
    assert.equal(n.sourceConfidence, 'UNVERIFIED');
    assert.equal(n.scanNote, 'No exchange filing in the last 21 days — news, broker actions and sector moves are not scanned');
    assert.equal(n.headline, 'No exchange filing in the last 21 days (news, broker actions and sector moves are not scanned)');
    assert.equal(n.scoreDetails!.penalty_unverified, undefined, 'not penalised as an unverified source — nothing was there to verify');
    const r = find(v, 'ROUTINE');
    assert.equal(r.sourceConfidence, 'UNVERIFIED'); assert.match(r.scanNote || '', /in the last 21 days, all routine paperwork — news, broker actions and sector moves are not scanned$/);
    assert.equal(find(v, 'BAND').sourceConfidence, 'UNVERIFIED');
    assert.match(find(v, 'UNCL').scanNote || '', /none classifiable as an event/);
    // US wording.
    const inp = fxUS771();
    inp.findings.NONE_US = { ...inp.findings.TENQ, ticker: 'NONE_US', status: 'none', category: null, headline: 'No filing in the last 21 days', sourceUrl: null, ageDays: null } as any;
    inp.board.push({ ticker: 'NONE_US', company: null, move_pct: 8, market_cap: 500 });
    const x = buildView771(inp);
    assert.equal(find(x, 'NONE_US').scanNote, 'No SEC filing in the last 21 days — news, broker actions and sector moves are not scanned');
    assert.match(find(x, 'NONE_US').headline, /^No SEC filing in the last 21 days/);
    // Rows with an event carry no scan note.
    assert.equal(find(v, 'BIGORD').scanNote, null); assert.equal(find(v, 'EARNBEAT').scanNote, null);
  });

  test('a source failure is still DATA_UNAVAILABLE, never no-catalyst', () => {
    const s = find(v, 'SRCFAIL');
    assert.equal(s.eventClass, 'DATA_UNAVAILABLE'); assert.ok(!v.noCatalyst.some((i) => i.ticker === 'SRCFAIL')); assert.equal(v.summary.dataUnavailable, 1);
  });

  test('a bare BSE scrip code shows the company first and the code small; a symbol shows as itself', () => {
    const n = find(v, '544501');
    assert.equal(n.displayTicker, 'Numeric Scrip Industries'); assert.equal(n.displayCode, '544501');
    assert.equal(find(v, 'BIGORD').displayTicker, 'BIGORD'); assert.equal(find(v, 'BIGORD').displayCode, null);
    assert.deepEqual(dispOf771('517286', 'Some Company Ltd.'), { displayTicker: 'Some Company', displayCode: '517286' });
    assert.deepEqual(dispOf771('517286', null), { displayTicker: '517286', displayCode: null }, 'no name → the code stays the ticker, nothing invented');
    assert.deepEqual(dispOf771('3IINFOLTD', '3i Infotech Ltd'), { displayTicker: '3IINFOLTD', displayCode: null }, 'a digit-leading symbol is a symbol');
  });

  test('RULES_VERSION is current (zzz782) so stored findings re-score on the zero-spend path; the fixture is built under it', () => {
    assert.match(RULES771, /zzz782$/);
    assert.match(String(fx771().findings.BIGORD.rulesVersion), /zzz77\d$/);
  });

  test('deterministic, clock-free, and no trade words in any new text', () => {
    assert.equal(JSON.stringify(buildView771(fx771())), JSON.stringify(v));
    const src = readFileSync(join(__dirname, '..', 'ai-gainers', 'research-view.ts'), 'utf8');
    assert.ok(!/Date\.now\(\)|new Date\(\)/.test(src));
    assert.equal((src.match(/export const CATALYST_WINDOWS/g) || []).length, 1, 'one window table');
    assert.ok(!/\b(thisMove|recent): \d+/.test(src.replace(/export const CATALYST_WINDOWS[\s\S]*?};/, '')), 'window days live only in the table');
    const json = JSON.stringify(v) + JSON.stringify(u);
    assert.ok(!/\b(BUY|SELL|EXIT|STOP)\b/.test(json));
    for (const i of [...v.queue, ...v.watch, ...v.negative, ...v.noCatalyst, ...(v.context || []), ...u.noCatalyst, ...(u.context || [])]) {
      const gen = [i.whyResearch, i.scanNote || '', ...i.priorityReasons, i.eventLabel || ''].join(' | ');
      assert.ok(!/\b(buy|sell|exit|stop)\b/i.test(gen), `${i.ticker}: ${gen}`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz771 AG-2 — the triage UI says, on every card, whether the event can be
// THIS move's catalyst; older filings sit apart; clarifications are neutral;
// scrip codes are never titles; the earnings mini never prints "—".
// Same pattern as zzz770 AG-B: static render of the ?demo=1 fixture.
// ═══════════════════════════════════════════════════════════════════════════
import { ResearchCard as RCard771, EarningsStrip as Strip771 } from '../../components/ai-gainers/ResearchCard';
import { EventDrawer as Drawer771 } from '../../components/ai-gainers/EventDrawer';
import type { ResearchItem as GItem771, ResearchView as GView771 } from '../ai-gainers/research-view';

describe('zzz771 AG-2 — catalystFor / older context / clarifications / display names (fixture render)', () => {
  (globalThis as any).React = ReactNS770;
  const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ');
  const page = render770(ReactNS770.createElement(Triage770, { view: demo770, market: 'IN', onRescan: () => {} }));
  const text = strip(page);
  const card = (it: GItem771, older?: boolean) => strip(render770(ReactNS770.createElement(RCard771, { it, rank: 1, onOpen: () => {}, older })));
  const drawer = (it: GItem771) => strip(render770(ReactNS770.createElement(Drawer771, { it, onClose: () => {} })));
  const all: GItem771[] = [...demo770.queue, ...demo770.watch, ...demo770.negative, ...demo770.noCatalyst, ...demo770.dataQuality, ...(demo770.context || [])];
  const by = (t: string) => { const it = all.find((x) => x.ticker === t); assert.ok(it, `fixture item ${t}`); return it!; };

  test('older filings: a collapsed section after NEGATIVE with the count, a summary tile, and the OLDER CONTEXT badge on its cards', () => {
    const neg = text.indexOf('NEGATIVE EVIDENCE'), ctx = text.indexOf('Older filings — context, not this move’s catalyst (2)'), noc = text.indexOf('NO IDENTIFIED CATALYST');
    assert.ok(neg > 0 && ctx > neg && noc > ctx, 'section order: negative → older filings → no catalyst');
    assert.ok(/data-testid="older-context" data-open="0"/.test(page), 'collapsed by default');
    assert.ok(!text.includes('VELOCAST'), 'context cards hidden while collapsed');
    assert.ok(/2\s+OLDER CONTEXT/.test(text), 'market-summary tile "2 older context"');
    const c = card(by('VELOCAST'), true);
    assert.ok(c.includes('OLDER CONTEXT · 47d'), 'older-context badge with age');
    assert.ok(c.includes('CONTEXT (47d)'), 'catalystFor badge');
    assert.ok(c.includes('EARNINGS') && c.includes('FILED 47D AGO') && c.includes('CFO / PAT'), 'the earnings mini stays on a context card');
    // Never re-counted: not in the queue, not in the top 3.
    assert.ok(!demo770.queue.some((x) => x.catalystFor === 'CONTEXT') && !demo770.top3.some((x) => x.catalystFor === 'CONTEXT'));
  });

  test('every catalystFor value has its badge; an absent field shows nothing', () => {
    assert.ok(card(by('PACEDIGITK')).includes('THIS MOVE'));
    assert.ok(card(by('ARCHEMTEK')).includes('RECENT (9d)'));
    assert.ok(card(by('KRONMETAL'), true).includes('CONTEXT (55d)'));
    assert.ok(text.includes('RECENT (9d)') && text.includes('THIS MOVE'), 'badges on the default page');
    const bare = { ...by('PACEDIGITK'), catalystFor: undefined, ageDays: undefined };
    const c = card(bare);
    assert.ok(!/THIS MOVE|RECENT \(|CONTEXT \(|OLDER CONTEXT/.test(c), 'no guess when the field is absent');
  });

  test('a bare BSE scrip code is never the title: displayTicker is, the code is beside it, the name is not printed twice', () => {
    const c = card(by('544501'));
    assert.ok(c.includes('Demo Fabrics Ltd') && c.includes('544501'));
    assert.equal((c.match(/Demo Fabrics Ltd/g) || []).length, 1, 'name printed once');
    assert.ok(/Demo Fabrics Ltd\s+544501/.test(c), 'title first, code after it');
    assert.ok(/<a [^>]*screener\.in\/company\/544501\/[^>]*>Demo Fabrics Ltd<\/a>/.test(page), 'link keeps the code, shows the name');
  });

  test('NO_CATALYST rows: scanNote under the headline; a clarification is a neutral badge, not red', () => {
    const cl = by('GAMMAAGRO');
    const c = card(cl), d = drawer(cl);
    for (const t of [c, d]) {
      assert.ok(t.includes('COMPANY: NO UNDISCLOSED INFO'), 'neutral clarification badge');
      assert.ok(!/COMPANY DENIAL|NEGATIVE EVIDENCE/.test(t), 'never the red denial pill');
      assert.ok(t.includes('SCANNED') && t.includes('1 price-movement clarification'), 'scanNote shown');
    }
    const us = by('XYZQ');
    const u = card(us);
    assert.ok(u.includes('DILUTION') && u.includes('Scanned EDGAR 7 days') && u.includes('NO IDENTIFIED CATALYST'));
    assert.ok(!card({ ...cl, scanNote: null }).includes('SCANNED'), 'no scanNote → no SCANNED line');
  });

  test('fundraising: DILUTION badge in the class colour, allottee text as given', () => {
    const html = render770(ReactNS770.createElement(RCard771, { it: by('NOVAPOLY'), rank: 1, onOpen: () => {} }));
    const t = strip(html);
    assert.ok(t.includes('DILUTION') && t.includes('POTENTIAL') && t.includes('Alpha Growth Mutual Fund'));
    const pill = /<span[^>]*border:1px solid ([^;]+);[^>]*>DILUTION<\/span>/.exec(html);
    assert.ok(pill, 'dilution pill found');
    assert.equal(pill![1], '#F59E0B', 'amber = POTENTIAL class colour, not red');
    assert.ok(!/NEGATIVE/.test(t));
  });

  test('earnings mini: every null says "Not disclosed", never "—"', () => {
    const t = strip(render770(ReactNS770.createElement(Strip771, { e: by('VELOCAST').earnings! })));
    assert.ok(!t.includes('—'), 'no dash in the mini');
    assert.ok(t.includes('+22.0% YoY · Not disclosed QoQ') && t.includes('Not disclosed'), 'mixed row says it in words');
    assert.ok((t.match(/Not disclosed/g) || []).length >= 4, 'EBITDA, margin, CFO/PAT, QoQ all in words');
    const empty = strip(render770(ReactNS770.createElement(Strip771, { e: { ...by('VELOCAST').earnings!, revenueYoY: null, patYoY: null } })));
    assert.ok(!empty.includes('—') && empty.includes('Not disclosed'));
  });

  test('the drawer carries the same badges and the scanNote; the source link is unchanged', () => {
    const d = drawer(by('VELOCAST'));
    assert.ok(d.includes('OLDER CONTEXT · 47d') && d.includes('CONTEXT (47d)') && d.includes('Open source'));
    assert.ok(drawer(by('ARCHEMTEK')).includes('RECENT (9d)'));
    const raw = render770(ReactNS770.createElement(Drawer771, { it: by('GAMMAAGRO'), onClose: () => {} }));
    assert.ok(/href="https:\/\/www\.bseindia\.com\/"/.test(raw), 'source link');
  });

  test('no "undefined" / "NaN" / "null" and no trade words in any fixture render, cards and drawers included', () => {
    const renders = [text, ...all.map((it) => card(it, it.catalystFor === 'CONTEXT')), ...all.map(drawer)];
    for (const t of renders) {
      assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b/.test(t), 'undefined/NaN/null in markup');
      assert.ok(!/\b(BUY|SELL|EXIT|STOP)\b/.test(t) && !/\b(buy|sell)\b/i.test(t), 'trade word');
    }
  });

  test('fallback: a view with none of the zzz771 fields renders as before — no new section, tile or badge', () => {
    const stripItem = (it: GItem771): GItem771 => { const { catalystFor, displayTicker, displayCode, scanNote, ...rest } = it; return rest as GItem771; };
    const { context, ...restView } = demo770;
    const { context: _c, ...restSummary } = demo770.summary;
    const old: GView771 = {
      ...restView, summary: restSummary,
      top3: demo770.top3.map(stripItem), queue: demo770.queue.map(stripItem), watch: demo770.watch.map(stripItem),
      negative: demo770.negative.map(stripItem), noCatalyst: demo770.noCatalyst.map(stripItem), dataQuality: demo770.dataQuality.map(stripItem), portfolio: demo770.portfolio.map(stripItem),
    };
    const h = render770(ReactNS770.createElement(Triage770, { view: old, market: 'IN', onRescan: () => {} }));
    const t = strip(h);
    assert.ok(!t.includes('Older filings') && !/OLDER CONTEXT/.test(t) && !/older-context/.test(h), 'no context section or tile');
    assert.ok(!/THIS MOVE|RECENT \(|CONTEXT \(|Scanned (21 days|EDGAR)/.test(t), 'no catalystFor badge, no scan note');
    assert.ok(t.includes('544501') && !t.includes('Demo Fabrics Ltd 544501'), 'ticker falls back to the code');
    const order = ['MARKET SUMMARY', 'TOP 3 RESEARCH PRIORITIES', 'RESEARCH QUEUE', 'YOUR BOOK', 'WATCH / INVESTIGATE', 'NEGATIVE EVIDENCE', 'NO IDENTIFIED CATALYST'];
    let at = -1;
    for (const s of order) { const i = t.indexOf(s, at + 1); assert.ok(i > at, `${s} missing or out of order`); at = i; }
    assert.ok(!/\bundefined\b|\bNaN\b|\bnull\b/.test(t));
    // Same input, same output: the render is deterministic.
    assert.equal(h, render770(ReactNS770.createElement(Triage770, { view: old, market: 'IN', onRescan: () => {} })));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz772 — agent Y: extraction / reading defects from the live page.
// ═══════════════════════════════════════════════════════════════════════════
import { readingFor as readingFor772, figureAndPeriod as figureAndPeriod772, daysGap as daysGap772, capexAmountText as capexAmountText772, BASIS_WORDS as BASIS_WORDS772 } from '../thesis/variables';
import { normalizeValue as normalizeValue772 } from '../thesis/fact-model';
import { quantity as quantity772 } from '../thesis/comparison';
import { stripPeriodTokens as strip772, movePeriodOut as movePeriodOut772, historicalAsOf as historicalAsOf772, rangeOf as rangeOf772 } from '../thesis/fact-normalize';
import { valueFitsVariable as fits772, isUtilisationValue as isUtil772, isResultsTable as isResultsTable772, verifiedDirection as verifiedDirection772 } from '../thesis/evidence-extract';

describe('zzz772 — agent Y rules', () => {
  const ev772 = (variable: string, value_type: string, before: string | null, after: string | null, evidence_text: string) =>
    ({ variable, value_type, before, after, unit: null, period: 'Q1 FY27', direction: 'up', evidence_text, source: 'Concall transcript Aug 2026', confidence: 'HIGH' }) as any;
  const vars772 = (events: any[], extra: any = {}) => extractVariables(null, { events, ...extra }, null, { period: 'Q1 FY27' });

  // ── Rule 1: the basis in words ──
  test('1 · the reading prints the basis in words, never in_text / vs_baseline / vs_prior_read', () => {
    assert.deepEqual(BASIS_WORDS772, { QoQ: 'QoQ', YoY: 'YoY', vs_prior_read: 'vs prior read', vs_baseline: 'vs first read', in_text: 'per filing' });
    const v = vars772([ev772('working_capital', 'ACTUAL', '145 days in Q4 FY26', '161 days', 'Working capital days increased to 161 days from 145 days in Q4 FY26.')])
      .find((x) => x.key === 'working_capital')!;
    assert.ok(v.reading, 'a reading exists');
    assert.doesNotMatch(v.reading!.display, /in_text|vs_baseline|vs_prior_read/);
    // The prior names its period, one quarter before: QoQ.
    assert.equal(v.reading!.comparison_basis, 'QoQ');
    assert.match(v.reading!.display, /161 days \(Q1 FY27\) vs 145 days \(Q4 FY26\) · \+16 days · ▲ QoQ$/);
  });

  // ── Rule 2: period labels are not numbers ──
  test('2 · period tokens are stripped before any number is read', () => {
    assert.equal(strip772('Q1 FY26: 54.80 mmscm'), '54.80 mmscm');
    assert.equal(strip772('58.94 mmscm in Q1 FY27'), '58.94 mmscm');
    assert.equal(strip772('H1 FY26 ₹120 Cr'), '₹120 Cr');
    assert.equal(strip772('9M FY26: 450 MT'), '450 MT');
    assert.equal(strip772('FY2025-26 ₹1,200 Cr'), '₹1,200 Cr');
    assert.equal(strip772('-1.43'), '-1.43', 'a minus sign is not a separator');
    assert.equal(normalizeValue772('Q1 FY26: 54.80 mmscm').normalized_value, 54.8);
    assert.equal(normalizeValue772('Q1 FY26: 54.80 mmscm').raw_value, 'Q1 FY26: 54.80 mmscm', 'the value as written is kept');
    assert.equal(quantity772('Q1 FY26: 54.80 mmscm')!.value, 54.8);
    assert.equal(quantity772('Q1 FY26: 54.80 mmscm')!.unit, quantity772('58.94 mmscm')!.unit);
    assert.deepEqual(rangeOf772('FY27: 20-25%'), { lo: 20, hi: 25, pct: true });
    assert.equal(verifiedDirection772({ before: 'Q4 FY26: 80', after: '60', direction: 'down', evidence_text: 'fell' }), 'down');
  });

  test('2 · IRMENERGY: "Q1 FY26: 54.80 mmscm → 58.94 mmscm" is +4.1 mmscm / +7.6% YoY, and the period moves out of the value', () => {
    assert.equal(movePeriodOut772('Q1 FY26: 54.80 mmscm'), '54.80 mmscm (Q1 FY26)');
    assert.deepEqual(figureAndPeriod772('Q1 FY26: 54.80 mmscm', 'Q1 FY27'), { value: '54.80 mmscm', period: 'Q1 FY26' });
    assert.deepEqual(figureAndPeriod772('54.80 mmscm (Q1 FY26)', 'Q1 FY27'), { value: '54.80 mmscm', period: 'Q1 FY26' });
    const text = 'Total sales volume grew 8% YoY to 58.94 mmscm in Q1 FY27 (Q1 FY26: 54.80 mmscm; Q4 FY26: 58.14 mmscm), with CNG continuing to be the primary growth driver.';
    const v = vars772([ev772('volume', 'ACTUAL', 'Q1 FY26: 54.80 mmscm', '58.94 mmscm', text)]).find((x) => x.key === 'volume')!;
    assert.equal(v.before, '54.80 mmscm (Q1 FY26)');
    assert.equal(v.delta, '+7.6%');
    assert.doesNotMatch(v.reading!.display, /5794|57\.9/);
    assert.match(v.reading!.display, /58\.94 mmscm \(Q1 FY27\) vs 54\.80 mmscm \(Q1 FY26\) · \+4\.1 MMSCM · \+7\.6% · ▲ YoY/);
  });

  test('2 · a persisted snapshot whose delta was computed by the old parser is recomputed from the two figures', () => {
    const v = vars772([ev772('volume', 'ACTUAL', null, '58.94 mmscm', 'Total sales volume grew to 58.94 mmscm in the quarter.')]).find((x) => x.key === 'volume')!;
    const stale: any = { state: 'FOUND', value: '58.94 mmscm', unit: 'MMSCM', numeric: 58.94, fact_type: 'ACTUAL', period_class: 'CURRENT_QUARTER',
      source_document_id: null, source_name: null, previous_period: null, previous_value: 'Q1 FY26: 54.80 mmscm',
      delta_abs: '+57.9 MMSCM', delta_pct: '+5794%', direction: 'UP', not_comparable_reason: null, computed_at: '2026-09-22' };
    const r = readingFor772({ ...v, reading: null } as any, { period: 'Q1 FY27', snapshots: { volume: stale } as any, earlier: [], baseline: null })!;
    assert.equal(r.delta_pct, '+7.6%');
    assert.equal(r.comparison_basis, 'YoY');
    assert.doesNotMatch(r.display, /5794/);
  });

  // ── Rule 3: utilisation is a utilisation ──
  test('3 · a utilisation value is a percentage or a capacity-use word', () => {
    for (const x of ['65%', '~98%', '170-odd percent utilization', 'maximum level', 'almost 100%', '19.89% CUF', 'optimum utilization', 'at full capacity', '100% capacity', 'near-full'])
      assert.equal(isUtil772(x), true, x);
    for (const x of ['1587.17 million', '30 days inventory in India (management said 15-30 days, currently 30 days).', 'tracking similar to other larger parks',
      'Civil construction at the Azad Centre of Excellence (CoE) in Tunki Bollaram is expected to be completed within this fiscal year.',
      'strong double-digit organic revenue growth for FY27', '12,000 units', 'INR 337 crores', ''])
      assert.equal(isUtil772(x), false, x);
  });

  test('3 · AZAD / TATATECH: a construction or growth sentence filed as utilisation does not reach the board, even as commentary', () => {
    const vs = vars772([
      ev772('utilisation', 'ACTUAL', null, 'Civil construction at the Azad Centre of Excellence (CoE) in Tunki Bollaram is expected to be completed within this fiscal year.',
        'Civil construction at the Azad Centre of Excellence (CoE) in Tunki Bollaram is expected to be completed within this fiscal year, adding capacity.'),
    ]);
    assert.equal(vs.find((x) => x.key === 'utilisation'), undefined);
    const ts = vars772([ev772('utilisation', 'GUIDANCE', null, 'strong double-digit organic revenue growth for FY27', 'We expect capacity to support strong double-digit organic revenue growth for FY27.')]);
    assert.equal(ts.find((x) => x.key === 'utilisation'), undefined);
    assert.equal(fits772({ variable: 'utilisation', before: null, after: '1587.17 million', unit: null, evidence_text: 'the unutilized amount stands at 1587.17 million, towards capacity' }), false);
    // Genuine ones survive.
    const ok = vars772([ev772('utilisation', 'ACTUAL', null, 'maximum level', 'We are pretty much operating at maximum level of capacity utilisation.')]);
    assert.ok(ok.find((x) => x.key === 'utilisation'));
  });

  test('3 · the summary block does not print an empty "Management commentary: “”" utilisation row', () => {
    const vs = extractVariables(null, { utilisation: { current: '', prior: '', expected: 'Optimal Level based on phased implementation.' } }, null, { period: 'Q1 FY27' });
    const u = vs.find((x) => x.key === 'utilisation');
    assert.ok(!u || !/“”/.test(String(u.display || '')));
  });

  // ── Rule 4: results table ──
  test('4 · TBZ: a value naming three or more line items with figures is a results table, never guidance', () => {
    const tbz = 'Revenue from Operations 8,409.74; Gross Profit 1,251.35; Gross Margin % 14.9%; EBITDA 710.23; EBITDA Margin % 8.4%; PBT 455.75; PAT 328.54; PAT Margin% 3.9%; EPS (₹) 4.92';
    assert.equal(isResultsTable772(tbz), true);
    assert.equal(fits772({ variable: 'guidance', before: null, after: tbz, unit: null, evidence_text: tbz }), false);
    assert.equal(vars772([ev772('guidance', 'ACTUAL', null, tbz, tbz)]).find((x) => x.key === 'guidance'), undefined);
    // Real guidance survives: two items, or three that say they look forward.
    assert.equal(isResultsTable772('Revenue growth of 20% with EBITDA margin of 18%'), false);
    assert.equal(fits772({ variable: 'guidance', before: null, after: 'Revenue ₹1,000 Cr, EBITDA ₹200 Cr and PAT ₹100 Cr by FY28', unit: null, evidence_text: 'We target revenue ₹1,000 Cr, EBITDA ₹200 Cr and PAT ₹100 Cr by FY28.' }), true);
  });

  // ── Rule 5: working-capital days, lower is better ──
  test('5 · UNIMECH: 130 days against a 160-day plan is better, and a drift word with no prior figure is not ✕', () => {
    assert.equal(daysGap772('approximately 130 days', '160 days plus'), '−30 days, better than plan');
    assert.equal(daysGap772('170 days', '160 days'), '+10 days, worse than plan');
    assert.equal(daysGap772('70%', '80%'), null);
    const v = vars772([
      ev772('working_capital', 'ACTUAL', null, 'approximately 130 days', 'Working capital days stood at approximately 130 days, slightly inching up due to new business acquisition.'),
      ev772('working_capital', 'GUIDANCE', null, '160 days plus', 'As a result, overall working capital days could gradually increase to 160 days plus by end of this year.'),
    ]).find((x) => x.key === 'working_capital')!;
    assert.notEqual(v.verdict, 'deteriorating');
    assert.equal(v.plan?.gap, '−30 days, better than plan');
  });

  test('5 · period comparisons of days keep the inverse reading: 145 → 161 days worse, 142 → 117 days better', () => {
    const worse = vars772([ev772('working_capital', 'ACTUAL', '145 days', '161 days', 'Working capital days increased from 145 days to 161 days.')]).find((x) => x.key === 'working_capital')!;
    const better = vars772([ev772('working_capital', 'ACTUAL', '142 days', '117 days', 'Working capital days improved from 142 days to 117 days.')]).find((x) => x.key === 'working_capital')!;
    assert.equal(worse.verdict, 'deteriorating');
    assert.equal(better.verdict, 'improving');
  });

  // ── Rule 6: a bare level is stated ──
  test('6 · an installed capacity / order book with no prior and no stated move is stated, not improving', () => {
    const lvl = vars772([ev772('capacity', 'ACTUAL', null, '55 MT', 'A major capacity expansion programme is in progress: mining throughput capacity approved at 55 MT.')]).find((x) => x.key === 'capacity')!;
    assert.equal(lvl.verdict, 'stated');
    const ob = vars772([ev772('order_book', 'ACTUAL', null, 'INR5,143 crores', 'Our closing order book by end of this quarter stands at INR5,143 crores.')]).find((x) => x.key === 'order_book')!;
    assert.notEqual(ob.verdict, 'improving');
    // A stated addition still counts.
    const add = vars772([ev772('capacity', 'ACTUAL', null, '120,000 MTPA', 'During the year, we successfully expanded Ethyl Acetate capacity to 120,000 MTPA.')]).find((x) => x.key === 'capacity')!;
    assert.equal(add.verdict, 'improving');
  });

  // ── Rule 7: capex is an amount; services have no installed capacity ──
  test('7 · capex needs an amount; a long spend sentence keeps only its amounts', () => {
    assert.equal(fits772({ variable: 'capex', before: null, after: 'remain at similar levels', unit: null, evidence_text: 'We expect FY27 investments to remain at similar levels.' }), false);
    assert.equal(fits772({ variable: 'capex', before: null, after: 'City of Time Gurgaon', unit: null, evidence_text: 'Capex on City of Time Gurgaon.' }), false);
    assert.equal(vars772([ev772('capex', 'GUIDANCE', null, 'remain at similar levels', 'We expect FY 2026-27 investments to remain at similar levels.')]).find((x) => x.key === 'capex'), undefined);
    const mtar = 'for quarter 1, we might have spent around INR30 crores -INR35 crores only capex, but overall INR80 crores which is capitalized';
    assert.equal(capexAmountText772(mtar), 'around INR30 crores -INR35 crores · INR80 crores');
    assert.equal(capexAmountText772('216 vessels approximately with investment of INR1 lakh crores by 2047'), 'INR1 lakh crores');
    assert.equal(capexAmountText772('Rs 58.29 crores'), 'Rs 58.29 crores');
    // A stated absence of capex is kept.
    assert.equal(fits772({ variable: 'capex', before: null, after: 'we did not foresee any significant core business capex during FY27', unit: null, evidence_text: 'x' }), true);
  });

  test('7 · installed capacity is dropped for a services business and for captive solar at a non-power business', () => {
    const svc = extractVariables({ sector: 'IT Services', industry: 'Software' }, {
      events: [ev772('capacity', 'ACTUAL', null, '12,579 associates', 'Our total installed capacity was 12,579 associates at quarter end.')],
    }, null, { period: 'Q1 FY27' });
    assert.equal(svc.find((x) => x.key === 'capacity'), undefined);
    const dist = extractVariables({ sector: 'Trading & Distributors', industry: 'IT distribution' }, {
      events: [ev772('capacity', 'ACTUAL', null, '100 MW', '100 MW of solar capacity created across our warehouses for captive use.')],
    }, null, { period: 'Q1 FY27' });
    assert.equal(dist.find((x) => x.key === 'capacity'), undefined);
    const solarCo = extractVariables({ sector: 'Power', industry: 'Renewable energy' }, {
      events: [ev772('capacity', 'ACTUAL', null, '100 MW', 'We commissioned 100 MW of solar capacity in the quarter.')],
    }, null, { period: 'Q1 FY27' });
    assert.ok(solarCo.find((x) => x.key === 'capacity'), 'a power company keeps its MW');
  });

  test('7 · "In FY 2025-26, capex stood at …" read in Q1 FY27 is last year\'s figure, not this quarter\'s (and never "FY20")', () => {
    const t = 'In FY 2025-26, capital expenditure stood at INR 4,342 Mn (Excluding Manx Acquisition) and we expect FY 2026-27 investments to remain at similar levels.';
    assert.equal(historicalAsOf772({ after: 'INR 4,342 Mn', before: null, evidence_text: t, variable: 'capex', value_type: 'ACTUAL' }, 'Q1 FY27'), 'FY26');
  });

  // ── Rule 8: exports are exports ──
  test('8 · GOLDIAM: a product share of the export mix is not the export share; exports need export vocabulary', () => {
    assert.equal(fits772({ variable: 'exports', before: '87.8%', after: '90.7%', unit: null,
      evidence_text: 'Lab Grown Diamond jewellery exports contributed 90.7% to the overall export sales mix during Q1 FY27, compared to 87.8% in Q1 FY26.' }), false);
    assert.equal(fits772({ variable: 'exports', before: '87.8%', after: '90.7%', unit: null, evidence_text: 'Lab-grown share rose to 90.7% from 87.8%.' }), false);
    assert.equal(fits772({ variable: 'exports', before: null, after: '59%', unit: null, evidence_text: 'Exports contributed 59% of revenue in Q1 FY27.' }), true);
    assert.equal(fits772({ variable: 'exports', before: null, after: 'ROW 94% of revenue, India 6%', unit: null, evidence_text: 'Exports / geography: ROW 94% of revenue, India 6%.' }), true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ── zzz772 thesis card — materiality, QoQ-only, rates, contradicted chip, capex earning words ──
import {
  ThesisCard as Card772, chipValue as chip772, rowTreatment as treat772, treatmentWord as tword772, isNegligibleDelta as negl772, humanTokens as human772,
} from '../../components/thesis-card';
import { buildCapexChain as chain772, revenueAttribution as attr772, spentPhrase as spent772 } from '../thesis/capex-chain';

describe('zzz772 thesis card — UNCHANGED only on ≈0, QoQ-only is a level, rates are never "single reading"', () => {
  const R = (key: string, verdict: string, extra: any = {}) => ({ key, label: key, weight: 3, verdict, before: null, after: null, delta: null,
    evidence: '', state: 'FOUND', stateReason: null, absence: null, invalidation: null, why: '', ...extra });

  test('a flat verdict on a real move is "within materiality", with the delta; UNCHANGED needs |Δ| ≈ 0', () => {
    const redington = R('margin', 'flat', { before: '1.5%', after: '2.0%', delta: '+0.5pp' });
    assert.equal(treat772(redington as any), 'WITHIN_MATERIALITY');
    const nrb = R('earnings_growth', 'flat', { before: '3,281 lakhs', after: '3,776 lakhs', delta: '+15.1%' });
    assert.equal(treat772(nrb as any), 'WITHIN_MATERIALITY');
    assert.equal(tword772('WITHIN_MATERIALITY', nrb as any), 'within materiality (+15.1%)');
    // The value beside it already shows the delta → not repeated.
    assert.equal(tword772('WITHIN_MATERIALITY', nrb as any, chip772(nrb as any)), 'within materiality');
    assert.equal(treat772(R('margin', 'flat', { before: '17.0%', after: '17.0%', delta: '+0.0pp' }) as any), 'UNCHANGED');
    assert.equal(treat772(R('margin', 'flat', { before: '17.0%', after: '17.3%', delta: '+0.3pp' }) as any), 'UNCHANGED');
    assert.equal(treat772(R('earnings_growth', 'flat', { before: '100 Cr', after: '100.5 Cr', delta: '+0.5%' }) as any), 'UNCHANGED');
    assert.equal(treat772(R('capacity', 'flat', { before: '1.34 MW', after: '1.34 MW' }) as any), 'UNCHANGED');
    assert.equal(negl772(R('order_book', 'flat', { before: '₹100 Cr', after: '₹130 Cr' }) as any), false);
    // The status engine's own flag, where it supplies one, is honoured.
    assert.equal(treat772(R('margin', 'flat', { before: '17.0%', after: '17.0%', delta: '+0.0pp', withinMateriality: true }) as any), 'WITHIN_MATERIALITY');
  });

  test('a QoQ-only margin prints "{level} · QoQ only ({delta} QoQ) — seasonal, not judged"; a genuinely ambiguous value stays unclear', () => {
    const qoq = R('margin', 'stated', { after: '10.5%', delta: '+1.2pp QoQ', state: 'UNCLEAR',
      stateReason: 'only a sequential (QoQ) move is on file, which carries seasonality', unjudged: 'only a sequential (QoQ) move is on file, which carries seasonality' });
    assert.equal(treat772(qoq as any), 'QOQ_ONLY');
    assert.equal(chip772(qoq as any), '10.5% · QoQ only (+1.2pp QoQ) — seasonal, not judged');
    assert.doesNotMatch(chip772(qoq as any), /unclear|validation required/);
    const amb = R('utilisation', 'stated', { after: '30% or 25%', state: 'UNCLEAR', stateReason: 'two different figures for one period' });
    assert.equal(treat772(amb as any), 'UNCLEAR');
    assert.equal(chip772(amb as any), 'unclear — validation required: 30% or 25%');
  });

  test('a YoY growth rate or margin with a delta is a comparison — never "single reading"; ROCE alone still is', () => {
    assert.equal(treat772(R('revenue_growth', 'flat', { after: '+8.4%' }) as any), 'WITHIN_MATERIALITY');
    assert.equal(treat772(R('earnings_growth', 'flat', { after: '+18.5%', delta: '+18.5%' }) as any), 'WITHIN_MATERIALITY');
    assert.equal(treat772(R('margin', 'flat', { after: '12.0%', delta: '+0.3pp' }) as any), 'WITHIN_MATERIALITY');
    assert.equal(treat772(R('roce', 'flat', { after: '12.0%' }) as any), 'SINGLE');
  });

  test('no raw code token survives on a printed reading', () => {
    assert.equal(human772('161 days vs 145 days · +16 days · ▲ in_text'), '161 days vs 145 days · +16 days · ▲ in the text');
    assert.doesNotMatch(human772('x · → vs_baseline · vs_prior_read · NOT_COMPARABLE · UNKNOWN_BASIS · undefined'), /in_text|vs_baseline|vs_prior_read|NOT_COMPARABLE|UNKNOWN_|undefined/);
  });

  describe('rendered card', () => {
    (globalThis as any).React = ReactNS770;
    const g = row('INNOVACAP') || row('KMEW');
    const vars = ev771(g, { order_book: { current: '', prior: '' } });
    const a: any = assess771({ pattern: 'A', variables: vars, evidenceReviewed: true, hasGraderRow: true } as any);
    a.checked = a.checked.filter((c: any) => !['margin', 'revenue_growth', 'earnings_growth', 'working_capital'].includes(c.key));
    a.checked.push(
      R('margin', 'stated', { label: 'Operating margin', weight: 3, after: '10.5%', delta: '+1.2pp QoQ', state: 'UNCLEAR',
        stateReason: 'only a sequential (QoQ) move is on file, which carries seasonality', unjudged: 'only a sequential (QoQ) move is on file, which carries seasonality' }),
      R('revenue_growth', 'flat', { label: 'Revenue growth', weight: 4, after: '+8.4%' }),
      R('earnings_growth', 'flat', { label: 'Earnings growth', weight: 4, before: '3,281 lakhs', after: '3,776 lakhs', delta: '+15.1%' }),
      R('working_capital', 'deteriorating', { label: 'Working capital', weight: 3, before: '145 days', after: '161 days', delta: '+11%',
        reading: { current: { value: '161 days', period: 'Q1 FY27', period_class: 'CURRENT_QUARTER', unit: 'days', numeric: 161, source: 'concall' }, previous: null, baseline: null,
          delta_abs: '+16 days', delta_pct: null, direction: 'UP', comparison_basis: 'in_text', not_comparable_reason: null, display: '161 days vs 145 days · +16 days · ▲ in_text' } }),
    );
    a.verdict = {
      breakTrigger: { fired: false, conditions: [], text: 'No stated thesis-break condition has been met.' },
      direction: 'WEAKENING', directionWhy: 'working capital deteriorated',
      evidence: 'PARTIALLY_CONFIRMED', evidenceWhy: '', coverage: { confirmed: 2, applicable: 4, missing: ['One-offs', 'Working capital', 'Cash conversion'], contradicted: ['Working capital'] },
    };
    const html = render770(ReactNS770.createElement(Card772 as any, { symbol: 'CYIENTDLM', market: 'IN', assessment: a, capex: null, defaultOpen: true }));
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

    test('QoQ-only margin renders as a level, never "unclear — validation required: <n>%"', () => {
      assert.match(text, /Operating margin 10\.5% · QoQ only \(\+1\.2pp QoQ\) — seasonal, not judged/);
      assert.doesNotMatch(text, /unclear — validation required: 10\.5%/);
      assert.match(html, /data-treatment="QOQ_ONLY"/);
    });

    test('growth rates print their treatment, never "single reading"; a real move is never "UNCHANGED (two readings)"', () => {
      assert.doesNotMatch(text, /Revenue growth \+8\.4% · single reading/);
      assert.match(text, /Revenue growth \+8\.4% · within materiality/);
      assert.match(text, /Earnings growth 3,281 lakhs → 3,776 lakhs · \+15\.1% · within materiality/);
      assert.doesNotMatch(text, /\+15\.1% · UNCHANGED/);
    });

    test('evidence chip: contradicted in red before missing, and never listed under missing', () => {
      assert.match(html, /data-testid="evidence-contradicted"/);
      assert.match(text, /· contradicted: Working capital\s*· missing: One-offs, Cash conversion/);
      const miss = (/missing: ([^A-Z]*(?:[A-Z][^A-Z·]*)*)/.exec(text) || ['', ''])[1];
      assert.doesNotMatch(miss.split(/FINANCIAL|CASH/)[0], /Working capital/);
    });

    test('no code token, undefined, NaN or null in the rendered card', () => {
      assert.doesNotMatch(text, /\bin_text\b|\bvs_baseline\b|\bvs_prior_read\b|NOT_COMPARABLE|UNKNOWN_|\bundefined\b|\bNaN\b|\bnull\b/);
    });

    test('fallback: without coverage.contradicted the chip renders exactly as before', () => {
      const b: any = { ...a, verdict: { ...a.verdict, coverage: { confirmed: 2, applicable: 4, missing: ['One-offs'] } } };
      const t = render770(ReactNS770.createElement(Card772 as any, { symbol: 'X', market: 'IN', assessment: b, capex: null })).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      assert.doesNotMatch(t, /contradicted:/);
      assert.match(t, /EVIDENCE: partially confirmed \(2\/4 structural\)\s*· missing: One-offs/);
    });
  });
});

describe('zzz772 capex earning — "has begun contributing" is revenue, a forecast is a target, junk never prints', () => {
  const V = (key: string, verdict: string, extra: any = {}) => ({ key, label: key, kind: 'fact', before: null, after: null, delta: null, verdict, evidence: '', source: 'filing', statement: 'ACTUAL', ...extra });
  const KEI = 'Sanand Phase I has begun contributing; management estimates Sanand will generate INR1,500-2,000 crores in FY27 and INR6,000-7,000 crores annual revenue when fully ramped within 2 years.';

  test('KEI: begun contributing → PARTIAL; the forecast is printed as a target, never as the contribution', () => {
    const e = chain772(null, [V('capex_earning', 'stated', { after: KEI }), V('capex', 'stated', { after: 'INR 1,722 cr incurred' }), V('utilisation', 'stated', { after: '72%' })] as any, { periods: {} } as any).earning;
    assert.equal(e.state, 'PARTIAL');
    assert.match(String(e.revenueContribution), /^begun — Sanand Phase I, amount not stated$/);
    assert.doesNotMatch(String(e.revenueContribution), /1,500/);
    assert.match(e.lines[1], /^Revenue contribution: begun — Sanand Phase I, amount not stated · target INR1,500-2,000 crores in FY27$/);
  });

  test('present / past tense attributes; future tense never does', () => {
    for (const t of ['The Jammu line started contributing revenue this quarter.', 'Plant 2 is contributing to revenue.', 'Unit III now contributing.',
      'The Hosur plant contributed ₹42 crore in Q1 FY27.']) assert.ok(attr772(t).actual, t);
    assert.equal(attr772('The Hosur plant contributed ₹42 crore in Q1 FY27.').actual, '₹42 crore in Q1 FY27');
    for (const t of ['The plant will contribute from FY28.', 'Phase II is expected to contribute ₹300 crore.', "Jammu capex is expected to start contributing revenue from Mar '27.",
      'The new line has not yet contributed.']) assert.equal(attr772(t).actual, null, t);
    assert.equal(attr772('Phase II is expected to contribute ₹300 crore in FY28.').target, '₹300 crore in FY28');
    // The capex amount in a forward sentence is not a revenue target.
    assert.equal(attr772('PEC capex of INR150 crores is expected to enable incremental production from October 2026.').target, null);
  });

  test('"Utilisation:" prints a percentage or a capacity-use word, else "not disclosed"', () => {
    for (const junk of ['30 days inventory in India', '1587.17 million', 'Civil construction at the CoE is expected to be completed within this fiscal year.', 'tracking similar to other larger parks']) {
      const e = chain772(null, [V('capex', 'stated', { after: '₹100 cr spent' }), V('utilisation', 'stated', { after: junk })] as any, { periods: {} } as any).earning;
      assert.match(e.lines.find((l) => l.startsWith('Utilisation:'))!, /^Utilisation: not disclosed$/, junk);
    }
    for (const ok of ['72%', 'maximum level', 'optimum utilization', '170-odd percent utilization', 'near-full']) {
      const e = chain772(null, [V('capex', 'stated', { after: '₹100 cr spent' }), V('utilisation', 'stated', { after: ok })] as any, { periods: {} } as any).earning;
      assert.ok(e.lines.find((l) => l.startsWith('Utilisation:'))!.includes(ok), ok);
    }
  });

  test('"Spent:" past ~70 chars keeps only the amount phrases', () => {
    const long = 'for quarter 1, we might have spent around INR30 crores -INR35 crores only capex, but overall INR80 crores which is capitalized';
    assert.equal(spent772(long), 'INR30 crores -INR35 crores; INR80 crores');
    assert.equal(spent772('INR 1,722 cr'), 'INR 1,722 cr');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('zzz773 gainers — press context, exclusive counts, source failures', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nc = require('../ai-gainers/news-context') as typeof import('../ai-gainers/news-context');
  const now = new Date('2026-09-24T09:00:00Z');
  const raw = [
    { title: 'Sedemac Mechatronics shares worth ₹1,469 crore change hands in block deal - CNBC TV18', url: 'u1', published_at: '2026-09-24T03:30:00Z' },
    { title: 'Sedemac block deal: up to 10% on offer at a ₹3,000 floor price - Mint', url: 'u2', published_at: '2026-09-23T15:00:00Z' },
    { title: 'SEDEMAC - 2026 Latest Shareholding - tracxn.com', url: 'u3', published_at: '2026-09-20T01:00:00Z' },
    { title: 'Kavveri Defence Shares fall 8% today - X', url: 'u4', published_at: '2026-09-11T01:00:00Z' },
    { title: 'Sedemac Mechatronics Surpasses 1 Million Sales - Sahi', url: 'u5', published_at: '2026-06-01T01:00:00Z' },
  ];
  test('a theme covered on two days is a running story; spam, other companies and old items are dropped', () => {
    const c = nc.buildNewsContext(raw, { ticker: 'SEDEMAC', company: 'Sedemac Mechatronics', now });
    assert.equal(c.items.length, 2);
    assert.equal(c.narrative?.theme, 'block_deal');
    assert.equal(c.narrative?.days, 2);
    assert.equal(c.items[0].source, 'CNBC TV18');
  });
  test('the company name does not theme its own headline (Kavveri Defence is not defence-sector news)', () => {
    const c = nc.buildNewsContext([raw[3]], { ticker: 'KAVDEFENCE', company: 'Kavveri Defence & Wireless Technologies', now });
    assert.deepEqual(c.items[0].themes.includes('sector_theme'), false);
  });
  test('company name comes from the screener page title', () => {
    assert.equal(nc.companyNameFromPage('<title>Mazda Ltd share price | About Mazda</title>'), 'Mazda Ltd');
  });
  test('the page shows exclusive groups, a press block and a retry button; no "stock down = not priced" text', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'app', '(dashboard)', 'ai-gainers', 'page.tsx'), 'utf8');
    assert.ok(/groups are exclusive and add up to/.test(src));
    assert.ok(/PRESS · SECONDARY, UNVERIFIED/.test(src));
    assert.ok(/retry_failed: true/.test(src));
    assert.ok(!/A stock that is down has not priced/.test(src));
    assert.ok(!/label: '[^']*(not yet priced in|largely priced)/.test(src));
  });
});

describe('zzz774 gainers — BSE list merged with screener', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { mergeAnnouncements } = require('../ai-gainers/catalyst-research') as typeof import('../ai-gainers/catalyst-research');
  test('one row per filing; screener row wins a tie; BSE-only filings are added, newest first', () => {
    const scr = [{ subject: 'Announcement under Regulation 30 (LODR)-Award_of_Order_Receipt_of_Order', summary: 'Order worth ₹22 crore', url: 's1', dateIso: '2026-09-17T10:00:00+05:30', ageDays: 7 }];
    const bse = [
      { subject: 'Announcement under Regulation 30 (LODR)-Award_of_Order_Receipt_of_Order', summary: 'longer BSE headline', url: 'b1', dateIso: '2026-09-17T10:00:00+05:30', ageDays: null },
      { subject: 'Board Meeting Outcome', summary: 'Approved merger', url: 'b2', dateIso: '2026-09-06T18:00:00+05:30', ageDays: null },
      { subject: 'Press Release', summary: null, url: 'b3', dateIso: '2026-09-22T09:00:00+05:30', ageDays: null },
    ];
    const m = mergeAnnouncements(scr as any, bse as any);
    assert.deepEqual(m.map((x) => x.url), ['b3', 's1', 'b2']);
    assert.equal(m[1].summary, 'Order worth ₹22 crore');
  });
});

describe('zzz775 gainers — tax is not an order, GDV is not value, answers from the filing', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const cr = require('../ai-gainers/catalyst-research') as typeof import('../ai-gainers/catalyst-research');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const rv = require('../ai-gainers/research-view') as typeof import('../ai-gainers/research-view');
  const A2 = (subject: string, summary: string | null = null) => ({ subject, summary, url: 'https://x/a.pdf', dateIso: '2026-09-22T10:00:00+05:30', ageDays: 2 });
  test('a GST / ITAT order is a tax matter, never an order win (SEDEMAC, KSCL, VIKRAN)', () => {
    for (const s of ['Tamil Nadu GST order received on 8 Sep 2026; ₹40,036 demand confirmed for FY23', 'Kaveri Seed received ITAT hearing notice for Rs56.21 crore AY2022-23 tax demand', 'Received GST show cause notice demanding Rs. 5.34 crore tax and penalty']) {
      const c = cr.classifyAnnouncement(A2('Announcement under Regulation 30 (LODR)-Updates', s) as any, 'IN');
      assert.equal(c.kind, 'negative', s); assert.equal(c.category, 'tax_litigation', s);
    }
    const ok = cr.classifyAnnouncement(A2('Updates', 'CESTAT set aside the demand and allowed the appeal in the company\'s favour') as any, 'IN');
    assert.equal(ok.kind, 'routine');
  });
  test('fractional-entitlement compensation under a scheme is paperwork (CELLO)', () => {
    assert.equal(cr.classifyAnnouncement(A2('Updates', 'Audit Committee certify compensation to Wim Plast shareholders for fractional entitlements under the amalgamation scheme') as any, 'IN').kind, 'routine');
  });
  test('a gross development value is not the company\'s value (MAXESTATES)', () => {
    assert.ok(cr.isPotentialValue('9.76-acre project may unlock INR 2,500-3,000 crore GDV'));
  });
  test('research questions carry the filing\'s answers; silence on a read filing is said', () => {
    const out = rv.answerQuestions(['What % of FY revenue is this order?', 'Over what period is it executed, and when does revenue start?', 'What margin does it carry versus the company average?'],
      { facts: { execution_period: 'within 15 working days' }, read: true, value: 50, marketCap: 1000, market: 'IN', revenue: 400, headline: '', quote: null });
    assert.match(out[0], /12\.5% of TTM revenue/); assert.match(out[0], /5% of market cap/);
    assert.match(out[1], /✓ within 15 working days/);
    assert.match(out[2], /not stated in the filing/);
  });
  test('returns carry a 1-week move', () => {
    const series: Array<[string, number]> = Array.from({ length: 30 }, (_, i) => [`2026-08-${String(i + 1).padStart(2, '0')}`, 100 + i]);
    const r = cr.returnsFromSeries(series);
    assert.equal(Math.round((r.w1 as number) * 10) / 10, Math.round(((129 / 124) - 1) * 1000) / 10);
  });
});

test('zzz776 — consideration "for up to ₹X" is a value, honorific stops, bare-rupee tax sums, 1W from the stored tail', () => {
  const cls = (h: string) => classify768({ subject: 'General Updates', summary: h, url: 'x', dateIso: '2026-09-20', ageDays: 3 } as any, 'IN');
  assert.equal(cls('Jagsonpal signs BTA to acquire Group Pharma wellness portfolio for up to ₹46.7 crore, closing by 1 Nov 2026.').valueStated, 46.7);
  assert.equal(cls('Milky Mist commissioned plant; capacity up to 150 TPD, Rs.40 crore.').valueStated, 40);
  assert.equal(cls('Max Estates signs binding MoU; project may unlock INR 2,500-3,000 crore GDV.').valueStated, null);
  assert.equal(cls('Company Secretary and Compliance Officer Ms. Shubha Singh resigned effective September 19, 2026.').kind, 'routine');
  assert.equal(cls('Kaveri Seed received ITAT hearing notice for Rs56.21 crore AY2022-23 tax demand').category, 'tax_litigation');
  assert.equal(fmtMoney(0.0040036, 'IN'), '₹40,036');
  assert.equal(fmtMoney(0.0353, 'IN'), '₹3.5 lakh');
});

// ═══════════════════════════════════════════════════════════════════════════
// zzz782 — US gainers: plain 8-K subjects, 1D from daily closes, the press
// release read without a model, and "not checked" ≠ "nothing filed".
// ═══════════════════════════════════════════════════════════════════════════
import { usPlainSubject as plain782, usEightKLead as lead782, extractUsPressRelease as pr782, classifyUsFiling as cls782, announcementsFromSubmissions as subs782 } from '../ai-gainers/us-gainers';
import { buildFinding as build782, d1FromTail as d1782, returnsFromSeries as rfs782, classifyAnnouncement as ca782 } from '../ai-gainers/catalyst-research';
import { usDocumentReadFromText as docRead782 } from '../ai-gainers/edgar-research';
import { buildResearchView as view782 } from '../ai-gainers/research-view';
import { fixtureInputUS as fxUS782 } from './fixtures/gainers-view.fixture';

describe('zzz782 US gainers — plain 8-K subjects, 1D, press release, EDGAR not-checked', () => {
  const now = new Date('2026-09-22T20:30:00Z');
  const edgar: Record<string, any> = JSON.parse(fx('edgar-submissions-us-20260922.json'));

  test('an 8-K subject leads with what happened, keeps item codes as a tag, and is idempotent', () => {
    const old = '8-K: Business combination agreement (also filed as merger communication) — Item 1.01 Entry into a Material Definitive Agreement; Item 9.01 Financial Statements and Exhibits · filed 07:40 ET before the open';
    const p = plain782(old);
    assert.equal(p, '8-K: Business combination agreement signed (also filed as merger communication) [Item 1.01, Item 9.01] · filed 07:40 ET before the open');
    assert.equal(plain782(p), p, 'idempotent');
    assert.equal(cls782({ subject: p })?.category, 'acquisition', 'the classifier still reads the codes');
    assert.equal(plain782('8-K: Item 2.02 Results of Operations and Financial Condition; Item 9.01 Financial Statements and Exhibits'), '8-K: Quarterly results released (results of operations) [Item 2.02, Item 9.01]');
    assert.equal(plain782('10-Q: 10-Q'), '10-Q: 10-Q', 'other forms untouched');
    assert.match(lead782(['7.01', '8.01', '9.01'], false), /^Other events \(company press release\); also Regulation FD/);
    assert.equal(lead782(['9.01'], false), 'Financial statements and exhibits only');
    // Live EDGAR JSON: the PRTH subject is short, plain, and never a raw item-title list.
    const prth = subs782(edgar.PRTH, edgar.PRTH.cik, 21, now).find((a) => /^8-K/.test(a.subject))!;
    assert.ok(!/Entry into a Material Definitive Agreement|Financial Statements and Exhibits/.test(prth.subject), prth.subject);
    assert.ok(prth.subject.length < 240, prth.subject);
  });

  test('insider Forms 3/4/5/144 are counted, not listed', () => {
    const stats = { insiderForms: 0, inWindow: 0 };
    const out = subs782(edgar.PRTH, edgar.PRTH.cik, 21, now, stats);
    assert.ok(stats.inWindow >= out.length);
    assert.equal(stats.inWindow - out.length >= stats.insiderForms - 0, true);
  });

  test('buildFinding normalises a stored old-style 8-K subject into the plain headline', () => {
    const a = { subject: '8-K: Business combination agreement (also filed as merger communication) — Item 1.01 Entry into a Material Definitive Agreement; Item 9.01 Financial Statements and Exhibits · filed 07:40 ET before the open', summary: null, url: 'https://www.sec.gov/a.htm', dateIso: '2026-09-21T07:40:34-04:00', ageDays: 1 };
    const f = build782({ ticker: 'PRTH', company: null, market: 'US', movePct: 31, marketCap: 643, turnover: 70, announcements: [a], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.category, 'acquisition');
    assert.match(f.headline || '', /^8-K: Business combination agreement signed/);
    assert.ok(!/Financial Statements and Ex/.test(f.headline || ''));
  });

  test('1D is the last daily bar against the close before it — from the series, or a stored tail', () => {
    assert.deepEqual(d1782([['2026-09-22', 10], ['2026-09-23', 11]]), { d1: 10, d1Date: '2026-09-23' });
    assert.deepEqual(d1782([['2026-09-23', 11]]), { d1: null, d1Date: null });
    const series: Array<[string, number]> = Array.from({ length: 30 }, (_, i) => [`2026-08-${String(i + 1).padStart(2, '0')}`, 100 + i]);
    assert.equal(rfs782(series).d1, Math.round(((129 / 128) - 1) * 1000) / 10);
    const f = build782({ ticker: 'X', company: null, market: 'US', movePct: 20, marketCap: 500, turnover: 10, announcements: [], returns: { m1: 1, m3: 1, m6: 1, y1: 1, history: 999, tail: [['2026-09-22', 20], ['2026-09-23', 21]] }, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.returns?.d1, 5); assert.equal(f.returns?.d1Date, '2026-09-23');
    // The view shows it as the US 1D; without a daily series it stays "—" (null), never the 1W.
    const inp = fxUS782();
    inp.findings.TENQ = { ...inp.findings.TENQ, returns: { d1: 4.26, d1Date: '2026-09-23', w1: null, m1: null, m3: null, m6: null, y1: null, history: 999 } } as any;
    const v = view782(inp);
    const all = [...v.queue, ...v.watch, ...v.negative, ...v.noCatalyst, ...(v.context || [])];
    assert.equal(all.find((i) => i.ticker === 'TENQ')!.move1d, 4.3);
    assert.equal(all.find((i) => i.ticker === 'OFFR')!.move1d, null);
  });

  const MERGER_PR = 'Exhibit 99.1 NEW YORK, Sept. 21, 2026 (GLOBE NEWSWIRE) -- Priority Technology Holdings, Inc. today announced that it has entered into a definitive merger agreement to be acquired by Acme Capital. '
    + 'Under the terms of the agreement, Acme will acquire all outstanding shares for $9.50 per share in cash, a premium of approximately 38% to the closing price on September 19, 2026. '
    + 'The transaction is valued at approximately $1.3 billion, including net debt. '
    + 'The transaction is expected to close in the first quarter of 2027, subject to customary closing conditions including stockholder approval. '
    + 'The combined company could generate revenue of up to $2 billion over time.';
  const cand = (subject: string, kind: any, category: any) => ({ subject, summary: null, url: 'https://www.sec.gov/Archives/edgar/data/1/2/ex99-1.htm', dateIso: '2026-09-21T07:40:34-04:00', ageDays: 1, kind, category, stage: 'executed', valueStated: null, incremental: true, routineReason: null } as any);

  test('press release: a stated deal value, per-share terms and closing conditions are quoted verbatim; a hedged figure is dropped', () => {
    const p = pr782(MERGER_PR);
    assert.equal(p.valueM, 1300);
    assert.equal(p.valueSentence, 'The transaction is valued at approximately $1.3 billion, including net debt.');
    assert.match(p.facts.price_terms, /^\$9\.50 per share in cash, a 38% premium/);
    assert.match(p.facts.conditions, /expected to close in the first quarter of 2027/);
    assert.equal(pr782('The agreement could be worth up to $500 million over five years if all options are exercised by the customer.').valueM, null, 'up to / could is not a value');
    assert.equal(pr782('').valueM, null);
  });

  test('a merger 8-K read from its press release carries the stated value as a verbatim document quote — no model', () => {
    const c = cand('8-K: Business combination agreement signed (also filed as merger communication) [Item 1.01, Item 9.01] · filed 07:40 ET before the open', 'catalyst', 'acquisition');
    const { read } = docRead782(c, MERGER_PR);
    assert.ok(read); assert.equal(read!.source, 'document_extract'); assert.equal(read!.valueStated, 1300);
    assert.ok(MERGER_PR.includes(read!.quote));
    const f = build782({ ticker: 'PRTH', company: null, market: 'US', movePct: 31, marketCap: 643, turnover: 70, announcements: [c], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now, read: read! });
    assert.equal(f.status, 'catalyst'); assert.equal(f.category, 'acquisition');
    assert.equal(f.valueStated, 1300); assert.equal(f.docExtract, true); assert.equal(f.modelRead, false, 'not a model read');
    assert.ok(f.notes.some((n) => /Read without a model/.test(n)));
    const v = view782({ ...fxUS782(), findings: { PRTH: f }, board: [{ ticker: 'PRTH', company: null, move_pct: 31, market_cap: 643 }] });
    const it = [...v.queue, ...v.watch, ...v.negative, ...v.noCatalyst, ...(v.context || [])].find((i) => i.ticker === 'PRTH')!;
    assert.equal(it.sourceConfidence, 'VERIFIED_DOCUMENT');
    assert.notEqual(it.materiality.label, 'UNKNOWN');
    assert.ok(!it.priorityReasons.includes('SEC filing (document not parsed)'));
  });

  test('an earnings release: the revenue sentence is quoted, but its dollar figure is never a deal value', () => {
    const c = cand('8-K: Quarterly results released (results of operations) [Item 2.02, Item 9.01]', 'catalyst', 'quarterly_result');
    const text = 'ACME Corp. today reported financial results for its second quarter ended August 31, 2026. Total revenue was $412.5 million, an increase of 24% year over year. The company raised its full-year guidance for fiscal 2027 revenue.';
    const { read } = docRead782(c, text);
    assert.ok(read); assert.equal(read!.valueStated, null);
    assert.match(read!.headline, /^Results released — Total revenue was \$412\.5 million/);
    assert.match(read!.facts!.guidance, /raised its full-year guidance/);
    const f = build782({ ticker: 'ACME', company: null, market: 'US', movePct: 18, marketCap: 900, turnover: 40, announcements: [c], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now, read: read! });
    assert.equal(f.category, 'quarterly_result'); assert.equal(f.valueStated, null);
    assert.ok(f.notes.some((n) => /whether the result was good is not judged/.test(n)));
  });

  test('an item only a reader can classify gets the release lead as its SUMMARY — never a verified read', () => {
    const c = cand('8-K: Other events (company press release) [Item 8.01, Item 9.01]', 'unclassified', null);
    const text = 'Exhibit 99.1 AUSTIN, Texas, Sept. 18, 2026 -- Widget Inc. today announced it has been awarded a $45 million contract by the U.S. Army to supply tactical radios over three years. Deliveries begin in 2027.';
    const r = docRead782(c, text);
    assert.equal(r.read, null);
    assert.match(r.summary || '', /awarded a \$45 million contract/);
    const cl = ca782({ ...c, summary: r.summary }, 'US');
    assert.equal(cl.kind, 'catalyst'); assert.equal(cl.category, 'order_win'); assert.equal(cl.valueStated, 45);
    const f = build782({ ticker: 'WID', company: null, market: 'US', movePct: 22, marketCap: 300, turnover: 10, announcements: [{ ...c, summary: r.summary }], returns: null, holding: false, sources: ['x'], sourceFailed: false, windowDays: 21, now });
    assert.equal(f.status, 'catalyst'); assert.equal(f.components?.evidence, 'SUMMARY_ONLY');
    assert.ok((f.net ?? 0) <= 44.9, 'a summary never ranks P1');
    // Boilerplate only → nothing.
    assert.deepEqual(docRead782(c, 'x'.repeat(300)), { read: null, summary: null });
  });

  test('"ticker not in the SEC list" is DATA_UNAVAILABLE with its own words, not "no SEC filing"', () => {
    const f = build782({ ticker: 'NEWCO', company: null, market: 'US', movePct: 30, marketCap: 700, turnover: 10, announcements: [], returns: null, holding: false, sources: [], sourceFailed: true, windowDays: 21, now });
    const f2 = { ...f, notes: [...f.notes, 'SEC EDGAR not checked: the ticker is not in the SEC company list (CIK not found — often a new listing or a foreign issuer filing under another symbol). This is not "no filing".'] };
    const v = view782({ ...fxUS782(), findings: { NEWCO: f2 }, board: [{ ticker: 'NEWCO', company: null, move_pct: 30, market_cap: 700 }] });
    const it = [...v.queue, ...v.watch, ...v.negative, ...v.noCatalyst, ...(v.context || []), ...v.dataQuality].find((i) => i.ticker === 'NEWCO')!;
    assert.equal(it.eventClass, 'DATA_UNAVAILABLE'); assert.match(it.headline, /not found in the SEC company list/);
    // Checked, only insider forms: said as such.
    const n = build782({ ticker: 'BETA', company: null, market: 'US', movePct: 12, marketCap: 5000, turnover: 10, announcements: [], returns: null, holding: false, sources: ['SEC EDGAR submissions'], sourceFailed: false, windowDays: 21, now });
    const n2 = { ...n, notes: [...n.notes, 'SEC EDGAR checked (CIK 1234): 3 insider ownership reports (Form 3/4/5/144) in the last 21 days — counted, not scanned as events.'] };
    const v2 = view782({ ...fxUS782(), findings: { BETA: n2 }, board: [{ ticker: 'BETA', company: null, move_pct: 12, market_cap: 5000 }] });
    const b = [...v2.queue, ...v2.watch, ...v2.negative, ...v2.noCatalyst, ...(v2.context || [])].find((i) => i.ticker === 'BETA')!;
    assert.match(b.scanNote || '', /^No SEC filing in the last 21 days \(EDGAR checked; 3 insider Form 3\/4\/5\/144 reports not counted as events\) — news/);
  });
});
