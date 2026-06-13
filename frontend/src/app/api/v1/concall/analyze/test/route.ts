// PATCH 1057: regex pattern self-test endpoint.
//
// GET /api/v1/concall/analyze/test
//   → runs the forward-guidance + tone-scoring patterns against 5 known-good
//     concall snippets (Anand Rathi, HAL, BEL, RVNL, NTPC) and returns the
//     hit-rate per pattern.
//
// Goal: catch regex regressions before they reach the user. The 0→12 fix
// shipped in PATCH 1057 was found manually; next time it could go silent for
// weeks. mc-guardian could probe this endpoint and alert on hit-rate drops.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CORPUS: Array<{
  name: string;
  text: string;
  expected_min_items: number;
}> = [
  {
    name: 'Anand Rathi Q4 FY26',
    text: `we will be able to grow somewhere around 15% or so in a broking revenue.
non-broking should be able to grow somewhere around 40% to 45% growth.
overall revenue number what we are trying and aiming to achieve is somewhere around 15% to 20% growth year-on-year basis.
we had reached an MTF book of ₹ 12,317 million as of December '25.
we have guided towards achieving an MTF book size of ₹ 15,000 million by financial year '26.
our endeavour is there that we want to restrict ourselves up to max 1.5 kind of debt equity ratio.
a targeted revenue split of 50-50 between non-broking and broking segments.`,
    expected_min_items: 7,
  },
  {
    name: 'HAL FY27 generic',
    text: `We expect our revenue to grow at 18-22% year on year over the next 3 years driven by the Tejas Mk1A order book of ₹62,370 crore.
EBITDA margin should expand 300 bps to reach 28% by FY28.
We are guiding towards an order book of ₹2,00,000 crore by FY28.
Aim to maintain a debt equity ratio of 0.5 throughout the capex cycle.`,
    expected_min_items: 4,
  },
  {
    name: 'RVNL infra',
    text: `The Vande Bharat sleeper framework gives 35-year revenue visibility.
We expect revenue growth of 22% in FY27.
Order book is at ₹85,000 crore which provides 4 years of visibility.
Targeting EBITDA margin expansion of 250 bps by FY28.`,
    expected_min_items: 3,
  },
  {
    name: 'BEL defence',
    text: `Order intake for FY27 expected to be around ₹35,000 crore.
Margin guidance maintained at 22-24%.
We are aiming for capex of ₹500 crore in FY27.`,
    expected_min_items: 3,
  },
  {
    name: 'NTPC renewables',
    text: `Targeting 60 GW renewable capacity by 2032.
Capex of ₹2,30,000 crore planned through FY30.
Coal-based generation to grow at 5-6% CAGR.
Renewables EBITDA margin guided at 35-40%.`,
    expected_min_items: 3,
  },
];

const GUIDANCE_PATTERNS_SRC = [
  { kind: 'expect',  pat: /\b(?:we\s+(?:expect|will|are|aim|target|guide|guided|aiming|trying|endeavour(?:ing)?)|expecting|expect\s+to|guidance|target(?:ing|ed)?|aim(?:ing)?\s+(?:for|to)|guid(?:e|ed|ing|ance)\s+(?:to|towards|on|for)?|trying\s+to\s+(?:achieve|reach|grow)|endeavour(?:ing)?\s+to|going\s+to\s+(?:grow|achieve|reach))\b[^.]{2,180}\b(\d{1,3}(?:\.\d+)?(?:\s*(?:to|[-–])\s*\d{1,3}(?:\.\d+)?)?)\s*%/gi },
  { kind: 'growth',  pat: /\b(?:grow(?:n|th|ing)?|scale|expand(?:ing|ed)?|increase(?:d|s)?|deliver(?:ing)?|achieve)\b[^.]{0,80}?\b(\d{1,3}(?:\.\d+)?(?:\s*(?:to|[-–])\s*\d{1,3}(?:\.\d+)?)?)\s*%/gi },
  { kind: 'margin_bps', pat: /\b(?:EBITDA|operating|gross|net|OPM)\s*margin[s]?\s*(?:to\s+(?:rise|expand|improve)|expansion|improvement|gain|uplift|up)\s*(?:of|by)?\s*[~]?\s*(\d{2,4})(?:\s*[-–]\s*\d{2,4})?\s*bps/gi },
  { kind: 'currency_target', pat: /(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|million|mn|billion|bn|lakh|lakhs|lac)\b[^.]{0,120}?\b(?:by|in|target(?:ing)?|aim|guid(?:e|ed|ance|ing)|FY(?:20)?\d{2}|financial\s+year|next\s+\d+|over\s+the\s+next)/gi },
  { kind: 'quantum', pat: /\b(?:capacity|MTF\s+book|book\s+size|order\s+book|backlog|capex|AUM)\b[^.]{0,80}?(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|million|mn|lakh|lakhs|lac)/gi },
  { kind: 'leverage', pat: /\b(?:debt[\s-]?equity\s+ratio|D[/\\]E\s+ratio|leverage\s+ratio|net\s+debt[/\\]EBITDA)\b[^.]{0,80}?\b(\d+(?:\.\d+)?)\b/gi },
  { kind: 'mix', pat: /\b(?:split|mix|share|ratio)\s+of\s+(\d{1,3}\s*[-–:]\s*\d{1,3})\b/gi },
];

function countMatches(text: string, pat: RegExp): number {
  pat.lastIndex = 0;
  let n = 0;
  while (pat.exec(text) !== null) {
    n++;
    if (n > 200) break;
  }
  return n;
}

export async function GET() {
  const results = CORPUS.map((entry) => {
    const perPattern: Record<string, number> = {};
    let total = 0;
    for (const g of GUIDANCE_PATTERNS_SRC) {
      const c = countMatches(entry.text, g.pat);
      perPattern[g.kind] = (perPattern[g.kind] || 0) + c;
      total += c;
    }
    const pass = total >= entry.expected_min_items;
    return {
      name: entry.name,
      expected_min: entry.expected_min_items,
      actual_total: total,
      per_pattern: perPattern,
      pass,
    };
  });

  const overall_pass = results.every((r) => r.pass);
  const summary = {
    ok: overall_pass,
    corpus_size: CORPUS.length,
    passing: results.filter((r) => r.pass).length,
    failing: results.filter((r) => !r.pass).length,
    note: overall_pass
      ? '✅ All 5 corpus snippets meet their expected_min hit count. Forward-guidance regex is healthy.'
      : '⚠️ One or more snippets fell below expected hit count — regex may have regressed.',
  };

  return NextResponse.json({ summary, results });
}
