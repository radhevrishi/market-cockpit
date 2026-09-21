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
import { findPassages, validateEvents } from '../thesis/evidence-extract';
import {
  reportingPeriodFromDate, periodOrdinal, reportingPeriodForDocuments, factsFromEvents, documentId,
  emptyLedger, mergePeriod, recordAttempt, recordSeen, recordStatus, whatChanged, freshnessOf,
  latestSummary, ledgerView, batchProgress, type CompanyLedger,
} from '../thesis/evidence-ledger';
import { varsFromEvents } from '../thesis/variables';
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

  test('a negative cash ratio with an unknown profit sign is UNKNOWN, never a guess', () => {
    const unknown = { ...row('KMEW'), cfo_to_pat_ratio: -21.3, pat_curr_cr: null };
    const v = extractVariables(unknown, null).find((x) => x.key === 'cash_conversion');
    assert.equal(v!.verdict, 'unknown');
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

  test('a target with no actual behind it is a CLAIM with an unknown verdict', () => {
    const vars = varsFromEvents([
      { variable: 'utilisation', value_type: 'TARGET', before: null, after: '90%', unit: '%', period: 'FY28', direction: 'up', confidence: 'HIGH', source: 'Concall', evidence_text: 'We are targeting 90% utilisation by FY28 across the lines.' },
    ] as any);
    assert.equal(vars[0].kind, 'claim');
    assert.equal(vars[0].verdict, 'unknown');
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
