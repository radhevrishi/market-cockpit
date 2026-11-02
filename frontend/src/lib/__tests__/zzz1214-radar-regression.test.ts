// zzz1214 — Transformation Radar regression scenarios (the owner's 25-scenario list, built from real filings of Nov 2026).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTranscript, speakerOf, documentTone, tierFromTone } from '../radar-speakers';
import { radarInsight, resultsVerdict, guidanceVerdict, valuationGap, orderValueCr, materialityOf, type RadarFacts } from '../radar-insight';
import { preClassifyRadarFiling, classifyRadarContent } from '../radar-doc-class';
import { assessRadarQuote, radarDecision } from '../concall-radar-decision';
import { buildRadarEvidenceRecord } from '../concall-evidence-ledger';
import { bseProxyUrl } from '../nse-bse-feed';

const NSE = 'https://nsearchives.nseindia.com/corporate/';
const CC = 'Analysts/Institutional Investor Meet/Con. Call Updates — ';
const MGMT_BODY = 'We delivered record revenue this quarter and margins expanded strongly on better mix. Our new plant was commissioned and is ramping up well. ';
const TRANSCRIPT = [
  'Earnings Conference Call MANAGEMENT: MR. AMIT SHAH – MANAGING DIRECTOR MR. RAVI MEHTA – CFO MODERATOR: MS. NEHA – XYZ CAPITAL Page 1',
  'Moderator: Ladies and gentlemen, good day and welcome to the Q2 FY27 earnings conference call. I now hand the conference over to Mr. Amit Shah.',
  `Amit Shah: Thank you. ${MGMT_BODY.repeat(12)}`,
  'Moderator: The first question is from the line of Priya Nair from ABC Securities.',
  'Priya Nair: Sir, you mentioned that commercial production of the new product is sometime in FY28, if I got it right? Could you share the timeline?',
  `Ravi Mehta: Yes. ${'EBITDA margin improved to 18.5% from 14.2% and free cash flow was positive at Rs 120 crore. '.repeat(10)}`,
  'Moderator: The next question is from the line of Karan Rao from DEF Capital.',
  'Karan Rao: What is the order book now? And can you comment on pricing?',
  `Amit Shah: ${'The order book stands at Rs 2,400 crore with healthy demand from new customers added this year. '.repeat(10)}`,
  'Moderator: Thank you. That concludes the question-and-answer session.',
].join(' ');

const goodEntry = {
  patterns: [{ key: 'capacity' }, { key: 'customer' }, { key: 'mix' }],
  evidence_score: 9, evidence_breadth: 4, evidence_label: 'Margin improvement realised',
  caution_level: 0, caution_flags: [], tone: 'POSITIVE', bullish_tier: 'BULLISH', quote_role: 'MANAGEMENT', quote_quality: 'USABLE',
};
const goodFacts: RadarFacts = { revQ: 32, revTTM: 18, epsQ: 55, epsTTM: 40, pe: 30, perf6M: 12, perf1Y: 40, guidance: { revision: 'RAISED', display: 'revenue +25% FY27', period: 'FY27', atRisk: false } };

// ── who said it ────────────────────────────────────────────────────────────
test('01 transcript speakers: listed management, moderator-introduced analysts, moderator', () => {
  const p = parseTranscript(TRANSCRIPT);
  assert.equal(p.ok, true);
  assert.equal(p.roles['Amit Shah'], 'MANAGEMENT');
  assert.equal(p.roles['Ravi Mehta'], 'MANAGEMENT');
  assert.equal(p.roles['Priya Nair'], 'ANALYST');
  assert.equal(p.roles['Karan Rao'], 'ANALYST');
  assert.equal(p.roles['Moderator'], 'MODERATOR');
});
test('02 analyst questions are not in the scored management text (UNIMECH case)', () => {
  const p = parseTranscript(TRANSCRIPT);
  assert.doesNotMatch(p.managementText, /if I got it right/);
  assert.match(p.managementText, /order book stands at Rs 2,400 crore/);
});
test('03 a quote is attributed to the turn that contains it', () => {
  const p = parseTranscript(TRANSCRIPT);
  assert.equal(speakerOf('you mentioned that commercial production of the new product is sometime in FY28', TRANSCRIPT, p).role, 'ANALYST');
  assert.deepEqual(speakerOf('EBITDA margin improved to 18.5% from 14.2%', TRANSCRIPT, p), { role: 'MANAGEMENT', speaker: 'Ravi Mehta' });
});
test('04 a document without speaker turns is not treated as a parsed transcript', () => {
  assert.equal(parseTranscript('Investor presentation. Revenue grew 20%. EBITDA margin 18%.').ok, false);
});
test('05 an analyst quote is never proof in the evidence ledger', () => {
  const r = buildRadarEvidenceRecord({ symbol: 'X', source_url: 's', attachment_url: null, filing_datetime: '2026-11-01', evidence_quote: 'We reported EBITDA margin expanded by 300 basis points in Q2 FY27 on a better mix of products.', scored_from: 'PDF', attribution: 'ANALYST' });
  assert.equal(r.verification, 'REJECTED');
  assert.ok(r.missing.includes('Quote is from an analyst, not management'));
});
test('06 a management quote with a period is attributed; a company document says so', () => {
  const q = 'We reported EBITDA margin expanded by 300 basis points in Q2 FY27 on a better mix of products.';
  assert.equal(buildRadarEvidenceRecord({ symbol: 'X', source_url: 's', attachment_url: null, filing_datetime: 'd', evidence_quote: q, scored_from: 'PDF', attribution: 'MANAGEMENT', speaker: 'Ravi Mehta' }).verification, 'ATTRIBUTED');
  assert.equal(buildRadarEvidenceRecord({ symbol: 'X', source_url: 's', attachment_url: null, filing_datetime: 'd', evidence_quote: q, scored_from: 'PDF', attribution: 'COMPANY_DOCUMENT' }).attribution, 'COMPANY_DOCUMENT');
});

// ── quote quality ──────────────────────────────────────────────────────────
test('07 a slide table pasted into one line is not a usable quote', () => {
  assert.equal(assessRadarQuote('QoQ 89.0% YoY Rs 2.5 Cr 100.8% QoQ 434.6 % YoY 22.9 % (Gross Margin improved from 17.7% in Q1FY27 and 14.0% in Q2FY26)').quality, 'BROKEN');
});
test('08 an excerpt cut mid-sentence is not a usable quote', () => {
  assert.equal(assessRadarQuote('years from June 2026 Noumed OTC renewals over 7.5 years plus a 3-year option and margin expansion ahead').quality, 'BROKEN');
});
test('09 a clean management sentence stays usable', () => {
  assert.equal(assessRadarQuote('During the quarter, we successfully commenced commercial production of Vacuum Salt at our new plant.').quality, 'USABLE');
});

// ── tone ───────────────────────────────────────────────────────────────────
test('10 tone is read from the document when the feed has none', () => {
  assert.equal(documentTone(parseTranscript(TRANSCRIPT).managementText).tone, 'POSITIVE');
  assert.equal(documentTone('Demand remained weak and margins were under pressure. We saw a decline in volumes and a slowdown in exports; the outlook is challenging with headwinds.').tone, 'NEGATIVE');
  assert.equal(tierFromTone('POSITIVE'), 'BULLISH');
});
test('11 a document-derived positive tone lets a well-evidenced name reach Underwrite (was always DATA PENDING → 0)', () => {
  const d = radarDecision({ bullish_tier: tierFromTone('POSITIVE'), scored_from: 'PDF', caution_level: 0, evidence_score: 9, evidence_breadth: 4,
    evidence_quote: 'EBITDA margin improved to 18.5% from 14.2% as utilisation on the new line ramped up during the quarter.',
    patterns: [{ key: 'capacity' }, { key: 'customer' }], triple: { financial: true, count: 3 } });
  assert.equal(d.queue, 'RESEARCH');
});

// ── cross-period checks ────────────────────────────────────────────────────
test('12 results: latest quarter faster than the year is a snapshot, not "speeding up"', () => {
  const r = resultsVerdict({ revQ: 32, revTTM: 18, epsQ: 55 });
  assert.equal(r.verdict, 'STRONGER_LATEST');
  assert.match(r.text, /snapshot, not yet a sustained trend/);
  assert.doesNotMatch(r.text, /speeding up/i);
});
test('13 results: fall in sales and profit = declining; fading quarter = slowing', () => {
  assert.equal(resultsVerdict({ revQ: -8, epsQ: -20 }).verdict, 'DECLINING');
  assert.equal(resultsVerdict({ revQ: 4, revTTM: 25, epsQ: 5 }).verdict, 'SLOWING');
  assert.equal(resultsVerdict({}).verdict, 'UNKNOWN');
});
test('14 guidance across filings: raised / lowered / none', () => {
  assert.equal(guidanceVerdict({ guidance: { revision: 'RAISED', display: 'x', period: 'FY27', atRisk: false } }).verdict, 'RAISED');
  assert.equal(guidanceVerdict({ guidance: { revision: 'LOWERED', display: 'x', period: null, atRisk: false } }).verdict, 'LOWERED');
  assert.equal(guidanceVerdict({}).verdict, 'NONE');
});

// ── valuation / expectations gap ───────────────────────────────────────────
test('15 valuation: a low P/E and a falling price are context, never "not priced in" (REFEX)', () => {
  const v = valuationGap({ pe: 11, epsTTM: 26, perf6M: -16, perf1Y: -40 });
  assert.equal(v.gap, 'NOT_UNDERWRITTEN');
  assert.match(v.text, /Valuation not underwritten/);
  assert.doesNotMatch(v.text, /not priced in|not caught up/i);
});
test('16 valuation: trailing P/E 120 or a 3x run = expensive; loss-making = unknown', () => {
  assert.equal(valuationGap({ pe: 120, epsTTM: 30 }).gap, 'STRETCHED');
  assert.equal(valuationGap({ pe: 25, epsTTM: 30, perf1Y: 210 }).gap, 'STRETCHED');
  assert.equal(valuationGap({ pe: -5 }).gap, 'UNKNOWN');
});

// ── lanes and "best" ───────────────────────────────────────────────────────
test('17 lane: realised proof + growing results = earnings inflection, and best', () => {
  const i = radarInsight(goodEntry, goodFacts);
  assert.equal(i.lane, 'INFLECTION');
  assert.equal(i.best, true);
  assert.ok(i.bestScore >= 80);
});
test('18 lane: milestones but numbers not showing = early transformation', () => {
  const i = radarInsight({ ...goodEntry, evidence_score: 6, evidence_label: 'Customer qualification' }, { ...goodFacts, revQ: 3, epsQ: 2, revTTM: 4 });
  assert.equal(i.lane, 'EARLY');
});
test('19 lane: one keyword family = no clear transformation', () => {
  assert.equal(radarInsight({ ...goodEntry, patterns: [{ key: 'export' }], evidence_score: 0 }, goodFacts).lane, 'NONE');
});
test('20 a guidance cut blocks the lane and "best"', () => {
  const i = radarInsight(goodEntry, { ...goodFacts, guidance: { revision: 'LOWERED', display: 'x', period: 'FY27', atRisk: false } });
  assert.equal(i.lane, 'NONE');
  assert.equal(i.best, false);
});
test('21 an analyst-question proof can never be "best"', () => {
  const i = radarInsight({ ...goodEntry, quote_role: 'ANALYST' }, goodFacts);
  assert.equal(i.best, false);
  assert.ok(i.blockers.includes('proof is an analyst question'));
});
test('22 an inflection that is expensive on trailing figures is not "best"', () => {
  assert.equal(radarInsight(goodEntry, { ...goodFacts, pe: 150 }).best, false);
});

// ── documents and feeds ────────────────────────────────────────────────────
test('23 notices are never read; transcripts and decks are', () => {
  assert.equal(preClassifyRadarFiling({ subject: `${CC}X about Schedule of meet`, attachment_urls: [`${NSE}X_Intimation.pdf`] }).cls, 'MEETING_SCHEDULE');
  assert.equal(preClassifyRadarFiling({ subject: `${CC}X about Link of Recording`, attachment_urls: [`${NSE}X_Audio.pdf`] }).cls, 'RECORDING_LINK');
  assert.equal(preClassifyRadarFiling({ subject: 'Investor Presentation — X', attachment_urls: [`${NSE}X_InvestorPPT.pdf`] }).cls, 'PRESENTATION');
});
test('24 a "Transcript" filing that is only a website link is not scored', () => {
  const v = classifyRadarContent(preClassifyRadarFiling({ subject: `${CC}X about Transcript`, attachment_urls: [`${NSE}X_Transcript.pdf`] }),
    { text: 'To the Listing Department, National Stock Exchange of India Limited, Exchange Plaza. Dear Sir, the transcript of the investors call has been uploaded on the Company website at https://example.com/investors. Kindly take the same on record. '.repeat(2), pages: 1 });
  assert.equal(v.cls, 'TRANSCRIPT_LINK_ONLY');
  assert.equal(v.analyzable, false);
});
test('25 BSE API goes through the gated relay with the secret in a header, never in the URL', () => {
  const env = process.env as Record<string, string | undefined>;
  const before = { u: env.PROXY_URL, s: env.PROXY_SECRET };
  env.PROXY_URL = 'https://relay.example.workers.dev/'; env.PROXY_SECRET = 'not-a-real-secret';
  try {
    const u = bseProxyUrl('https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=1');
    assert.match(String(u), /^https:\/\/relay\.example\.workers\.dev\/proxy\?url=/);
    assert.doesNotMatch(String(u), /secret/);
  } finally { env.PROXY_URL = before.u; env.PROXY_SECRET = before.s; }
  const src = readFileSync(new URL('../nse-bse-feed.ts', import.meta.url), 'utf8');
  assert.match(src, /'x-proxy-secret': process\.env\.PROXY_SECRET/);
});

// zzz1215/1216 — owner + outside review of the live radar
test('26 PANACHE: a +423% EPS quarter is flagged as a possible low base, not a trend', () => {
  const r = resultsVerdict({ revQ: 232, revTTM: 137, epsQ: 423 });
  assert.equal(r.lowBase, true);
  assert.match(r.text, /low-base effect/);
  assert.ok(radarInsight(goodEntry, { ...goodFacts, revQ: 232, revTTM: 137, epsQ: 423 }).blockers.includes('possible low-base effect'));
});
test('27 an unresolved contradiction blocks "best" and gives "promising — reconcile first" instead', () => {
  const i = radarInsight({ ...goodEntry, review_queue: 'RECONCILE' }, goodFacts);
  assert.equal(i.best, false);
  assert.equal(i.promising, true);
  assert.ok(i.blockers.includes('contradiction in the document not reconciled'));
  assert.equal(radarInsight({ ...goodEntry, review_queue: 'WAIT' }, goodFacts).best, true);
});
test('28 earnings inflection needs a clean management quote; transformation, growth and the causal link are separate facts', () => {
  const i = radarInsight({ ...goodEntry, quote_role: 'UNKNOWN' }, goodFacts);
  assert.notEqual(i.lane, 'INFLECTION');
  const ok = radarInsight(goodEntry, goodFacts);
  assert.equal(ok.lane, 'INFLECTION');
  assert.deepEqual(ok.checks, { transformation: true, growth: true, causalLink: false });
  assert.match(ok.headline, /not proven/);
});
test('29 PARACABLES: an order book is sized against sales and called orders, not revenue', () => {
  const o = orderValueCr('We have already secured an HTLS order book of INR 200 crores plus as on date and the capacity augmentation is planned.');
  assert.equal(o, 200);
  const m = materialityOf({ order_value_cr: o }, { salesCr: 1600 });
  assert.equal(m.pctOfSales, 13);
  assert.match(m.text, /Orders, not yet revenue/);
  assert.match(materialityOf({}, {}).text, /Materiality unverified/);
  assert.equal(orderValueCr('a healthy enquiry pipeline of ₹19,464 crore'), null);
});
test('30 PRUDENT: routine operating leverage with modest growth is not "latest quarter stronger"', () => {
  const r = resultsVerdict({ revQ: 22, revTTM: 22, epsQ: 34 });
  assert.equal(r.verdict, 'GROWING');
});
test('31 a best card shows open questions as checks; the universe read gets time to build', () => {
  const src = readFileSync(new URL('../../app/(dashboard)/concall-intel/radar-card.tsx', import.meta.url), 'utf8');
  assert.match(src, /Promising — reconcile first/);
  assert.match(src, /link between the two not proven/);
  const route = readFileSync(new URL('../../app/api/v1/concall-intel/transformation-screener/route.ts', import.meta.url), 'utf8');
  assert.match(route, /25_000\),/);
  assert.match(route, /review_queue: radarDecision\(e\)\.queue/);
});
