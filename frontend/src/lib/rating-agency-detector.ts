// ═══════════════════════════════════════════════════════════════════════════
// RATING AGENCY ACTION DETECTOR — §17.4(B) module 2.
//
// Heuristic regex classifier that turns rating-agency news headlines into
// structured upgrade / downgrade / outlook-change events.
//
// Covered agencies: ICRA, CRISIL, CARE, India Ratings, Fitch, S&P, Moody's,
// Brickwork, Acuité.
//
// Action types:
//   UPGRADE      — rating moved up (BB → BBB, A → AA, etc.)
//   DOWNGRADE    — rating moved down
//   OUTLOOK_UP   — outlook moved toward positive (Stable→Positive)
//   OUTLOOK_DOWN — outlook moved toward negative (Stable→Negative or Negative Watch)
//   AFFIRMED     — rating reaffirmed without change (informational)
//   ASSIGNED     — new rating assigned
//   WITHDRAWN    — rating withdrawn (often material — issuer dropped surveillance)
//
// Returns a structured RatingAction signal for tabular display on the
// /rating-actions page. Each row is sortable / filterable by agency and
// action type.
// ═══════════════════════════════════════════════════════════════════════════

export type RatingActionKind =
  | 'UPGRADE' | 'DOWNGRADE'
  | 'OUTLOOK_UP' | 'OUTLOOK_DOWN'
  | 'AFFIRMED' | 'ASSIGNED' | 'WITHDRAWN';

export interface RatingAction {
  agency: string;
  kind: RatingActionKind;
  oldRating?: string;
  newRating?: string;
  oldOutlook?: string;
  newOutlook?: string;
  headline: string;
  evidence: string;
}

const AGENCY_PATTERNS: Array<{ rx: RegExp; name: string }> = [
  { rx: /\bICRA\b/i,                          name: 'ICRA' },
  { rx: /\bCRISIL\b/i,                        name: 'CRISIL' },
  { rx: /\bCARE Ratings?\b/i,                 name: 'CARE' },
  { rx: /\bIndia Ratings?\b|\bInd-?Ra\b/i,    name: 'India Ratings' },
  { rx: /\bFitch\b/i,                         name: 'Fitch' },
  { rx: /\bMoody'?s\b/i,                      name: 'Moody\'s' },
  { rx: /\bS&P\b|\bStandard\s*&\s*Poor/i,     name: 'S&P' },
  { rx: /\bBrickwork\b/i,                     name: 'Brickwork' },
  { rx: /\bAcuit[eé]\b/i,                     name: 'Acuité' },
  // PATCH 0713 — additional Indian rating agencies that file Reg-30
  // disclosures alongside the majors. Brickwork (already covered), SMERA
  // (now Acuité-owned but still files under SMERA), Infomerics is widely
  // used by mid-tier NBFCs. Dun & Bradstreet India / DBRS appear on
  // certain cross-border bond filings.
  { rx: /\bSMERA\b/i,                         name: 'SMERA' },           // PATCH 0713
  { rx: /\bInfomerics\b/i,                    name: 'Infomerics' },      // PATCH 0713
  { rx: /\bBWR\b/i,                           name: 'Brickwork' },        // PATCH 0713
  { rx: /\bDun\s*&\s*Bradstreet|DBRS\b/i,     name: 'Dun & Bradstreet' }, // PATCH 0713
];

const UPGRADE_PATTERNS = [
  /\b(upgrade[ds]?|upgraded?)\b/i,
  /rating raised\b/i,
  /rating revised upward/i,
  /rating improved/i,
  // PATCH 0713 — common upgrade phrasings in Indian rating press releases
  /\brevised\s+upwards?\b/i,                                   // PATCH 0713
  /\bnotch[- ]?up\b/i,                                          // PATCH 0713
  /\b(?:moved|migrated)\s+(?:up|to\s+a\s+higher|to\s+the\s+next\s+higher)/i, // PATCH 0713
  /\bcredit\s+profile\s+(?:strengthen|improv)/i,                // PATCH 0713
];
const DOWNGRADE_PATTERNS = [
  /\b(downgrade[ds]?|downgraded?)\b/i,
  /rating lowered\b/i,
  /rating revised downward/i,
  /\bcut\b.{0,30}\brating/i,
  // PATCH 0713 — common downgrade phrasings
  /\brevised\s+downwards?\b/i,                                  // PATCH 0713
  /\bnotch[- ]?down\b/i,                                         // PATCH 0713
  /\b(?:moved|migrated)\s+(?:down|to\s+a\s+lower|to\s+the\s+next\s+lower)/i, // PATCH 0713
  /\bcredit\s+profile\s+(?:weakened|deteriorat)/i,              // PATCH 0713
  /\bplaced\s+(?:on\s+)?(?:rating\s+)?watch\s+(?:with\s+)?negative/i, // PATCH 0713
];
const OUTLOOK_UP_PATTERNS = [
  /outlook (?:revised to|raised to|changed to) ?["']?Positive/i,
  /Stable\s*(?:to|→)\s*Positive/i,
  /placed on (?:Positive )?watch positive/i,
  // PATCH 0713 — outlook-up phrasings observed in Indian filings
  /Negative\s*(?:to|→)\s*Stable/i,                              // PATCH 0713 — negative→stable is a positive shift
  /outlook\s+(?:upgraded|improved|strengthened)/i,              // PATCH 0713
  /\bwatch\s+positive\b/i,                                       // PATCH 0713
  /\boutlook\s+revised\s+to\s+positive\s+from\s+stable\b/i,      // PATCH 0713
];
const OUTLOOK_DOWN_PATTERNS = [
  /outlook (?:revised to|lowered to|changed to) ?["']?Negative/i,
  /Stable\s*(?:to|→)\s*Negative/i,
  /placed on (?:Negative )?watch negative/i,
  /Credit Watch with Negative Implications/i,
  // PATCH 0713 — additional outlook-down phrasings
  /Positive\s*(?:to|→)\s*Stable/i,                              // PATCH 0713 — positive→stable is a negative shift
  /outlook\s+(?:downgraded|weakened|deteriorated)/i,            // PATCH 0713
  /\bwatch\s+(?:with\s+)?developing\s+implications\b/i,         // PATCH 0713
  /\boutlook\s+revised\s+to\s+negative\s+from\s+stable\b/i,     // PATCH 0713
  /\boutlook\s+revised\s+to\s+stable\s+from\s+positive\b/i,     // PATCH 0713
];
const AFFIRMED_PATTERNS = [
  /\baffirmed\b/i,
  /rating reaffirmed/i,
  // PATCH 0713
  /\brating\s+(?:maintained|retained|continued)\b/i,            // PATCH 0713
  /\bno\s+change\s+in\s+rating\b/i,                              // PATCH 0713
];
const ASSIGNED_PATTERNS = [
  /\bassigned (?:an? )?rating/i,
  /\bfirst[- ]time rating/i,
  /\binitial rating assigned/i,
  // PATCH 0713
  /\bfresh\s+rating\s+(?:assigned|granted)\b/i,                 // PATCH 0713
  /\b(?:new|maiden)\s+rating\s+(?:assigned|granted|allocated)\b/i, // PATCH 0713
  /\brating\s+(?:assigned\s+for|granted\s+for)\s+(?:NCD|CP|bank|loan|commercial\s+paper|non[- ]convertible)/i, // PATCH 0713
];
const WITHDRAWN_PATTERNS = [
  /rating withdrawn/i,
  /withdraws? (?:its )?rating/i,
  // PATCH 0713
  /\brating\s+(?:suspended|removed)\b/i,                        // PATCH 0713
  /\bsurveillance\s+(?:discontinued|withdrawn)\b/i,             // PATCH 0713
  /\brating\s+(?:placed\s+on\s+)?notice\s+of\s+withdrawal\b/i,  // PATCH 0713
];

// Rating-tier extraction: catches grades like "BBB+", "AA-", "Baa1", "A1+",
// "Caa2", "B1". Picks two consecutive tiers in upgrade/downgrade text.
const TIER_RE = /\b([A-D]{1,3}[+-]?\d?|Aa\d|Aaa|Baa\d|Caa\d|Ba\d|Caa)\b/g;

export function detectRatingAction(text: string): RatingAction | null {
  if (!text) return null;
  const agency = AGENCY_PATTERNS.find(p => p.rx.test(text));
  if (!agency) return null;

  let kind: RatingActionKind | null = null;
  if (UPGRADE_PATTERNS.some(rx => rx.test(text))) kind = 'UPGRADE';
  else if (DOWNGRADE_PATTERNS.some(rx => rx.test(text))) kind = 'DOWNGRADE';
  else if (OUTLOOK_UP_PATTERNS.some(rx => rx.test(text))) kind = 'OUTLOOK_UP';
  else if (OUTLOOK_DOWN_PATTERNS.some(rx => rx.test(text))) kind = 'OUTLOOK_DOWN';
  else if (WITHDRAWN_PATTERNS.some(rx => rx.test(text))) kind = 'WITHDRAWN';
  else if (ASSIGNED_PATTERNS.some(rx => rx.test(text))) kind = 'ASSIGNED';
  else if (AFFIRMED_PATTERNS.some(rx => rx.test(text))) kind = 'AFFIRMED';

  if (!kind) return null;

  // Try to extract old/new ratings from the headline.
  let oldRating: string | undefined;
  let newRating: string | undefined;
  const arrowMatch = text.match(/\b([A-D]{1,3}[+-]?\d?)\s*(?:to|→|->)\s*([A-D]{1,3}[+-]?\d?)\b/i);
  if (arrowMatch) {
    oldRating = arrowMatch[1];
    newRating = arrowMatch[2];
  } else {
    const tiers = text.match(TIER_RE);
    if (tiers && tiers.length >= 2) {
      oldRating = tiers[0];
      newRating = tiers[1];
    }
  }

  // Outlook extraction
  let oldOutlook: string | undefined;
  let newOutlook: string | undefined;
  const outlookMatch = text.match(/(Stable|Positive|Negative|Developing)\s*(?:to|→)\s*(Stable|Positive|Negative|Developing)/i);
  if (outlookMatch) {
    oldOutlook = outlookMatch[1];
    newOutlook = outlookMatch[2];
  }

  return {
    agency: agency.name,
    kind,
    oldRating,
    newRating,
    oldOutlook,
    newOutlook,
    headline: text.slice(0, 240),
    evidence: `${agency.name} · ${kind.replace('_', ' ')}${newRating ? ` → ${newRating}` : ''}${newOutlook ? ` (outlook ${newOutlook})` : ''}`,
  };
}

export const ACTION_META: Record<RatingActionKind, { color: string; emoji: string; label: string }> = {
  UPGRADE:      { color: '#10b981', emoji: '⬆',  label: 'UPGRADE'     },
  DOWNGRADE:    { color: '#ef4444', emoji: '⬇',  label: 'DOWNGRADE'   },
  OUTLOOK_UP:   { color: '#22d3ee', emoji: '↗',  label: 'OUTLOOK ↑'   },
  OUTLOOK_DOWN: { color: '#f59e0b', emoji: '↘',  label: 'OUTLOOK ↓'   },
  AFFIRMED:     { color: '#94a3b8', emoji: '=',  label: 'AFFIRMED'    },
  ASSIGNED:     { color: '#a78bfa', emoji: '✦',  label: 'ASSIGNED'    },
  WITHDRAWN:    { color: '#f97316', emoji: '✕',  label: 'WITHDRAWN'   },
};
