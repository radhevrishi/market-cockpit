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
// ── EVERY THESIS NOW CARRIES ITS STRUCTURAL VARIABLES.            (zzz720)
//
// The first ledgers listed six to eight variables and almost all of them were
// financial. That let the engine say "operating leverage 2.9×" with no way to
// know whether a plant was filling up or costs had been frozen for a quarter.
// Each ledger below now names the capacity, demand, capex, customer and
// forward variables the thesis actually depends on — so "EVIDENCE INCOMPLETE"
// can name exactly what is missing instead of gesturing at a filing.
//
// The weights carry the owner's own split: CORE (4) are the variables that
// make the thesis work, STRUCTURAL (3) are the mechanism that keeps them
// working, and the rest is confirmation and context.
//
// A VARIABLE THE COMPANY DID NOT DISCLOSE IS NOT A DETERIORATING VARIABLE.
// This is the single most important rule in the file. An exit engine that
// treats silence as bad news fires on every company with a thin press release
// and teaches its owner to ignore it, which is worse than having no engine.
// ═══════════════════════════════════════════════════════════════════════════

import type { AbfgPattern } from '@/lib/earnings/pattern-abfg';
import type { VarKey, VarDimension } from './taxonomy';

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
  /** ── THE DIMENSIONS THAT MUST CARRY EVIDENCE.                  (zzz723)
   *
   *  A thesis is a claim that a MECHANISM keeps producing earnings. Financial
   *  output is the RESULT of that mechanism, never proof it is intact — which
   *  is how AETHER reached "THESIS STRENGTHENING" on revenue and cash while
   *  capacity, orders, capex, customers and guidance sat untouched.
   *
   *  A thesis can only be called CONFIRMED when every dimension listed here
   *  carries at least one confirming variable. Financial evidence alone gets
   *  CONFIRMATION REQUIRED: the numbers are good and nobody has established
   *  why. */
  requiresConfirmationIn: VarDimension[];
}

const V = (key: VarKey, weight: 1 | 2 | 3 | 4, why: string, invalidatedWhen: string): ThesisVariable =>
  ({ key, weight, why, invalidatedWhen });

export const THESES: Record<AbfgPattern | 'UNCLASSIFIED', Thesis> = {
  // ── A · OPERATING INFLECTION ───────────────────────────────────────────
  // Bought because fixed costs are being absorbed. The core is the LEVERAGE
  // and the MARGIN it produces; utilisation is the physical mechanism and is
  // core too, because leverage without a filling plant is a cost story that
  // runs out.
  A: {
    pattern: 'A', name: 'OPERATING INFLECTION',
    mechanism: ['Volume ↑', 'Utilisation ↑', 'Fixed-cost absorption ↑', 'Operating margin ↑', 'Earnings ↑↑'],
    // Absorption is a PHYSICAL claim. Without an operating driver — utilisation,
    // volume, capacity, a named margin driver — "operating inflection" is just
    // a quarter with good numbers.
    requiresConfirmationIn: ['financial', 'operating_driver'],
    variables: [
      V('operating_leverage', 4, 'The thesis IS this: profit compounding faster than revenue.',
        'Earnings grow slower than revenue for two consecutive quarters.'),
      V('margin', 4, 'Absorption has to show up as margin, or the leverage is not real.',
        'Operating margin stops expanding and gives back ground.'),
      V('utilisation', 4, 'The physical mechanism of absorption. A rising plant is what makes this repeatable.',
        'Utilisation fails to rise, or falls, despite the expected demand.'),
      V('revenue_growth', 3, 'Leverage needs volume behind it; margin alone is cost-cutting.',
        'Revenue growth decelerates materially.'),
      V('margin_driver', 3, 'A margin built on a raw-material tailwind reads identically to one built on absorption, and does not repeat.',
        'The margin gain turns out to rest on cyclical or one-off drivers only.'),
      V('volume', 3, 'Volume is the part of revenue that needs capacity. Price-led growth does not absorb fixed cost.',
        'Volume growth stalls while revenue is carried by price.'),
      V('capacity_addition', 2, 'New capacity resets utilisation and can pause the leverage for a year.', ''),
      V('capex_earning', 2, 'If capex was spent, the absorption story is the capex story.',
        'Capacity is commissioned and utilisation does not follow.'),
      V('cash_conversion', 2, 'Margin that does not convert to cash is an accounting margin.',
        'Operating cash flow falls below reported profit for two quarters.'),
      V('guidance', 2, 'Management is closest to whether the absorption continues.',
        'Management reduces forward expectations.'),
      V('one_offs', 2, 'A one-off gain can manufacture the entire margin move.',
        'The margin expansion rests on items that will not repeat.'),
      V('order_book', 1, 'Where disclosed, it says whether the filling plant stays full.', ''),
      V('capacity', 1, 'The denominator of utilisation.', ''),
      V('price', 1, 'Price-led margin is not absorption.', ''),
      V('mix', 1, 'Mix can carry a margin without any operating leverage at all.', ''),
      V('capacity_bottleneck', 1, 'A removed bottleneck is often what starts an inflection.', ''),
    ],
  },

  // ── B · DEMAND EXPLOSION ───────────────────────────────────────────────
  B: {
    pattern: 'B', name: 'DEMAND EXPLOSION',
    mechanism: ['Orders ↑', 'Backlog ↑', 'Capacity committed', 'Execution', 'Revenue ↑ at booked margin'],
    requiresConfirmationIn: ['demand', 'financial'],
    variables: [
      V('order_book', 4, 'The thesis IS the book. Revenue is last year\'s orders.',
        'Order intake turns negative, or the book shrinks.'),
      V('book_to_bill', 4, 'Above 1.0 the book grows; below it you are eating the backlog.',
        'Book-to-bill below 1.0 for two consecutive quarters.'),
      V('order_intake', 4, 'The book is a stock; intake is the flow that refills it.',
        'New order intake falls materially or stops.'),
      V('capacity', 3, 'A book you cannot build is a press release.',
        'Expected capacity fails to commission, so the book cannot convert.'),
      V('execution_delay', 3, 'Order-led businesses die on execution, not on demand.',
        'Execution or commissioning slips repeatedly.'),
      V('margin', 3, 'Orders won at a worse margin than the existing book destroy the point.',
        'Incremental order margin falls below the existing book.'),
      V('revenue_visibility', 3, 'Backlog coverage is what you are actually buying.',
        'Backlog coverage shortens materially.'),
      V('customer_concentration', 2, 'One cancellation ends a concentrated book.',
        'The book becomes dependent on a single customer or programme.'),
      V('customer_loss', 2, 'A lost programme takes its backlog with it.',
        'A major customer or programme is lost.'),
      V('cash_conversion', 2, 'Order books are funded by working capital.',
        'Cash conversion deteriorates as the book grows.'),
      V('working_capital', 2, 'The commonest way an order-led business runs out of money.', ''),
      V('revenue_growth', 2, 'Eventually the book has to become revenue.',
        'The backlog stops converting into revenue.'),
      V('guidance', 2, 'Execution timing shows up in guidance first.',
        'Management reduces forward expectations.'),
      V('capacity_addition', 1, 'Capacity is how the book gets built.', ''),
      V('new_customer', 2, 'Customer and programme wins are where the next book comes from.', ''),
    ],
  },

  // ── F · PROFIT JUMP · FORENSICS ────────────────────────────────────────
  F: {
    pattern: 'F', name: 'PROFIT JUMP · FORENSICS',
    mechanism: ['Profit ↑↑ vs revenue', 'Is it operational?', 'Cash confirms', 'Next quarter repeats', 'Re-rating'],
    // For F the QUALITY dimension is the whole question — one-offs, cash,
    // working capital. A profit jump with no quality evidence is the suspicion
    // the pattern names, not a thesis that has been confirmed.
    requiresConfirmationIn: ['quality', 'financial', 'operating_driver'],
    variables: [
      V('one_offs', 4, 'The whole question: was the jump operational, or below the line?',
        'The jump is traced to one-off or below-the-line items.'),
      V('earnings_growth', 4, 'It has to repeat. An unrepeated jump was an event, not a thesis.',
        'The next quarter fails to confirm the profit level.'),
      V('cash_conversion', 4, 'Cash is the forensic test a P&L cannot fake for long.',
        'Profit does not convert to operating cash flow.'),
      V('margin_driver', 3, 'A jump with a named operational driver is a different animal from one without.',
        'No operational driver is established for the jump.'),
      V('margin', 3, 'A structural margin gain survives the quarter; a windfall does not.',
        'The margin gain reverses.'),
      V('working_capital', 3, 'Profit parked in receivables is the classic false jump.',
        'Receivables or inventory rise faster than revenue.'),
      V('revenue_growth', 2, 'Profit without revenue is cost or accounting, not growth.',
        'Revenue fails to follow the profit.'),
      V('utilisation', 2, 'An operational jump usually has a plant behind it.', ''),
      V('volume', 2, 'Volume behind the profit makes it operational.', ''),
      V('guidance', 2, 'Silence about a huge jump is itself information.',
        'Management declines to guide, or reduces forward expectations.'),
      V('raw_materials', 2, 'An input-cost windfall explains many profit jumps and does not repeat.', ''),
      V('roce', 1, 'Whether the jump shows up in returns on capital.', ''),
      // zzz770 — the owner's F map also names operating leverage and price/mix
      // as candidate causes of the jump. Confirming, never gates on their own.
      V('operating_leverage', 2, 'Profit outrunning revenue is the jump itself; a stated fixed-cost cause makes it operational.', ''),
      V('mix', 2, 'A mix shift is a structural cause; a price spike is not.', ''),
    ],
  },

  // ── G · SILENT QUALITY ─────────────────────────────────────────────────
  G: {
    pattern: 'G', name: 'SILENT QUALITY',
    mechanism: ['Steady growth', 'Cash-backed', 'No reaction yet', 'Catalyst ahead', 'Re-rating'],
    requiresConfirmationIn: ['quality', 'financial'],
    variables: [
      V('cash_conversion', 4, 'The quality in "silent quality" is the cash.',
        'Operating cash flow falls below reported profit for two quarters.'),
      V('earnings_growth', 4, 'Quiet compounding only works if the compounding continues.',
        'Earnings growth stalls or turns negative.'),
      V('revenue_growth', 3, 'Steady is the thesis; a collapse is not "steady".',
        'Revenue growth turns negative.'),
      V('margin', 3, 'Margin erosion in a quiet compounder is the first crack.',
        'Operating margin erodes durably.'),
      V('roce', 3, 'A quiet compounder that stops earning its capital is just quiet.',
        'Returns on capital deteriorate.'),
      V('guidance', 2, 'The named catalyst usually appears here first.',
        'The named catalyst passes its date with no effect.'),
      V('management_target', 2, 'The catalyst, where management has put a date on it.', ''),
      V('working_capital', 2, 'Quality shows up in working-capital discipline.', ''),
      V('capex', 1, 'Capital discipline is part of why it compounds quietly.', ''),
      V('market_share', 1, 'Quiet share gain is the best kind.', ''),
      // zzz770 — balance sheet and forensics are part of "quality".
      V('debt', 2, 'A quiet compounder funds itself; rising borrowing is the first sign it cannot.',
        'Borrowing rises to fund working capital or losses.'),
      V('one_offs', 2, 'Recurring earnings are the point; a one-off inside the profit is the forensic check.',
        'The earnings rest on items that will not repeat.'),
    ],
  },

  // ── UNCLASSIFIED ───────────────────────────────────────────────────────
  // No pattern fired — the common and correct answer. The holding is still
  // owned, so it still gets a ledger: the variables that end ANY fundamental
  // thesis, with revenue and cash as the core because with no stated setup on
  // file those are the two that decide whether it is still a business worth
  // owning.
  UNCLASSIFIED: {
    pattern: 'UNCLASSIFIED', name: 'NO PATTERN ON FILE',
    mechanism: ['No classified setup — general fundamental monitoring'],
    // With no stated setup on file there is no structural mechanism to prove,
    // so financial and quality evidence is the whole bar. This is the one
    // ledger where good numbers legitimately carry the verdict.
    requiresConfirmationIn: ['financial', 'quality'],
    variables: [
      V('revenue_growth', 4, 'With no classified setup on file, revenue direction IS the base case for owning it.',
        'Revenue growth turns negative.'),
      V('cash_conversion', 4, 'Profit that never becomes cash is the loudest single warning in any thesis.',
        'Operating cash flow falls well below reported profit.'),
      V('margin', 3, 'Durable margin erosion is the commonest quiet thesis break.',
        'Operating margin erodes durably.'),
      V('earnings_growth', 3, 'Earnings direction.', 'Earnings turn negative.'),
      V('guidance', 3, 'Management\'s own forward view.', 'Management reduces forward expectations.'),
      V('utilisation', 2, 'Where disclosed, the clearest read on whether the business is filling.', ''),
      V('order_book', 2, 'Where disclosed, forward revenue.', ''),
      V('capex_earning', 2, 'If capital was spent, whether it earned.', ''),
      V('one_offs', 2, 'Whether this quarter repeats.', ''),
      V('working_capital', 2, 'Where a profitable business runs out of money.', ''),
      V('customer_loss', 2, 'The fastest way a thesis ends.', 'A major customer or programme is lost.'),
      V('roce', 1, 'Capital productivity.', ''),
      V('execution_delay', 1, 'Where disclosed.', ''),
    ],
  },
};

export function thesisFor(pattern: AbfgPattern | null | undefined): Thesis {
  return THESES[pattern || 'UNCLASSIFIED'] || THESES.UNCLASSIFIED;
}
