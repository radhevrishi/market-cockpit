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
import { parseCompanyDocs, pickDocument } from '../earnings/screener-documents';
import { quoteIsInDocument, normaliseForQuoteMatch } from '../ai-gainers/announcement-reader';
import { extractVariables } from '../thesis/variables';
import { assessThesis } from '../thesis/status';
import { classifyGradedRow, classifyWithFiling } from '../earnings/pattern-abfg';
import { sourceTierOf, researchPriority, type GainerEvent } from '../ai-gainers/events';
import {
  symbolsFromStoredValue, mergeUniverse, originCounts, benchPassingPreset,
} from '../thesis/universe';
import {
  candidatesFromFilings, classifyExchangeDoc, rankCandidates, selectForReading,
} from '../thesis/evidence-discovery';
import { findPassages, validateEvents } from '../thesis/evidence-extract';
import { varsFromEvents } from '../thesis/variables';

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
