// ═══════════════════════════════════════════════════════════════════════════
// WHAT CAME FROM AI, AND WHO STILL NEEDS AN AI READ.                  (zzz830)
//
// The owner asked: "Is all info from AI? It used to offer to read the missing
// names with AI, and now there is no such button." Both halves were real:
//
//   · Since the no-AI quick read (zzz816) fills a ledger on page load, a name
//     read only by rules counted as "evidence current", so the bulk AI button
//     turned into "✨ All evidence current" — a sparkle that implied AI and a
//     button that did nothing. The names with no AI read had no bulk way in.
//   · Nothing on the page said, per name, where the figures and the evidence
//     came from.
//
// This module is the one definition for both pages (India and US):
//   aiReadStatus  one row → never read / incomplete / read by rules only /
//                 read by AI, plus the words for its card;
//   aiReadPlan    the rows in view → who the bulk "✨ Read with AI" button
//                 reads, how many calls that is, and the page-level line.
//
// RULES. AI is used only on a click — nothing here starts a read. Unknown is
// not negative: a name with nothing read is "not read yet", never a fail.
// Financial figures are filed numbers (Screener / exchange results / SEC
// XBRL), never AI — the one exception (an India name with no Screener or
// graded row, whose results page is read by AI on click) is said on its card.
// ═══════════════════════════════════════════════════════════════════════════

import { isQuickReadPeriod, QUICK_READ_MODE } from './quick-read';
import { rowEvidenceState, type CountableRow } from './evidence-counts';

export type AiReadKind = 'never_read' | 'incomplete' | 'rules_only' | 'ai_read';

export interface AiReadRow extends CountableRow {
  symbol: string;
  market?: string | null;
  state?: string | null;
  dataSource?: string | null;
  /** US: the no-AI SEC reader's result for this name. */
  det?: { state?: string | null } | null;
  /** The card's assessment — only its list of unknown core variables is read. */
  assessment?: { coverage?: { missingCore?: string[] | null } | null } | null;
}

export interface AiReadStatus {
  kind: AiReadKind;
  /** No AI read of the latest quarter yet, or the evidence is incomplete. */
  needsAi: boolean;
  /** The latest quarter on file was read by AI. */
  hasAi: boolean;
  /** Rules (the no-AI reader) found evidence for this name. */
  hasRules: boolean;
  /** Date (YYYY-MM-DD) of the latest AI read on file, any quarter. */
  aiAt: string | null;
  /** How a click should read it: a name already read by AI but incomplete is
   *  re-read (force); every other name takes the normal incremental read. */
  mode: 'incremental' | 'force';
  /** Thesis-critical variables still unknown (not disclosed / not searched). */
  gaps: number;
  figuresWords: string;
  evidenceWords: string;
}

const day = (s: string | null | undefined) => (s ? String(s).slice(0, 10) : null);

/** Pure: the figures' source, in words. */
export function figuresWords(dataSource: string | null | undefined, market: string | null | undefined, hasAi: boolean): string {
  const ds = String(dataSource || '');
  if (ds === 'sec-xbrl') return 'Figures: filed numbers (SEC XBRL — no AI)';
  if (ds === 'screener' || ds === 'screener-live') return 'Figures: filed numbers (Screener — no AI)';
  if (ds === 'graded') return 'Figures: filed numbers (exchange results filing, read by rules — no AI)';
  if (market === 'US') return 'Figures: no SEC XBRL figures on file';
  return hasAi
    ? 'Figures: no Screener or graded row — any revenue / profit shown was read from the results filing by AI'
    : 'Figures: no Screener or graded row on file';
}

/** Pure: one row's AI-read status and the words its card prints. */
export function aiReadStatus(r: AiReadRow, now?: Date | string): AiReadStatus {
  const l = r.ledger || null;
  const latest = l?.latest_period || null;
  const p = latest ? l!.periods?.[latest] || null : null;
  const latestQuick = !!p && isQuickReadPeriod(p);
  const hasAi = !!p && !latestQuick;
  let aiAt: string | null = hasAi ? day(p!.updated_at || p!.extracted_at) : null;
  if (!aiAt && l) {
    for (const q of Object.values(l.periods || {})) {
      if (!q || isQuickReadPeriod(q)) continue;
      const d = day(q.updated_at || q.extracted_at);
      if (d && (!aiAt || d > aiAt)) aiAt = d;
    }
  }
  const quickRunOnLatest = !!l && (l.runs || []).some((x) => x.mode === QUICK_READ_MODE && x.outcome === 'COMPLETED' && (!latest || x.reporting_period === latest));
  const hasRules = latestQuick || (quickRunOnLatest && !!p) || r.det?.state === 'EVIDENCE_FOUND';
  const es = rowEvidenceState(r, now);
  const kind: AiReadKind = es === 'EVIDENCE_INCOMPLETE' ? 'incomplete'
    : !p && !hasRules ? 'never_read'
      : !hasAi ? 'rules_only'
        : 'ai_read';
  const aiOlder = !hasAi && aiAt ? ` · an earlier quarter was read by AI on ${aiAt}` : '';
  const evidenceWords = kind === 'ai_read'
    ? (hasRules ? `Evidence: rules + AI (AI read on ${aiAt})` : `Evidence: read by AI on ${aiAt}`)
    : kind === 'rules_only' ? `Evidence: read by rules (no AI) — no AI read of this quarter yet${aiOlder}`
      : kind === 'incomplete'
        ? (hasAi ? `Evidence: incomplete — read by AI on ${aiAt}, no structural fact found`
          : p ? `Evidence: incomplete — read by rules (no AI), no structural fact found${aiOlder}`
            : 'Evidence: incomplete — searched, nothing read yet (no AI used)')
        : 'Evidence: not read yet (no AI used)';
  const gaps = (r.assessment?.coverage?.missingCore || []).length;
  return {
    kind, needsAi: kind !== 'ai_read', hasAi, gaps, hasRules, aiAt,
    mode: hasAi ? 'force' : 'incremental',
    figuresWords: figuresWords(r.dataSource, r.market, hasAi),
    evidenceWords,
  };
}

export interface AiReadPlan {
  /** Every name in view that needs an AI read (never read + incomplete + rules only + read but with missing core details). */
  all: string[];
  /** The evidence-incomplete names only. */
  incomplete: string[];
  /** Names with no AI read of the latest quarter (never read, rules only, incomplete without AI). */
  withoutAi: string[];
  /** Names (any read state) with core thesis variables still unknown. */
  withGaps: string[];
  neverRead: number;
  rulesOnly: number;
  aiRead: number;
  /** How each name should be read on click. */
  modeOf: Record<string, 'incremental' | 'force'>;
  total: number;
  /** "3 incomplete · 7 read without AI · 0 never read". */
  breakdown: string;
  /** "✨ Read with AI — 10 names (uses AI · 10 calls, only on click)". */
  label: string;
  incompleteLabel: string;
  withoutAiLabel: string;
  withGapsLabel: string;
  /** "AI is used only when you click. Of 69 names: 59 read by AI, 7 read by rules only, 3 incomplete." */
  pageLine: string;
}

const s = (n: number) => (n === 1 ? '' : 's');

/** The bulk-button label for N names. */
export function aiReadLabel(n: number): string {
  return `✨ Read with AI — ${n} name${s(n)} (uses AI · ${n} call${s(n)}, only on click)`;
}

/** Pure: who the bulk AI button reads, and the page-level line. A name being
 *  read right now is left out of the button (it is already in hand). */
export function aiReadPlan(rows: AiReadRow[], now?: Date | string): AiReadPlan {
  const all: string[] = [], incomplete: string[] = [], withoutAi: string[] = [], withGaps: string[] = [];
  const modeOf: Record<string, 'incremental' | 'force'> = {};
  let neverRead = 0, rulesOnly = 0, aiRead = 0, inc = 0;
  for (const r of rows) {
    const st = aiReadStatus(r, now);
    if (st.gaps > 0 && r.state !== 'loading') { withGaps.push(r.symbol); modeOf[r.symbol] = st.hasAi ? 'force' : 'incremental'; }
    if (st.kind === 'ai_read') {
      aiRead++;
      // Read by AI but core details are still unknown → one more AI pass is offered.
      if (st.gaps > 0 && r.state !== 'loading') { all.push(r.symbol); modeOf[r.symbol] = 'force'; }
      continue;
    }
    if (st.kind === 'never_read') neverRead++;
    else if (st.kind === 'rules_only') rulesOnly++;
    else inc++;
    if (r.state === 'loading') continue;
    all.push(r.symbol);
    modeOf[r.symbol] = st.mode;
    if (st.kind === 'incomplete') incomplete.push(r.symbol);
    if (!st.hasAi) withoutAi.push(r.symbol);
  }
  const n = rows.length;
  const breakdown = `${inc} incomplete · ${rulesOnly} read without AI · ${neverRead} never read`;
  const pageLine = `AI is used only when you click. Of ${n} name${s(n)}: ${aiRead} read by AI, ${rulesOnly} read by rules only, ${inc} incomplete${neverRead ? `, ${neverRead} not read yet` : ''}.`;
  return {
    all, incomplete, withoutAi, withGaps, neverRead, rulesOnly, aiRead, modeOf, total: all.length, breakdown,
    label: aiReadLabel(all.length),
    incompleteLabel: `incomplete only (${incomplete.length})`,
    withoutAiLabel: `all without an AI read (${withoutAi.length})`,
    withGapsLabel: `names with missing details (${withGaps.length})`,
    pageLine,
  };
}

/** The plain-English "where does this come from" paragraph, both pages. */
export function aiSourcesExplainer(market: 'IN' | 'US'): string {
  return market === 'US'
    ? 'Where the information comes from: financial figures (revenue, earnings, margin, cash conversion) are the numbers filed with the SEC (XBRL) — never from AI. Mechanism evidence (backlog, capacity, orders, guidance) is read by rules first, with no AI. AI reads a filing only when you click a "Read with AI" button, and each card says which it was.'
    : 'Where the information comes from: financial figures (revenue, earnings, margin, cash conversion) are filed numbers from Screener or the exchange results filing — never from AI (the only exception: a name with neither, whose results page is read by AI when you click, and its card says so). Mechanism evidence (capacity, orders, guidance) is read by rules first, with no AI. AI reads the documents only when you click a "Read with AI" button, and each card says which it was.';
}
