// zzz790 — FINAL production QA of Portfolio Catalysts: the hard-invariant
// checklist, run programmatically.
//
//   A · over the LIVE ledger harness (ledgers_live.json / graded_live.json,
//       every card built by the page's own builders: applyLedger → ThesisCard,
//       detectForRow → specialFocusQueue / nearMissList, universeCounts,
//       exportCounts, evidenceAttention, researchPriority*). Skipped only when
//       the harness export is not on this machine (set PC_LIVE_DIR).
//   B · over NAMED fixtures — the eight QA companies, verbatim from that
//       export (fixtures/zzz790-pc-named.json). The owner's names map to the
//       ledger symbols: MENONBEIN = MENONBE, MINDSPACEIN = MINDSPACE,
//       SFLIN = SFL, SPECTRUMIN = SPECTRUM, ULTRAMARIN = ULTRAMAR.
//
// Run: npx tsx --test src/lib/__tests__/zzz790-pc-final.test.ts
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { applyLedger, assessBookRow } from '../thesis/use-book';
import { migrateLedger, freshnessLine } from '../thesis/evidence-ledger';
import { classifyOrNearest } from '../earnings/pattern-abfg';
import { isSmallMidCap } from '../thesis/universe';
import {
  tallyPartitionSum, PROVISIONAL_BLOCKED, STATUS_META, ONE_OFF_CLAUSE, NEWER_UNREAD_WORD, STALE_EVIDENCE_QUARTERS,
  evidenceFreshnessOf, type ThesisAssessment,
} from '../thesis/status';
import { explicitNoneStated, checkPasses, SILENT_CHECK_WORD } from '../thesis/silent-check';
import {
  universeCounts, exportCounts, evidenceAttention, evidenceCounts, researchPriorityEligible, researchPriorityTitle,
  RESEARCH_EXPORT_STATUSES,
} from '../thesis/evidence-counts';
import { forwardSentence } from '../thesis/fact-normalize';
import { specialFocusQueue, nearMissList, focusButtonWords } from '../catalyst/cross-view';
import { ThesisCard, unclearWords } from '../../components/thesis-card';
import { detectForRow } from '../../components/special-focus-panel';

(globalThis as any).React = React;
const ROOT = join(__dirname, '..', '..', '..');
const FX = join(__dirname, 'fixtures');
const LIVE_DIR = process.env.PC_LIVE_DIR || '/tmp/claude-0/-home-claude/2a0c2ebb-646f-5f80-9739-6dea50423a8e/scratchpad';
const HAVE_LIVE = existsSync(join(LIVE_DIR, 'ledgers_live.json')) && existsSync(join(LIVE_DIR, 'graded_live.json'));

const strip = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');

// ── The page's own row builder ─────────────────────────────────────────────
function buildRow(t: string, raw: any | null, g: any | null, fresh: any | null, origin: 'book' | 'bench' = 'book'): any {
  const row0: any = { symbol: t, origin, market: 'IN', graded: g, tier: g?.tier || null, pattern: g ? classifyOrNearest(g) : null,
    radarScore: null, summary: null, sourceUrl: null, state: 'idle', assessment: null, capex: null, promiseNote: null, dataSource: g ? 'screener.in data' : null };
  return raw ? applyLedger(row0, migrateLedger(raw), fresh) : assessBookRow(row0);
}
function renderCard(r: any): string {
  return strip(renderToStaticMarkup(React.createElement(ThesisCard as any, {
    symbol: r.symbol, market: r.market, tier: r.tier, pattern: r.pattern, radarScore: r.radarScore, assessment: r.assessment, capex: r.capex,
    origin: r.origin, documentsRead: r.documentsRead, discoveryAttempts: r.discoveryAttempts, discoveryState: r.discoveryState,
    documentOutcomes: r.documentOutcomes, needsRead: false, reading: false, onRead() {}, onCheck() {}, onReread() {}, error: r.error,
    ledger: r.ledger, freshness: r.freshness, reportingPeriod: r.reportingPeriod, changed: r.changed, changedFrom: r.changedFrom,
    persisted: r.persisted, readNote: r.readNote, promiseNote: r.promiseNote, dataSource: r.dataSource, defaultOpen: true,
  })));
}

// ═══════════════════════════════════════════════════════════════════════════
// THE CHECKLIST — one function per invariant, each returns the violations.
// ═══════════════════════════════════════════════════════════════════════════
const OUTPUT_KEYS = new Set(['revenue_growth', 'earnings_growth', 'margin', 'operating_leverage', 'leverage', 'net_debt', 'roce']);
const AFFIRMATIVE = new Set(['STRENGTHENING', 'ON_TRACK', 'POSITIVE_EXPECTATION_GAP']);

function cardViolations(r: any, html: string, pcs: any[]): string[] {
  const out: string[] = [];
  const a: ThesisAssessment | null = r.assessment;
  const T = r.symbol;
  if (!a) return out;
  // 1 · PROVISIONAL — a nearest-fit thesis never carries an affirmative or negative verdict.
  if (r.pattern?.fit === 'nearest' && PROVISIONAL_BLOCKED.has(a.status)) out.push(`${T}: provisional thesis reads ${a.status}`);
  // THESIS NOT SET ≠ provisional.
  if (!r.pattern && a.status !== 'THESIS_NOT_SET') out.push(`${T}: no thesis but status ${a.status}`);
  if (r.pattern && a.status === 'THESIS_NOT_SET') out.push(`${T}: thesis set but THESIS_NOT_SET`);
  // 2 · SILENCE — never passes / fails / confirms; the row says so.
  for (const c of a.checked) {
    if (c.silence) {
      if (c.verdict === 'improving' || c.verdict === 'deteriorating') out.push(`${T}: silent ${c.key} judged ${c.verdict}`);
      if (!/Unknown, not negative: the documents reviewed did not disclose this variable\./.test(String(c.evidence))) out.push(`${T}: silent ${c.key} lacks the unknown-not-negative sentence`);
    }
  }
  const passing = a.checked.some((c) => checkPasses(c as any)) || a.checked.some((c) => explicitNoneStated(c.after));
  if (/check passes/.test(html) && !passing) out.push(`${T}: "check passes" rendered with no explicit-absence source`);
  if (/none disclosed · check|not found[^.]{0,40}passes|passes, not a reading/i.test(html)) out.push(`${T}: silence rendered as a pass`);
  // 3 · ONE-OFFS disclosed anywhere on the card are DISCLOSED on the row.
  const oo = a.checked.find((c) => c.key === 'one_offs');
  if (oo && oo.silence) {
    const said = a.checked.some((c) => c.key !== 'one_offs' && [c.after, (c as any).quote].some((t) => String(t ?? '').split(/;\s+|(?<=\.)\s+(?=[A-Z])/).some((cl) => ONE_OFF_CLAUSE.test(cl) && !explicitNoneStated(cl))));
    if (said) out.push(`${T}: one-off stated in the card's text but One-offs row is silent`);
  }
  // 4 · TARGET / GUIDANCE ≠ ACHIEVED.
  const FORWARD_KEYS = new Set(['guidance', 'management_target', 'promise_vs_actual']);
  for (const c of a.checked) {
    // A guidance RAISE is a forward reading (its own group); it is never an achieved mechanism.
    if (FORWARD_KEYS.has(c.key)) {
      if ((a.mechanismEvidence || []).some((d) => d.key === c.key)) out.push(`${T}: forward ${c.key} used as mechanism evidence`);
      continue;
    }
    if ((c.statement === 'TARGET' || c.statement === 'GUIDANCE' || c.kind === 'claim') && c.verdict === 'improving') out.push(`${T}: ${c.key} target/claim counted improving`);
    if ((c.key === 'capacity' || c.key === 'capacity_addition') && c.statement === 'TARGET' && c.after && !forwardSentence(c.after, `${(c as any).quote || ''}`) && /\b(?:is|are)\s+(?:now\s+)?operational\b/i.test(String((c as any).quote || ''))) {
      // An installed figure whose own clause says operational must not be labelled a target.
      out.push(`${T}: installed ${c.key} ${c.after} labelled TARGET`);
    }
  }
  for (const s of a.structuralStates || []) {
    const c = a.checked.find((x) => x.key === s.key);
    if (s.state === 'confirmed' && c && (c.statement === 'TARGET' || c.statement === 'GUIDANCE' || c.statement === 'HISTORICAL')) out.push(`${T}: ${s.key} ${c.statement} counted structural-confirmed`);
  }
  // 5 · LEVEL-ONLY ≠ TREND: an improving filing row states a comparison.
  // Quantitative rows only: a qualitative driver ("better mix") is a stated
  // mechanism, not a level. A quantity is a trend only with a comparison — an
  // earlier figure, a delta, a prior reading, or a move the source states.
  const QUANT = new Set(['utilisation', 'capacity', 'capacity_addition', 'order_book', 'order_intake', 'volume', 'working_capital', 'book_to_bill', 'exports', 'revenue_visibility']);
  const MOVE = /increas|improv|grew|grown|expand|rose|risen|\badded\b|\bfrom\b[^.]{0,60}\bto\b|higher|doubl|tripl|y-?o-?y|year-on-year|q-?o-?q|growth|inducted|up \d/i;
  for (const c of a.checked) {
    if (c.verdict !== 'improving' || c.source !== 'filing' || !QUANT.has(c.key)) continue;
    const cmp = !!(c.before || c.delta || (c as any).reading?.previous || c.comparison?.previous);
    // The row's quote is clipped at 300 chars; the full sentence is the ledger event's.
    const lp = r.ledger?.latest_period ? r.ledger.periods?.[r.ledger.latest_period] : null;
    const full = ((lp?.events || []) as any[]).filter((e) => e.variable === c.key).map((e) => String(e.evidence_text || '')).join(' ');
    if (!cmp && !MOVE.test(`${c.after ?? ''} ${(c as any).quote ?? ''} ${c.evidence ?? ''} ${full}`)) out.push(`${T}: ${c.key} "${c.after}" improving with no comparison (level read as trend)`);
  }
  // 6 · HISTORICAL ≠ CURRENT.
  const ef = a.evidenceFreshness;
  if (!ef) out.push(`${T}: no evidenceFreshness`);
  if (ef && ef.quartersBehind != null && ef.quartersBehind > STALE_EVIDENCE_QUARTERS && AFFIRMATIVE.has(a.status)) out.push(`${T}: stale evidence (${ef.period}) confirms ${a.status}`);
  if (ef && ef.quartersBehind != null && ef.quartersBehind > STALE_EVIDENCE_QUARTERS && a.mechanismCheck.some((m) => m.state === 'confirmed')) out.push(`${T}: stale evidence confirms a mechanism link`);
  for (const c of a.checked) if (c.statement === 'HISTORICAL' && c.verdict === 'improving') out.push(`${T}: historical ${c.key} counted improving`);
  if (r.freshness?.state === 'NEW_EVIDENCE_AVAILABLE' && ef?.state !== 'NEWER_UNREAD') out.push(`${T}: newer document unread but freshness ${ef?.state}`);
  // 7 · OUTPUT ≠ MECHANISM.
  for (const m of a.mechanismCheck) if (m.state === 'confirmed' && /^(revenue growth|earnings growth|operating margin|margin)$/i.test(m.link)) out.push(`${T}: output "${m.link}" confirmed as mechanism`);
  for (const [k] of (a.mechanismEvidence || []).map((d) => [d.key] as const)) if (OUTPUT_KEYS.has(k)) out.push(`${T}: output ${k} in mechanism evidence`);
  if (AFFIRMATIVE.has(a.status) && !(a.mechanismEvidence || []).length) out.push(`${T}: ${a.status} on output alone`);
  // 8 · GROUP COUNTS RECONCILE.
  const tallies: Array<[string, any]> = [['output', a.coverage.output], ['mechanism', a.coverage.mechanism], ['forward', (a.coverage as any).forward], ['structural', a.coverage.structural]];
  for (const [name, t] of tallies) {
    if (!t) continue;
    if (tallyPartitionSum(t) !== t.total) out.push(`${T}: ${name} partition ${tallyPartitionSum(t)} ≠ N ${t.total}`);
    if (t.named?.confirmed && t.named.confirmed.length !== t.confirmed) out.push(`${T}: ${name} confirmed names ≠ count`);
  }
  for (const s of a.structuralStates || []) {
    const c = a.checked.find((x) => x.key === s.key);
    if (s.state === 'confirmed' && c && (c.verdict === 'stated' || c.silence || c.verdict === 'unknown')) out.push(`${T}: structural ${s.key} confirmed from ${c.silence ? 'silence' : c.verdict}`);
  }
  // 9 · CAPEX: never unbuilt AND commissioned; commissioned ≠ earning.
  const cx = r.capex;
  if (cx?.build && cx.earning) {
    if (cx.earning.state === 'NOT_STARTED' && cx.build.anyOperating) out.push(`${T}: capex NOT STARTED while a project is operating`);
    if ((cx.earning.state === 'EARNING' || cx.earning.state === 'PARTIAL') && !cx.earning.revenueContribution) out.push(`${T}: capex ${cx.earning.state} with no revenue attributed`);
  }
  for (const p of cx?.lifecycleProjects || []) {
    const st = (s: string) => p.steps.find((x: any) => x.step === s)?.state;
    if (p.underConstruction && st('COMMISSIONED') === 'actual' && !p.statusConflict) out.push(`${T}: project ${p.name} both under construction and commissioned`);
  }
  for (const d of a.mechanismEvidence || []) {
    if (/^capex status/i.test(d.text) && !/not yet proven earning|revenue contribution not yet disclosed/.test(d.text)) out.push(`${T}: commissioned capex read as earning: ${d.text}`);
  }
  for (const d of a.catalystRank?.drivers || []) if (d.group === 'Capex earning' && d.key !== 'capex_earning') out.push(`${T}: ${d.key} ranked as capex earning`);
  // 10 · HEADROOM ≠ RUNWAY; capacity alone is not persistent demand.
  for (const pc of pcs) {
    if (pc.headroom && !/^Capacity headroom:/.test(pc.headroom)) out.push(`${T}: headroom not labelled as headroom`);
    if (pc.runway.ok && (/^Capacity headroom|^Utilisation \d/.test(pc.runway.text) || !/continuation evidence|contract|order|customer|volume|export|geograph|demand|price|mix|store maturity|network/i.test(pc.runway.text))) out.push(`${T}: headroom / capacity read as runway: ${pc.runway.text}`);
    if (pc.specialFocus && !pc.runway.ok) out.push(`${T}: Special Focus without evidenced runway (${pc.kind})`);
    for (const e of pc.evidence) if (e.cls === 'HARD' && /planned \/ target/.test(e.text)) out.push(`${T}: target as HARD evidence: ${e.text}`);
    for (const h of pc.happened) if (/^Commissioned: capacity added/.test(h) && pc.evidence.some((e: any) => e.cls === 'FORWARD' && h.includes(String(e.after))) && !pc.evidence.some((e: any) => e.cls === 'HARD' && h.includes(String(e.after)))) out.push(`${T}: planned capacity shown commissioned: ${h}`);
  }
  if (/catalyst runway/i.test(html)) out.push(`${T}: "catalyst runway" rendered`);
  // 11 · NO PRICE ANYWHERE.
  if (/\b(target price|stop[- ]loss|CMP|share price|drawdown)\b/i.test(`${a.because} ${a.actionLine}`)) out.push(`${T}: price language in the status`);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// A · LIVE HARNESS
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz790 · A — the live ledger harness, every card', { skip: HAVE_LIVE ? false : `live harness not found at ${LIVE_DIR}` }, () => {
  const live = HAVE_LIVE ? JSON.parse(readFileSync(join(LIVE_DIR, 'ledgers_live.json'), 'utf8')) : { ledgers: {}, freshness: {} };
  const graded = HAVE_LIVE ? JSON.parse(readFileSync(join(LIVE_DIR, 'graded_live.json'), 'utf8')).rows : {};
  const bench: any[] = JSON.parse(readFileSync(join(FX, 'bench-rows.json'), 'utf8'));
  const book = Object.entries<any>(live.ledgers).map(([t, raw]) => {
    const g = graded[t] && graded[t].source !== 'none' ? graded[t] : null;
    return buildRow(t, raw, g, live.freshness?.[t] || null, 'book');
  });
  const benchRows = bench.filter((b) => !live.ledgers[b.ticker]).map((b) => buildRow(b.ticker, null, b, null, 'bench'));
  const all = [...book, ...benchRows];
  // The page's filters, verbatim.
  const sized = all.filter((r) => r.origin !== 'bench' || isSmallMidCap(r.graded));
  const html = new Map(book.map((r) => [r.symbol, renderCard(r)] as const));
  const pcsBy = new Map(sized.map((r) => [r.symbol, detectForRow(r)] as const));

  test('every card passes the invariant checklist', () => {
    const v: string[] = [];
    for (const r of sized) v.push(...cardViolations(r, html.get(r.symbol) || '', pcsBy.get(r.symbol) || []));
    assert.deepEqual(v, [], v.join('\n'));
  });

  test('universe counts reconcile from the arrays (never hardcoded)', () => {
    const uc = universeCounts(all, sized, [...RESEARCH_EXPORT_STATUSES]);
    assert.equal(uc.total - uc.hiddenLargeCap, uc.shown);
    assert.equal(uc.shown, uc.book + uc.bench);
    assert.equal(uc.evaluated + uc.notAssessed, uc.shown);
    assert.equal(uc.notAssessed, 0, 'every shown row is evaluated');
    assert.equal(uc.statusSum, uc.evaluated, 'status buckets sum to evaluated = shown');
    assert.equal(uc.thesisNotSet, sized.filter((r) => !r.pattern).length);
    assert.equal(uc.provisional, sized.filter((r) => r.pattern?.fit === 'nearest').length);
    assert.equal(uc.exportable + uc.exportableUs + uc.excludedN, uc.evaluated);
    assert.match(uc.line, new RegExp(`^${uc.total} total${uc.hiddenLargeCap ? ` − ${uc.hiddenLargeCap} large caps hidden` : ''} = ${uc.shown} shown = ${uc.book} book \\+ ${uc.bench} bench`));
    assert.match(uc.line, /eligible for research export/);
    assert.doesNotMatch(uc.line, /constructive/);
    for (const s of Object.keys(uc.byStatus)) assert.ok(STATUS_META[s as keyof typeof STATUS_META], `status ${s} is in the fixed set`);
  });

  test('research export: factual wording; eligible + excluded = analysed; confirmation-required included and said so', () => {
    const xc = exportCounts(sized, (s) => STATUS_META[s as keyof typeof STATUS_META].label);
    assert.equal(xc.eligible + xc.excludedN, xc.analysed);
    assert.equal(xc.eligible, sized.filter((r) => (RESEARCH_EXPORT_STATUSES as readonly string[]).includes(r.assessment?.status)).length);
    assert.match(xc.line, new RegExp(`${xc.eligible} eligible for research export`));
    assert.match(xc.line, /confirmation required is included/);
    assert.doesNotMatch(xc.line, /constructive/);
    const page = readFileSync(join(ROOT, 'src/app/(dashboard)/portfolio-catalysts/page.tsx'), 'utf8');
    assert.doesNotMatch(page, /in constructive statuses/);
    assert.match(page, /exportCounts\(inSource/);
  });

  test('research priority: eligible statuses only, CONFIRMATION REQUIRED never counted as intact', () => {
    const ranked = sized.filter((r) => r.assessment?.catalystRank && researchPriorityEligible(r.assessment.status));
    for (const r of ranked) assert.ok(['STRENGTHENING', 'ON_TRACK'].includes(r.assessment.status), r.symbol);
    assert.equal(sized.filter((r) => r.assessment?.status === 'CONFIRMATION_REQUIRED' && r.assessment.catalystRank).length, 0);
    for (const r of sized.filter((x) => x.pattern?.fit === 'nearest')) assert.equal(r.assessment.catalystRank, null, `${r.symbol} provisional is not ranked`);
    assert.equal(researchPriorityTitle(ranked.length), `Research priority — ${ranked.length} eligible ${ranked.length === 1 ? 'thesis' : 'theses'} ranked by evidenced catalyst — research allocation only, not a buy list, no price used`);
  });

  test('evidence control: one definition for the header and the button', () => {
    const ec = evidenceCounts(sized);
    const at = evidenceAttention(sized);
    assert.equal(at.unread.length, sized.length - ec.evidence_read, 'unread = shown − evidence read');
    assert.equal(at.total, at.unread.length + at.update.length);
    assert.match(at.line, at.total ? new RegExp(`^${at.total} needs? attention — ${at.unread.length} unread, ${at.update.length} requires? update$`) : /^Evidence up to date \(latest filings on file\)$/);
    assert.ok(at.update.includes('MINDSPACE'), 'MINDSPACE has a newer document unread');
    const page = readFileSync(join(ROOT, 'src/app/(dashboard)/portfolio-catalysts/page.tsx'), 'utf8');
    assert.doesNotMatch(page, /needRead/);
    assert.match(page, /attention\.line/);
  });

  test('Special Focus: headline, visible, near-miss count and both buttons come from the same arrays', () => {
    const liveMap = new Map<string, { pc: any; row: any }>();
    for (const r of sized) for (const pc of pcsBy.get(r.symbol) || []) liveMap.set(pc.id, { pc, row: r });
    const q = specialFocusQueue(liveMap as any, {}, () => null);
    const shown = q.entries.filter((e) => !e.dismissed);
    const nm = nearMissList(liveMap as any, q.entries);
    assert.equal(shown.length, [...liveMap.values()].filter((x) => x.pc.specialFocus).length);
    const w = focusButtonWords(shown.length, nm.near.length);
    assert.equal(w.all, `Show all ${shown.length} Special Focus`);
    assert.match(w.near, new RegExp(`^${nm.near.length} near miss`));
    assert.match(w.near, /\(not in Special Focus\)/);
    for (const x of nm.near) assert.ok(!shown.some((e) => e.pc.ticker === x.pc.ticker), `${x.pc.ticker} near miss also in Special Focus`);
    assert.equal(new Set(nm.near.map((x) => x.pc.ticker)).size, nm.near.length, 'one near-miss line per company');
    for (const e of shown) assert.ok(e.pc.runway.ok, `${e.pc.ticker} in Special Focus without runway`);
    const panel = readFileSync(join(ROOT, 'src/components/special-focus-panel.tsx'), 'utf8');
    assert.match(panel, /showing top \$\{visible\.length\}/);
  });

  test('no rendered card says a silent check passes, "catalyst runway" or prices', () => {
    for (const [t, h] of html) {
      assert.doesNotMatch(h, /none disclosed · check passes|passes, not a reading/, t);
      assert.doesNotMatch(h, /catalyst runway/i, t);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// B · NAMED FIXTURES
// ═══════════════════════════════════════════════════════════════════════════
const NAMED = JSON.parse(readFileSync(join(FX, 'zzz790-pc-named.json'), 'utf8'));
const named = (t: string) => {
  const g = NAMED.graded[t] && NAMED.graded[t].source !== 'none' ? NAMED.graded[t] : null;
  const r = buildRow(t, NAMED.ledgers[t], g, NAMED.freshness[t] || null);
  return { r, a: r.assessment as ThesisAssessment, html: renderCard(r), pcs: detectForRow(r) as any[] };
};
const row = (a: ThesisAssessment, k: string) => a.checked.find((c) => c.key === k);

describe('zzz790 · B — named fixtures', () => {
  test('every named card passes the full checklist', () => {
    const v: string[] = [];
    for (const t of Object.keys(NAMED.ledgers)) { const x = named(t); v.push(...cardViolations(x.r, x.html, x.pcs)); }
    assert.deepEqual(v, [], v.join('\n'));
  });

  test('AARTIPHARM: nearest A · provisional → CONFIRMATION REQUIRED (was THESIS INTACT — ON TRACK); evidence unchanged', () => {
    const { r, a, html } = named('AARTIPHARM');
    assert.equal(r.pattern.fit, 'nearest');
    assert.equal(r.pattern.pattern, 'A');
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.equal(a.catalystRank, null);
    assert.equal(a.verdict!.direction, 'UNKNOWN');
    assert.match(a.because, /^Provisional thesis — the type is an automatic nearest fit \(OPERATING INFLECTION\), not one you confirmed, so no affirmative verdict is given/);
    assert.doesNotMatch(`${a.because} ${a.headline}`, /THESIS INTACT|STRENGTHENING/);
    // The evidence is kept exactly: capacity +92% (5000 → 9,600+ MTPA) is still mechanism evidence.
    assert.ok((a.mechanismEvidence || []).some((d) => /5000\s*MTPA → 9,600\+\s*MTPA/.test(d.text)), JSON.stringify(a.mechanismEvidence));
    assert.match(html, /nearest A/);
    assert.match(html, /CONFIRMATION REQUIRED/);
  });

  test('MENONBEIN (MENONBE): 87% utilisation is a level, not a trend; 13 pp is capacity headroom only', () => {
    const { a, pcs } = named('MENONBE');
    const u = row(a, 'utilisation')!;
    assert.equal(u.after, '87%');
    assert.notEqual(u.verdict, 'improving');
    assert.ok(!(a.coverage.structural?.named?.confirmed || []).some((x: string) => /utilisation/i.test(x)));
    const cap = pcs.find((p) => p.kind === 'CAPACITY_RAMP');
    assert.match(cap.headroom, /^Capacity headroom: Utilisation 87% — 13 percentage points available/);
    assert.equal(cap.runway.ok, false);
    assert.match(cap.runway.text, /headroom, not runway/);
    assert.equal(cap.specialFocus, false);
  });

  test('MINDSPACEIN (MINDSPACE): newer document unread; Q4 FY24 evidence cannot confirm the Q1 FY27 mechanism; capex never unbuilt and commissioned at once', () => {
    const { r, a, html } = named('MINDSPACE');
    assert.equal(a.evidenceFreshness!.state, 'NEWER_UNREAD');
    assert.equal(a.evidenceFreshness!.label, NEWER_UNREAD_WORD);
    assert.equal(freshnessLine(r.freshness)!.label, 'NEWER EVIDENCE AVAILABLE — NOT YET READ');
    assert.match(html, /NEWER EVIDENCE AVAILABLE — NOT YET READ/);
    assert.equal(a.status, 'CONFIRMATION_REQUIRED');
    assert.ok(!a.mechanismCheck.some((m) => m.state === 'confirmed'), 'old evidence confirms nothing');
    assert.match(a.because, /NEWER EVIDENCE AVAILABLE — NOT YET READ/);
    const cx = r.capex;
    assert.ok(!(cx.earning.state === 'NOT_STARTED' && cx.build?.anyOperating), 'NOT STARTED and operating at once');
    for (const p of cx.build?.projects || []) assert.ok(['announced', 'under construction', 'commissioned', 'commercial production', 'operating', 'opened'].includes(p.build));
    assert.ok(!/EARNING/.test(cx.earning.state) || !!cx.earning.revenueContribution, 'commissioned is not earning');
  });

  test('SFLIN (SFL): the disclosed −6 exceptional item is DISCLOSED — never "none disclosed", never "unchecked"', () => {
    const { a, html } = named('SFL');
    const oo = row(a, 'one_offs')!;
    assert.equal(oo.silence, false);
    assert.match(String(oo.after), /-6/);
    assert.doesNotMatch(html, /One-offs · NOT DISCLOSED|none disclosed/);
    assert.notEqual(a.mechanismCheck.find((m) => /one-offs/i.test(m.link))?.state, 'unchecked');
  });

  test('SPECTRUMIN (SPECTRUM): 1.34 MW is installed (operational); 4.34 MW / 3.0 MW are targets; ~40,000 sq ft is guidance, never achieved', () => {
    const { a, pcs } = named('SPECTRUM');
    const cap = row(a, 'capacity')!;
    assert.equal(cap.after, '1.34 MW');
    assert.equal(cap.statement, 'ACTUAL', 'installed, not a target');
    assert.equal(cap.plan?.value, '4.34 MW');
    assert.equal(cap.plan?.type, 'TARGET');
    assert.notEqual(cap.verdict, 'improving');
    const add = row(a, 'capacity_addition')!;
    assert.equal(add.statement, 'GUIDANCE');
    assert.match(String(add.after), /40,000 sq\. ft\./);
    assert.notEqual(add.verdict, 'improving');
    assert.ok(!(a.coverage.structural?.named?.confirmed || []).some((x: string) => /capacity/i.test(x)));
    const ramp = pcs.find((p) => p.kind === 'CAPACITY_RAMP');
    assert.ok(!ramp.happened.some((h: string) => /^Commissioned: capacity added 3(\.0)? MW/.test(h)), ramp.happened.join(' | '));
    assert.ok(!ramp.evidence.some((e: any) => e.cls === 'HARD' && /3\.0 MW|4\.34 MW|40,000/.test(`${e.after}`)));
  });

  test('ULTRAMARIN (ULTRAMAR): silent checks read NOT DISCLOSED · unknown, with the unknown-not-negative sentence', () => {
    const { a, html } = named('ULTRAMAR');
    const silent = a.checked.filter((c) => c.silence);
    assert.ok(silent.length >= 1);
    for (const c of silent) assert.match(String(c.evidence), /Unknown, not negative: the documents reviewed did not disclose this variable\./);
    assert.match(html, new RegExp(SILENT_CHECK_WORD));
    assert.doesNotMatch(html, /check passes/);
  });

  test('VADILALIND: 270,000 → 380,000 L/day is historical; 380,000 → 380,000 is UNCHANGED, not capacity added this quarter', () => {
    const { a, html } = named('VADILALIND');
    const cap = row(a, 'capacity')!;
    assert.equal(cap.verdict, 'flat');
    assert.match(String(cap.before), /380,000/);
    assert.match(String(cap.after), /380,000/);
    const add = row(a, 'capacity_addition')!;
    assert.notEqual(add.verdict, 'improving');
    assert.match(String(add.stateReason || add.unjudged), /^history — installed capacity is unchanged/);
    assert.equal(unclearWords(add as any, 'x'), 'historical — not current-period evidence: x');
    assert.match(html, /historical — not current-period evidence: capacity expanded from 270,000/);
    assert.ok(!(a.mechanismEvidence || []).some((d) => /270,000/.test(d.text)));
  });

  test('WENDT: "One-time expenses of Rs.1.77 crore" in the margin-driver text makes One-offs DISCLOSED (an item, not a benefit; not a break)', () => {
    const { a, html } = named('WENDT');
    const oo = row(a, 'one_offs')!;
    assert.equal(oo.silence, false);
    assert.equal(oo.verdict, 'stated');
    assert.match(String(oo.after), /One-time expenses of Rs\.1\.77 crore/);
    assert.match(String(oo.evidence), /^DISCLOSED in the margin driver text read/);
    assert.ok(!a.triggered.some((t) => /one-off/i.test(t.condition)), 'not a break on its own');
    assert.match(html, /QUALIFICATION \/ WATCH — one-off item in reported earnings: One-time expenses of Rs\.1\.77 crore/);
    assert.doesNotMatch(html, /One-offs · NOT DISCLOSED/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// C · the pure rules behind the fixes
// ═══════════════════════════════════════════════════════════════════════════
describe('zzz790 · C — pure rules', () => {
  test('silence wording is never an explicit none', () => {
    for (const t of ['no stated delays', 'No capex timetable disclosed for Bhilai integration', 'none disclosed', 'not mentioned']) assert.equal(explicitNoneStated(t), false, t);
    for (const t of ['No exceptional items during the quarter', 'There were no one-off items', 'Exceptional items: nil', 'None']) assert.equal(explicitNoneStated(t), true, t);
  });
  test('a figure whose own clause says operational is not a forward statement', () => {
    const q = 'Our 1.34 MW renewable -energy solar installation at Jalgaon is operational, and a further 3.0 MW is planned during FY2026 27, taking the Company s total solar capacity to 4.34 MW.';
    assert.equal(forwardSentence('1.34 MW', q), false);
    assert.equal(forwardSentence('3.0 MW', q), true);
  });
  test('evidence freshness states', () => {
    assert.equal(evidenceFreshnessOf('Q1 FY27', 'Q1 FY27').state, 'CURRENT_QUARTER');
    assert.equal(evidenceFreshnessOf('Q4 FY26', 'Q1 FY27').state, 'PRIOR_QUARTER');
    assert.equal(evidenceFreshnessOf('Q4 FY24', 'Q1 FY27').state, 'STALE');
    assert.equal(evidenceFreshnessOf('Q4 FY24', 'Q1 FY27', true).state, 'NEWER_UNREAD');
    assert.equal(evidenceFreshnessOf(null, 'Q1 FY27').state, 'NO_EVIDENCE');
  });
  test('the provisional-blocked set is exactly the six verdict statuses', () => {
    assert.deepEqual([...PROVISIONAL_BLOCKED].sort(), ['BROKEN', 'NEGATIVE_EXPECTATION_GAP', 'ON_TRACK', 'POSITIVE_EXPECTATION_GAP', 'STRENGTHENING', 'WEAKENING']);
  });
  test('grep: no thesis / catalyst source still renders a silent pass', () => {
    const files: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(f)) files.push(p); } };
    for (const d of ['src/lib/thesis', 'src/lib/catalyst', 'src/components/thesis-card.tsx', 'src/components/special-focus-panel.tsx', 'src/app/(dashboard)/portfolio-catalysts']) {
      const p = join(ROOT, d); if (statSync(p).isDirectory()) walk(p); else files.push(p);
    }
    for (const f of files.filter((x) => !/silent-check\.ts$/.test(x))) {
      const s = readFileSync(f, 'utf8');
      assert.doesNotMatch(s, /none disclosed · check passes|passes, not a reading|catalyst runway/, f);
    }
  });
});
