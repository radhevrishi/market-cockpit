// ═══════════════════════════════════════════════════════════════════════════
// THE THESIS LEDGER — WHAT YOU ACTUALLY BOUGHT.                     (zzz715)
//
// The owner's criticism of the first Portfolio Catalysts was precise: the
// exit condition was STATIC. Every A-pattern holding carried the same
// sentence, word for word, whether its margin had moved forty basis points or
// four hundred, whether it had order-book cover or none. A sentence that is
// identical across fifteen holdings is a caption, not a ledger.
//
// So a thesis is defined here as a set of NAMED VARIABLES WITH WEIGHTS, and
// the invalidation conditions are GENERATED from those variables rather than
// written out. The consequence is the one he asked for: a capex delay matters
// enormously for a holding whose thesis rests on capacity and barely at all
// for one whose thesis rests on backlog, and the two now say different things
// because their ledgers are different.
//
// WEIGHT MEANS "HOW MUCH OF THE REASON FOR OWNING THIS IS THIS VARIABLE":
//
//   4 — CORE. The thesis is this variable. If it reverses durably, the reason
//       for owning the company is gone. Only a core variable can break a
//       thesis on its own.
//   3 — SUPPORTING. The mechanism by which the core variable is supposed to
//       keep working. Two of these deteriorating is a thesis break.
//   2 — CONFIRMING. Evidence that the story is on track. Deterioration here
//       is a warning, never a break.
//   1 — CONTEXT. Worth knowing, never worth acting on alone.
//
// A VARIABLE THE COMPANY DID NOT DISCLOSE IS NOT A DETERIORATING VARIABLE.
// This is the single most important rule in the file. An exit engine that
// treats silence as bad news fires on every company with a thin press release
// and teaches its owner to ignore it, which is worse than having no engine.
// ═══════════════════════════════════════════════════════════════════════════

import type { AbfgPattern } from '@/lib/earnings/pattern-abfg';
import type { VarKey } from './variables';

export interface ThesisVariable {
  key: VarKey;
  weight: 1 | 2 | 3 | 4;
  /** Why this variable is part of THIS thesis. Shown on the card. */
  why: string;
  /** What it looks like when this variable has failed. Generated into the
   *  invalidation list, ranked by weight. */
  invalidatedWhen: string;
}

export interface Thesis {
  pattern: AbfgPattern | 'UNCLASSIFIED';
  name: string;
  /** The earnings mechanism, as a chain. The owner's spec asks for exactly
   *  this: volume ↑ → revenue ↑ → absorption ↑ → margin ↑. */
  mechanism: string[];
  variables: ThesisVariable[];
}

const V = (key: VarKey, weight: 1 | 2 | 3 | 4, why: string, invalidatedWhen: string): ThesisVariable =>
  ({ key, weight, why, invalidatedWhen });

export const THESES: Record<AbfgPattern | 'UNCLASSIFIED', Thesis> = {
  // ── A · OPERATING INFLECTION ───────────────────────────────────────────
  // Bought because fixed costs are being absorbed. The core is the LEVERAGE,
  // not the revenue: revenue growing with margin flat is a different company.
  A: {
    pattern: 'A', name: 'OPERATING INFLECTION',
    mechanism: ['Volume ↑', 'Revenue ↑', 'Fixed-cost absorption ↑', 'Operating margin ↑', 'Earnings ↑↑'],
    variables: [
      V('operating_leverage', 4, 'The thesis IS this: profit compounding faster than revenue.',
        'Earnings grow slower than revenue for two consecutive quarters.'),
      V('margin', 4, 'Absorption has to show up as margin, or the leverage is not real.',
        'Operating margin stops expanding and gives back ground.'),
      V('revenue_growth', 3, 'Leverage needs volume behind it; margin alone is cost-cutting.',
        'Revenue growth decelerates materially.'),
      V('utilisation', 3, 'The physical mechanism of absorption. Rising utilisation is the proof.',
        'Utilisation fails to rise, or falls, despite the expected demand.'),
      V('cash_conversion', 2, 'Margin that does not convert to cash is an accounting margin.',
        'Operating cash flow falls below reported profit for two quarters.'),
      V('guidance', 2, 'Management is closest to whether the absorption continues.',
        'Management reduces forward expectations.'),
      V('one_offs', 2, 'A one-off gain can manufacture the entire margin move.',
        'The margin expansion turns out to rest on items that will not repeat.'),
      V('capex', 1, 'New capacity resets utilisation and can pause the leverage.', ''),
    ],
  },

  // ── B · DEMAND EXPLOSION ───────────────────────────────────────────────
  // Bought for the backlog. Current-quarter revenue is almost irrelevant; the
  // question is whether the book is still being filled faster than it empties.
  B: {
    pattern: 'B', name: 'DEMAND EXPLOSION',
    mechanism: ['Orders ↑', 'Backlog ↑', 'Revenue visibility ↑', 'Capacity committed', 'Revenue ↑ at booked margin'],
    variables: [
      V('order_book', 4, 'The thesis IS the book. Revenue is last year\'s orders.',
        'Order intake turns negative, or the book shrinks.'),
      V('book_to_bill', 4, 'Above 1.0 the book grows; below it you are eating the backlog.',
        'Book-to-bill below 1.0 for two consecutive quarters.'),
      V('margin', 3, 'Orders won at a worse margin than the existing book destroy the point.',
        'Incremental order margin falls below the existing book.'),
      V('capacity', 3, 'A book you cannot build is a press release.',
        'Expected capacity fails to commission, so the book cannot convert.'),
      V('revenue_growth', 2, 'Eventually the book has to become revenue.',
        'The backlog stops converting into revenue.'),
      V('guidance', 2, 'Execution timing usually shows up in guidance first.',
        'Management reduces forward expectations.'),
      V('cash_conversion', 2, 'Order-led businesses fail on working capital, not on demand.',
        'Cash conversion deteriorates as the book grows.'),
    ],
  },

  // ── F · PROFIT JUMP · FORENSICS ────────────────────────────────────────
  // Bought on a SUSPICION that has to be cleared. The thesis is explicitly
  // conditional, so confirmation next quarter is the core variable.
  F: {
    pattern: 'F', name: 'PROFIT JUMP · FORENSICS',
    mechanism: ['Profit ↑↑ vs revenue', 'Is it operational?', 'Next quarter confirms', 'Re-rating'],
    variables: [
      V('one_offs', 4, 'The whole question: was the jump operational, or below the line?',
        'The jump is traced to one-off or below-the-line items.'),
      V('earnings_growth', 4, 'It has to repeat. An unrepeated jump was an event, not a thesis.',
        'The next quarter fails to confirm the profit level.'),
      V('cash_conversion', 3, 'Cash is the forensic test a P&L cannot fake for long.',
        'Profit does not convert to operating cash flow.'),
      V('margin', 3, 'A structural margin gain survives the quarter; a windfall does not.',
        'The margin gain reverses.'),
      V('revenue_growth', 2, 'Profit without revenue is cost or accounting, not growth.',
        'Revenue fails to follow the profit.'),
      V('guidance', 2, 'Silence about a huge jump is itself information.',
        'Management declines to guide, or reduces forward expectations.'),
    ],
  },

  // ── G · SILENT QUALITY ─────────────────────────────────────────────────
  // Bought because nothing has happened yet. The edge is the absence of a
  // reaction, so deterioration in the compounding — not the price — ends it.
  G: {
    pattern: 'G', name: 'SILENT QUALITY',
    mechanism: ['Steady growth', 'Cash-backed', 'No reaction yet', 'Catalyst ahead', 'Re-rating'],
    variables: [
      V('cash_conversion', 4, 'The quality in "silent quality" is the cash.',
        'Operating cash flow falls below reported profit for two quarters.'),
      V('earnings_growth', 4, 'Quiet compounding only works if the compounding continues.',
        'Earnings growth stalls or turns negative.'),
      V('revenue_growth', 3, 'Steady is the thesis; a collapse is not "steady".',
        'Revenue growth turns negative.'),
      V('margin', 3, 'Margin erosion in a quiet compounder is the first crack.',
        'Operating margin erodes durably.'),
      V('guidance', 2, 'The named catalyst usually appears here first.',
        'The named catalyst passes its date with no effect.'),
      V('capex', 1, 'Capital discipline is part of why it compounds quietly.', ''),
    ],
  },

  // ── UNCLASSIFIED ───────────────────────────────────────────────────────
  // No pattern fired, and the spec is explicit that this is the common and
  // correct answer. But the holding is still owned, so it still gets a ledger
  // — a general one, with the variables that end any fundamental thesis. It
  // carries lower weights because there is no stated reason for owning it on
  // file, and an engine should not invent one.
  UNCLASSIFIED: {
    pattern: 'UNCLASSIFIED', name: 'NO PATTERN ON FILE',
    mechanism: ['No classified setup — general fundamental monitoring'],
    variables: [
      V('revenue_growth', 3, 'The base case for owning anything.',
        'Revenue growth turns negative.'),
      V('margin', 3, 'Durable margin erosion is the commonest quiet thesis break.',
        'Operating margin erodes durably.'),
      V('cash_conversion', 3, 'Profit that never becomes cash is the loudest single warning.',
        'Operating cash flow falls well below reported profit.'),
      V('earnings_growth', 2, 'Earnings direction.', 'Earnings turn negative.'),
      V('guidance', 2, 'Management\'s own forward view.', 'Management reduces forward expectations.'),
      V('order_book', 1, 'Where disclosed.', ''),
      V('utilisation', 1, 'Where disclosed.', ''),
    ],
  },
};

export function thesisFor(pattern: AbfgPattern | null | undefined): Thesis {
  return THESES[pattern || 'UNCLASSIFIED'] || THESES.UNCLASSIFIED;
}
