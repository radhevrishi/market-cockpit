// zzz830 — "Is all info from AI?" The bulk ✨ Read with AI button counts,
// labels, per-card source words, and the page wording. Synthetic tickers only.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { aiReadStatus, aiReadPlan, aiReadLabel, figuresWords, aiSourcesExplainer } from '../thesis/ai-read';
import { evidenceAttention } from '../thesis/evidence-counts';
import { QUICK_READ_VERSION, QUICK_READ_MODE } from '../thesis/quick-read';

const ROOT = join(__dirname, '..', '..', '..');
const fact = { id: 'f1', variable: 'capacity', value: '100', record_status: 'ACTIVE' };

function period(kind: 'ai' | 'quick', opts?: { facts?: number; at?: string }) {
  const n = opts?.facts ?? 1;
  return {
    reporting_period: 'Q1 FY27', period_end_date: '2026-06-30', latest_document_date: '2026-08-10',
    documents: [], documents_found: 1, documents_read: 1, documents_failed: 0, documents_skipped: 0,
    facts: Array.from({ length: n }, () => fact), events: [],
    summary: kind === 'quick' ? { read_kind: 'deterministic' } : { headline: 'x' },
    status: null, status_because: null, tallies: null, discovery_state: null, discovery_attempts: [],
    run_id: 'r1', prompt_version: kind === 'quick' ? QUICK_READ_VERSION : 'india-ai-summary-v9', model: kind === 'quick' ? null : 'm',
    extracted_at: opts?.at || '2026-09-20T10:00:00Z', updated_at: opts?.at || '2026-09-20T10:00:00Z',
  };
}
function ledger(p: any, runs: any[] = []) {
  return { ticker: 'X', market: 'IN', latest_period: 'Q1 FY27', periods: { 'Q1 FY27': p }, runs } as any;
}
const row = (symbol: string, l: any, es: string | null, extra: any = {}) => ({
  symbol, origin: 'book', market: 'IN', dataSource: 'screener-live', ledger: l,
  freshness: es ? { state: es === 'CURRENT' ? 'CURRENT' : 'X', evidence_state: es } : null, ...extra,
}) as any;

const AI = row('ZZAI', ledger(period('ai')), 'CURRENT');
const RULES = row('ZZRUL', ledger(period('quick')), 'CURRENT');
const RULES2 = row('ZZRUL2', ledger(period('quick')), 'CURRENT');
const INC_RULES = row('ZZINC1', ledger(period('quick', { facts: 0 })), 'EVIDENCE_INCOMPLETE');
const INC_AI = row('ZZINC2', ledger(period('ai', { facts: 0 })), 'EVIDENCE_INCOMPLETE');
const NEVER = row('ZZNEW', null, null);
const MIXED = row('ZZMIX', ledger(period('ai'), [{ run_id: 'q', mode: QUICK_READ_MODE, outcome: 'COMPLETED', reporting_period: 'Q1 FY27' }]), 'CURRENT');

describe('zzz830 AI read status per name', () => {
  test('kinds', () => {
    assert.equal(aiReadStatus(AI).kind, 'ai_read');
    assert.equal(aiReadStatus(RULES).kind, 'rules_only');
    assert.equal(aiReadStatus(INC_RULES).kind, 'incomplete');
    assert.equal(aiReadStatus(INC_AI).kind, 'incomplete');
    assert.equal(aiReadStatus(NEVER).kind, 'never_read');
    assert.equal(aiReadStatus(MIXED).kind, 'ai_read');
  });
  test('a rules-only name is NOT current for the AI button', () => {
    // The old bulk button used "needs attention"; a rules-only read passed it.
    assert.equal(evidenceAttention([RULES]).total, 0);
    assert.equal(aiReadStatus(RULES).needsAi, true);
    assert.equal(aiReadStatus(AI).needsAi, false);
  });
  test('modes: incomplete-with-AI is re-read (force); everything else incremental', () => {
    assert.equal(aiReadStatus(INC_AI).mode, 'force');
    assert.equal(aiReadStatus(INC_RULES).mode, 'incremental');
    assert.equal(aiReadStatus(RULES).mode, 'incremental');
    assert.equal(aiReadStatus(NEVER).mode, 'incremental');
  });
  test('evidence words say rules / AI / date', () => {
    assert.equal(aiReadStatus(AI).evidenceWords, 'Evidence: read by AI on 2026-09-20');
    assert.match(aiReadStatus(RULES).evidenceWords, /^Evidence: read by rules \(no AI\)/);
    assert.equal(aiReadStatus(MIXED).evidenceWords, 'Evidence: rules + AI (AI read on 2026-09-20)');
    assert.equal(aiReadStatus(NEVER).evidenceWords, 'Evidence: not read yet (no AI used)');
    assert.match(aiReadStatus(INC_AI).evidenceWords, /incomplete — read by AI on 2026-09-20/);
    assert.match(aiReadStatus(INC_RULES).evidenceWords, /incomplete — read by rules \(no AI\)/);
  });
  test('US: no ledger but the no-AI SEC reader found rows → rules only', () => {
    const us = row('ZZUS', null, null, { market: 'US', dataSource: 'sec-xbrl', det: { state: 'EVIDENCE_FOUND' } });
    assert.equal(aiReadStatus(us).kind, 'rules_only');
    assert.equal(aiReadStatus(us).figuresWords, 'Figures: filed numbers (SEC XBRL — no AI)');
  });
  test('figures words: filed numbers, never AI unless no row and AI read', () => {
    assert.equal(figuresWords('screener-live', 'IN', false), 'Figures: filed numbers (Screener — no AI)');
    assert.equal(figuresWords('screener', 'IN', true), 'Figures: filed numbers (Screener — no AI)');
    assert.match(figuresWords('graded', 'IN', true), /no AI/);
    assert.match(figuresWords('none', 'IN', true), /read from the results filing by AI/);
    assert.doesNotMatch(figuresWords('none', 'IN', false), /AI\b.*read/);
    assert.equal(figuresWords('none', 'US', false), 'Figures: no SEC XBRL figures on file');
  });
});

describe('zzz830 bulk plan and labels', () => {
  const rows = [AI, RULES, RULES2, INC_RULES, INC_AI, NEVER, MIXED];
  const plan = aiReadPlan(rows);
  test('N = never read + incomplete + rules only; the rest are AI reads', () => {
    assert.equal(plan.total, 5);
    assert.deepEqual(plan.all.sort(), ['ZZINC1', 'ZZINC2', 'ZZNEW', 'ZZRUL', 'ZZRUL2']);
    assert.deepEqual(plan.incomplete.sort(), ['ZZINC1', 'ZZINC2']);
    assert.deepEqual(plan.withoutAi.sort(), ['ZZINC1', 'ZZNEW', 'ZZRUL', 'ZZRUL2']);
    assert.equal(plan.aiRead + plan.rulesOnly + plan.incomplete.length + plan.neverRead, rows.length);
    assert.equal(plan.modeOf.ZZINC2, 'force');
    assert.equal(plan.modeOf.ZZRUL, 'incremental');
  });
  test('labels and breakdown', () => {
    assert.equal(plan.label, '✨ Read with AI — 5 names (uses AI · 5 calls, only on click)');
    assert.equal(aiReadLabel(1), '✨ Read with AI — 1 name (uses AI · 1 call, only on click)');
    assert.equal(plan.breakdown, '2 incomplete · 2 read without AI · 1 never read');
    assert.equal(plan.incompleteLabel, 'incomplete only (2)');
    assert.equal(plan.withoutAiLabel, 'all without an AI read (4)');
    assert.equal(plan.pageLine, 'AI is used only when you click. Of 7 names: 2 read by AI, 2 read by rules only, 2 incomplete, 1 not read yet.');
  });
  test('a name being read right now is counted but not queued again', () => {
    const p = aiReadPlan([{ ...RULES, state: 'loading' }, RULES2]);
    assert.equal(p.rulesOnly, 2);
    assert.deepEqual(p.all, ['ZZRUL2']);
  });
  test('all AI-read → nothing to do, no button', () => {
    const p = aiReadPlan([AI, MIXED]);
    assert.equal(p.total, 0);
    assert.equal(p.pageLine, 'AI is used only when you click. Of 2 names: 2 read by AI, 0 read by rules only, 0 incomplete.');
  });
});

describe('zzz830 page wiring', () => {
  const india = readFileSync(join(ROOT, 'src/app/(dashboard)/portfolio-catalysts/page.tsx'), 'utf8');
  const us = readFileSync(join(ROOT, 'src/app/(dashboard)/us-portfolio-catalysts/page.tsx'), 'utf8');
  const card = readFileSync(join(ROOT, 'src/components/thesis-card.tsx'), 'utf8');
  test('"All evidence current" is gone from both pages; the up-to-date words do not imply AI', () => {
    for (const s of [india, us]) {
      assert.doesNotMatch(s, /All evidence current/);
      assert.match(s, /Evidence up to date \(latest filings on file\)/);
      assert.match(s, /aiReadPlan\(list/);
      assert.match(s, /data-testid="ai-read-bulk"/);
      assert.match(s, /aiPlan\.total > 0/);
      assert.match(s, /aiPage\.pageLine/);
      assert.match(s, /aiSourcesExplainer\(/);
      assert.match(s, /aiRead=\{/);
    }
    assert.match(india, /modeOf: aiPlan\.modeOf/);
    assert.match(us, /readAll\(aiSyms, \{ reprocess: true \}\)/);
  });
  test('never auto-run: the bulk read is only inside an onClick', () => {
    for (const s of [india, us]) {
      const calls = s.split('readAll(aiSyms').length - 1;
      const inClick = s.split('onClick={() => readAll(aiSyms').length - 1;
      assert.equal(calls, 1);
      assert.equal(inClick, 1);
    }
  });
  test('card: AI button on every card with no AI read; source line', () => {
    assert.match(card, /p\.aiRead \? \(p\.aiRead\.needsAi/);
    assert.match(card, /data-testid="card-sources"/);
    assert.match(card, /✨ Read evidence with AI/);
  });
  test('how-it-works text: figures never from AI; rules first; AI on click', () => {
    for (const m of ['IN', 'US'] as const) {
      const t = aiSourcesExplainer(m);
      assert.match(t, /never from AI/);
      assert.match(t, /read by rules first, with no AI/);
      assert.match(t, /only when you click/);
    }
  });
});
