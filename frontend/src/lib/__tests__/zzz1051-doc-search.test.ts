// zzz1051 — document search: chunker, fusion, filters, the in-process (no pgvector) meaning path, spend ceilings, eval metrics.
// All inputs below are SYNTHETIC fixtures written for these tests (no real company text).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chunkDocument, speakerOf, overlapTail, quarterLabel, MAX_WORDS, OVERLAP_WORDS } from '../doc-search/chunker';
import {
  rrfFuse, cosine, encodeVector, decodeVector, vectorLiteral, rankByCosine, parseFilters, filterSql, matchesFilters, queryTerms,
  orQueryText, highlightStems, bestWindow, capFromEnv, capAllows, embedUsd, estimateTokens, shouldReindex, canonTicker,
} from '../doc-search/rank';
import { recallAtK, reciprocalRank, precisionAtK, evalQuery, summarise, validLabels, compileLabel } from '../doc-search/eval';
import { applyScores } from '../doc-search/rerank';
import { costOf, pricingFor } from '../anthropic-meter';

const words = (n: number, w = 'alpha') => Array.from({ length: n }, (_, i) => `${w}${i % 7}`).join(' ');
const sentencesOf = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `The ${tag} business grew in period ${i} and margins held steady.`).join(' ');

// ── chunker ──────────────────────────────────────────────────────────────────

test('chunker: a long paragraph is cut at sentence ends, ≤ MAX words (+ overlap), with the last sentence carried over', () => {
  const text = sentencesOf(150, 'pump');   // ~1,500 words, one paragraph
  const ch = chunkDocument(text);
  assert.ok(ch.length >= 3, `got ${ch.length}`);
  for (const c of ch) assert.ok(c.words <= MAX_WORDS + OVERLAP_WORDS, `chunk ${c.seq} has ${c.words} words`);
  for (const c of ch) assert.ok(/[.!?]\s*$/.test(c.text.trim()), 'ends on a sentence end');
  const second = ch[1];
  assert.ok(second.overlapWords > 0 && second.overlapWords <= OVERLAP_WORDS, 'size cut carries an overlap');
  const tail = overlapTail(ch[0].text);
  assert.ok(second.text.startsWith(tail), 'overlap = the last sentence(s) of the previous passage');
  // nothing lost: every sentence appears somewhere
  for (let i = 0; i < 150; i += 17) assert.ok(ch.some((c) => c.text.includes(`period ${i} and`)), `sentence ${i}`);
  assert.deepEqual(ch.map((c) => c.seq), ch.map((_, i) => i));
});

test('chunker: transcript turns — a new speaker closes a long-enough passage; the speaker is kept', () => {
  const text = [
    'Moderator: Good morning and welcome to the earnings call.',
    `Ravi Kumar – Chief Financial Officer: ${sentencesOf(36, 'cable')}`,
    `Anita Shah: ${sentencesOf(5, 'question')} What is the utilisation level?`,
    `Ravi Kumar – Chief Financial Officer: ${sentencesOf(34, 'utilisation')}`,
  ].join('\n');
  const ch = chunkDocument(text);
  assert.ok(ch.length >= 2);
  assert.equal(ch[0].speaker, 'Ravi Kumar');
  const ans = ch.find((c) => c.text.includes('utilisation business'))!;
  assert.equal(ans.speaker, 'Ravi Kumar');
  assert.ok(ans.text.includes('Anita Shah:') || ch.some((c) => c.text.startsWith('Anita Shah:')), 'turn boundary respected');
  assert.equal(ch.filter((c) => c.text.includes('Moderator: Good morning')).length, 1);
});

test('speakerOf: names with titles count, table rows / labels do not', () => {
  assert.equal(speakerOf('Moderator: Thank you.'), 'Moderator');
  assert.equal(speakerOf('Mr. R. Kumar - Managing Director: We expect growth.'), 'Mr. R. Kumar');
  assert.equal(speakerOf('Revenue: 1,200 crore'), null);
  assert.equal(speakerOf('Q1 FY27: strong quarter'), null);
  assert.equal(speakerOf('Note: figures are audited'), null);
});

test('chunker: stored-excerpt breaks are hard (no overlap across); headings become the section; pages are tracked', () => {
  const text = `OUTLOOK AND GUIDANCE\n${sentencesOf(40, 'outlook')}\n[…]\n${sentencesOf(40, 'segment')}`;
  const ch = chunkDocument(text);
  const seg = ch.find((c) => c.text.includes('segment business grew in period 0'))!;
  assert.equal(seg.overlapWords, 0, 'no overlap across an excerpt break');
  assert.ok(!seg.text.includes('outlook business'), 'the excerpt after the break starts clean');
  assert.equal(ch[0].section, 'OUTLOOK AND GUIDANCE');
  const paged = chunkDocument(`${sentencesOf(10, 'p1')}\f${sentencesOf(10, 'p2')}\fPage 7\n${sentencesOf(50, 'p7')}`);
  assert.equal(paged[0].page, 1);
  assert.ok(paged.some((c) => c.page === 7));
});

test('chunker: a short tail joins the previous passage; empty text gives nothing', () => {
  const ch = chunkDocument(`${sentencesOf(45, 'main')}\n\nA short closing remark here.`);
  assert.ok(ch[ch.length - 1].text.includes('short closing remark'));
  assert.ok(ch.every((c) => c.words >= 8));
  assert.deepEqual(chunkDocument(''), []);
  assert.equal(chunkDocument(words(1200)).every((c) => c.words <= MAX_WORDS + OVERLAP_WORDS), true, 'no-stop text is cut by words');
});

test('quarterLabel: hint wins; else the quarter that ended before filing (India FY, US calendar)', () => {
  assert.equal(quarterLabel('IN', '2026-08-10', 'Q1 FY27'), 'Q1 FY27');
  assert.equal(quarterLabel('IN', '2026-08-10T00:00:00Z'), 'Q1 FY27');
  assert.equal(quarterLabel('IN', '2026-05-20'), 'Q4 FY26');
  assert.equal(quarterLabel('IN', '2026-02-05'), 'Q3 FY26');
  assert.equal(quarterLabel('US', '2026-07-28'), 'Q2 2026');
  assert.equal(quarterLabel('US', '2026-01-30'), 'Q4 2025');
  assert.equal(quarterLabel('US', null), null);
});

// ── fusion ───────────────────────────────────────────────────────────────────

test('RRF: score = Σ 1/(60+rank); both-lists beats one list; matched says which', () => {
  const f = rrfFuse([10, 20, 30], [30, 40]);
  const by = new Map(f.map((x) => [x.id, x]));
  assert.ok(Math.abs(by.get(10)!.score - 1 / 61) < 1e-12);
  assert.ok(Math.abs(by.get(30)!.score - (1 / 63 + 1 / 61)) < 1e-12);
  assert.equal(f[0].id, 30);
  assert.equal(by.get(30)!.matched, 'both');
  assert.equal(by.get(40)!.matched, 'meaning');
  assert.equal(by.get(20)!.matched, 'keyword');
  assert.equal(by.get(40)!.keywordRank, null);
  // equal scores: the keyword-ranked passage comes first
  const t = rrfFuse([1], [2]);
  assert.deepEqual(t.map((x) => x.id), [1, 2]);
  // duplicates in a list count once
  assert.equal(rrfFuse([5, 5], []).length, 1);
});

// ── in-process meaning path (no pgvector) ─────────────────────────────────────

test('fallback vectors: float32 bytes round-trip, cosine ranking, filters by dimension and floor', () => {
  const v = [0.5, -0.25, 0.125, 1];
  const back = decodeVector(encodeVector(v))!;
  assert.deepEqual(Array.from(back), v);
  assert.equal(decodeVector(Buffer.alloc(3)), null);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-12);
  assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([0, 0], [1, 1]), 0);
  const q = [1, 0, 0];
  const r = rankByCosine(q, [
    { id: 1, vec: decodeVector(encodeVector([0.9, 0.1, 0])) },
    { id: 2, vec: [0, 1, 0] },              // orthogonal → below the floor
    { id: 3, vec: [0.6, 0.6, 0] },
    { id: 4, vec: [1, 0] },                 // wrong dimension → ignored
    { id: 5, vec: null },
  ], 10);
  assert.deepEqual(r.map((x) => x.id), [1, 3]);
  assert.equal(vectorLiteral([0.1, 2, NaN]), '[0.1,2,0]');
});

// ── filters ──────────────────────────────────────────────────────────────────

test('filters: parsed strictly, always SQL parameters, same rule in process', () => {
  const f = parseFilters(new URLSearchParams('market=IN&from=2026-07-01&to=bad&kinds=TRANSCRIPT,nope,PRESENTATION&tickers=nse:kaynes, ;DROP TABLE x,AXON.NS&quarter=q1 fy27'));
  assert.deepEqual(f, { market: 'IN', from: '2026-07-01', kinds: ['TRANSCRIPT', 'PRESENTATION'], tickers: ['KAYNES', 'AXON'], quarter: 'Q1 FY27' });
  const s = filterSql(f, 2);
  assert.deepEqual(s.where, ['c.market = $2', 'c.filed_at >= $3::date', 'c.kind = ANY($4::text[])', 'c.ticker = ANY($5::text[])', 'c.quarter = $6']);
  assert.deepEqual(s.params, ['IN', '2026-07-01', ['TRANSCRIPT', 'PRESENTATION'], ['KAYNES', 'AXON'], 'Q1 FY27']);
  assert.ok(!s.where.join(' ').includes('KAYNES'), 'values never inlined');
  const row = { market: 'IN', filed_at: '2026-08-12', kind: 'TRANSCRIPT', ticker: 'KAYNES', quarter: 'Q1 FY27' };
  assert.equal(matchesFilters(row, f), true);
  assert.equal(matchesFilters({ ...row, market: 'US' }, f), false);
  assert.equal(matchesFilters({ ...row, filed_at: '2026-06-30' }, f), false);
  assert.equal(matchesFilters({ ...row, kind: 'RESULTS_RELEASE' }, f), false);
  assert.equal(matchesFilters({ ...row, ticker: 'OTHER' }, f), false);
  assert.deepEqual(parseFilters(new URLSearchParams('market=EU')), {});
  assert.equal(canonTicker('BSE:500325'), '500325');
});

test('query words: filler removed, loose OR form, highlight stems, best window', () => {
  assert.deepEqual(queryTerms('Who guided margin expansion this quarter?'), ['margin', 'expansion']);
  assert.deepEqual(queryTerms('companies talking about capacity utilisation above 80%'), ['capacity', 'utilisation', '80%']);
  assert.equal(orQueryText('order book growth defence'), 'order or book or growth or defence');
  assert.equal(orQueryText('margin'), '');
  assert.deepEqual(highlightStems('margin expansion'), ['margin', 'expan']);
  const body = `${'filler words here. '.repeat(80)}We expect margin expansion of 200 bps. ${'more filler. '.repeat(80)}`;
  const w = bestWindow(body, ['margin', 'expan'], 300);
  assert.ok(w.includes('margin expansion') && w.length <= 310 && w.startsWith('…'));
  assert.equal(bestWindow('short', ['x']), 'short');
});

// ── ceilings ─────────────────────────────────────────────────────────────────

test('daily ceilings: env parsing, a call that would cross the ceiling is refused, $0 switches it off', () => {
  assert.equal(capFromEnv(undefined, 0.1), 0.1);
  assert.equal(capFromEnv('', 0.1), 0.1);
  assert.equal(capFromEnv('0.5', 0.1), 0.5);
  assert.equal(capFromEnv('0', 0.1), 0);
  assert.equal(capFromEnv('-3', 0.1), 0.1);
  assert.equal(capFromEnv('abc', 0.1), 0.1);
  assert.equal(capAllows(0.05, 0.1, 0.01).allowed, true);
  assert.equal(capAllows(0.095, 0.1, 0.01).allowed, false, 'would cross the ceiling');
  assert.equal(capAllows(0.1, 0.1, 0).allowed, false, 'at the ceiling nothing more, even a free-looking call');
  assert.match(capAllows(0, 0, 0.001).reason!, /switched off/);
  // embedding price: text-embedding-3-small $0.02 per million tokens, and the meter prices it the same
  assert.ok(Math.abs(embedUsd(1_000_000) - 0.02) < 1e-12);
  assert.equal(estimateTokens(['abcd', 'abcdefgh']), 3);
  assert.ok(pricingFor('text-embedding-3-small'));
  assert.ok(Math.abs(costOf('text-embedding-3-small', { input_tokens: 500_000 }) - 0.01) < 1e-12);
  // the default ceilings are small and set where the owner can see them
  const src = readFileSync(join(__dirname, '../doc-search/store.ts'), 'utf8');
  assert.match(src, /SEARCH_EMBED_DAILY_USD, 0\.10\)/);
  assert.match(src, /SEARCH_RERANK_DAILY_USD, 0\.05\)/);
});

test('reindex rule: same text skipped, a poorer copy never replaces a richer one', () => {
  assert.equal(shouldReindex(null, { level: 'passages', hash: 'a' }), true);
  assert.equal(shouldReindex({ level: 'full', hash: 'a' }, { level: 'full', hash: 'a' }), false);
  assert.equal(shouldReindex({ level: 'full', hash: 'a' }, { level: 'passages', hash: 'b' }), false);
  assert.equal(shouldReindex({ level: 'passages', hash: 'a' }, { level: 'full', hash: 'b' }), true);
  assert.equal(shouldReindex({ level: 'none', hash: 'a' }, { level: 'quotes', hash: 'b' }), true);
  assert.equal(shouldReindex({ level: 'full', hash: 'a' }, { level: 'full', hash: 'b' }), true, 'a corrected full text replaces');
});

// ── reranker answer ──────────────────────────────────────────────────────────

test('rerank: scores applied with ties in fused order; junk or half-empty answers are rejected', () => {
  const hits = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  const r = applyScores(hits, { scores: [{ i: 0, score: 1 }, { i: 1, score: 3 }, { i: 2, score: 3 }, { i: 3, score: 0 }, { i: 9, score: 3 }, { i: 1, score: 0 }] })!;
  assert.deepEqual(r.map((x) => x.id), [2, 3, 1, 4]);
  assert.equal(r[0].rerankScore, 3);
  assert.equal(applyScores(hits, { scores: [{ i: 0, score: 5 }] }), null);
  assert.equal(applyScores(hits, null), null);
  // the reranker fences passages and never calls the model without the ceiling check
  const src = readFileSync(join(__dirname, '../doc-search/rerank.ts'), 'utf8');
  assert.match(src, /fenceDoc\(/);
  assert.ok(src.indexOf('capAllows(') < src.indexOf('anthropicMessages(\'doc-search-rerank\''));
});

// ── eval ─────────────────────────────────────────────────────────────────────

test('eval metrics: recall@10, MRR, precision@10 on a pooled relevant set', () => {
  const rel = new Set([3, 7, 50]);
  assert.ok(Math.abs(recallAtK([1, 3, 7, 9], rel, 10) - 2 / 3) < 1e-12);
  assert.equal(reciprocalRank([1, 9, 7], rel), 1 / 3);
  assert.equal(reciprocalRank([1, 2], rel), 0);
  assert.equal(precisionAtK([3, 1], rel, 10), 0.5);
  assert.equal(recallAtK([1], new Set(), 10), 0);

  // synthetic passages: relevance by phrase (and ticker when given)
  const P = (id: number, ticker: string, text: string) => ({ id, ticker, text });
  const label = { q: 'margin expansion', phrases: ['margin (?:expansion|improvement)', 'expand(?:ing)? (?:our )?margins?'] };
  const kw = [P(1, 'AAA', 'We see margin expansion ahead.'), P(2, 'BBB', 'Revenue grew.'), P(3, 'CCC', 'Margins flat.')];
  const hy = [P(4, 'DDD', 'We are expanding our margins.'), P(1, 'AAA', 'We see margin expansion ahead.'), P(2, 'BBB', 'Revenue grew.')];
  const qe = evalQuery(label, [{ mode: 'keyword', ranked: kw }, { mode: 'hybrid', ranked: hy }]);
  assert.equal(qe.pooledRelevant, 2);
  assert.equal(qe.byMode.keyword.recall10, 0.5);
  assert.equal(qe.byMode.hybrid.recall10, 1);
  assert.equal(qe.byMode.keyword.mrr, 1);
  assert.equal(qe.byMode.hybrid.mrr, 1);
  const none = evalQuery({ q: 'x', phrases: ['zzz'] }, [{ mode: 'keyword', ranked: kw }]);
  const s = summarise([qe, none]);
  assert.equal(s.judged, 1, 'a query nobody can answer is not judged');
  assert.equal(s.byMode.hybrid.recall10, 1);
  assert.equal(s.byMode.keyword.recall10, 0.5);
  // tickers restrict relevance
  const onlyA = compileLabel({ q: 'm', phrases: ['margin'], tickers: ['AAA'] });
  assert.equal(onlyA(P(1, 'AAA', 'margin up')), true);
  assert.equal(onlyA(P(9, 'ZZZ', 'margin up')), false);
});

test('eval labels: the shipped file is valid and every phrase compiles; bad entries are dropped', () => {
  const raw = JSON.parse(readFileSync(join(__dirname, '../doc-search/eval-labels.json'), 'utf8'));
  const labels = validLabels(raw);
  assert.ok(labels.length >= 15 && labels.length <= 20, `${labels.length} labels`);
  for (const l of labels) for (const p of l.phrases) assert.doesNotThrow(() => new RegExp(p, 'i'), `${l.q}: ${p}`);
  assert.match(String(raw._about), /DRAFT/);
  assert.deepEqual(validLabels([{ q: '', phrases: ['a'] }, { q: 'ok', phrases: [] }, { q: 'fine', phrases: ['x'], tickers: ['A B'] }]), [{ q: 'fine', phrases: ['x'] }]);
});

// ── wiring ───────────────────────────────────────────────────────────────────

test('wiring: protected route, hourly app job, ingest hook after the store, page has no named exports', () => {
  const root = join(__dirname, '..', '..');
  const auth = readFileSync(join(root, 'lib/site-auth.ts'), 'utf8');
  assert.match(auth, /'\/api\/v1\/search',/);
  const route = readFileSync(join(root, 'app/api/v1/search/route.ts'), 'utf8');
  assert.match(route, /siteAuthOk\(req\)/);
  const sched = readFileSync(join(root, 'lib/app-scheduler.ts'), 'utf8');
  assert.match(sched, /name: 'doc-search-index', crons: \['33 \* \* \* \*'\]/);
  const ingest = readFileSync(join(root, 'app/api/v1/guidance-docs/ingest/route.ts'), 'utf8');
  assert.ok(ingest.indexOf('await ingestDocs(') < ingest.indexOf('indexFromIngest('), 'indexing runs only after the store succeeded');
  const page = readFileSync(join(root, 'app/(dashboard)/search-docs/page.tsx'), 'utf8');
  assert.equal((page.match(/^export (?!default)/gm) || []).length, 0);
  const nav = readFileSync(join(root, 'app/(dashboard)/DashboardClient.tsx'), 'utf8');
  assert.match(nav, /href: '\/search-docs',\s+label: 'Document search'/);
});
