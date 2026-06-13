// ═══════════════════════════════════════════════════════════════════════════
// CONCALL INTELLIGENCE ENGINE v2 (PATCH 0107 / 0171)
//
// POST /api/v1/concall/analyze
//   body: { transcript?: string; pdf_url?: string; ticker?: string }
//
// Returns the MRI master-prompt structured analysis:
//   1. Tone & Confidence — directional read, change-vs-prior-quarter
//   2. Guidance Map      — what was promised, raised, lowered, withdrawn
//   3. Key Themes        — top 3-5 catalysts management dwelled on
//   4. Red Flags         — defensive answers, deflections, accounting tells
//   5. Numbers Mentioned — revenue/margin/order-book guidance with deltas
//
// Pure heuristic version: regex extractors + lexicon-based scoring.
// (No LLM dependency — runs entirely on Vercel.  If user later wires in
// an Anthropic key as env, the function can route through Claude for
// deeper analysis; lexicon path is the fallback.)
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// ─── Lexicons (hand-curated from 100+ Indian concalls) ─────────────────────
const POSITIVE_TONE_RE = /\b(strong|robust|record|all[- ]time high|momentum|accelerat|outperform|expand|gaining share|on track|exceeded?|beat|raise|upgrade|optimistic|confident|healthy demand|broad[- ]based|tailwind|operating leverage|margin expansion)\b/gi;
const NEGATIVE_TONE_RE = /\b(soft|sluggish|challenging|head[- ]wind|pressure|destock|inventory correction|moderation|cautious|guidance cut|miss|weak|deceler|impair|write[- ]off|exceptional|one[- ]time|provision|legal contingenc)\b/gi;
const DEFENSIVE_RE = /\b(temporary|transitory|one[- ]time|short[- ]term|long[- ]term story|patient|consistent with our|fully aware|monitoring|appropriate action|prudent|moderate(?:d|s|)? our outlook)\b/gi;

const GUIDANCE_PATTERNS = [
  // ── PATCH 1057 — broader phrasing. Indian concalls rarely use "we expect X%";
  // they say "we will be able to grow somewhere around X%", "aiming to achieve
  // 15-20%", "endeavour to maintain", "guided towards X", etc. Old patterns
  // matched 0 items on real transcripts (e.g. Anand Rathi Q4 FY26).
  //
  // Pattern philosophy: trigger word ANYWHERE in the sentence + a number with
  // %, currency, or bps suffix. Snippet shown to user proves the match.

  // "we expect / target / aim / guide / endeavour / aiming to / trying to" → N% (or N% to M%)
  { kind: 'expect',  re: /\b(?:we\s+(?:expect|will|are|aim|target|guide|guided|aiming|trying|endeavour(?:ing)?)|expecting|expect\s+to|guidance|target(?:ing|ed)?|aim(?:ing)?\s+(?:for|to)|guid(?:e|ed|ing|ance)\s+(?:to|towards|on|for)?|trying\s+to\s+(?:achieve|reach|grow)|endeavour(?:ing)?\s+to|going\s+to\s+(?:grow|achieve|reach))\b[^.]{2,180}\b(\d{1,3}(?:\.\d+)?(?:\s*(?:to|[-\u2013])\s*\d{1,3}(?:\.\d+)?)?)\s*%/gi },

  // "grow / scale / expand / increase" + N% (descriptive growth)
  { kind: 'growth',  re: /\b(?:grow(?:n|th|ing)?|scale|expand(?:ing|ed)?|increase(?:d|s)?|deliver(?:ing)?|achieve)\b[^.]{0,80}?\b(\d{1,3}(?:\.\d+)?(?:\s*(?:to|[-\u2013])\s*\d{1,3}(?:\.\d+)?)?)\s*%/gi },

  // raised / upgraded
  { kind: 'raise',   re: /\b(rais(?:e|ed|ing)|upgrad(?:e|ed)|increased)\s+(?:our\s+)?(?:guidance|outlook|target|expectation)\b[^.]{0,80}\b(\d{1,3}(?:\.\d+)?)\s*%/gi },

  // cut / lowered / moderated
  { kind: 'cut',     re: /\b(lower(?:ed)?|cut|reduc(?:e|ed)|moderat(?:e|ed))\s+(?:our\s+)?(?:guidance|outlook|expectation|target)\b[^.]{0,80}\b(\d{1,3}(?:\.\d+)?)\s*%/gi },

  // withdrew
  { kind: 'withdraw', re: /\b(withdr(?:aw|ew)|suspend(?:ed|ing)?)\s+(?:our\s+)?(guidance|outlook)\b[^.]{0,80}/gi },

  // margin guidance in bps
  { kind: 'margin_bps', re: /\b(?:EBITDA|operating|gross|net|OPM)\s*margin[s]?\s*(?:to\s+(?:rise|expand|improve)|expansion|improvement|gain|uplift|up)\s*(?:of|by)?\s*[~]?\s*(\d{2,4})(?:\s*[-\u2013]\s*\d{2,4})?\s*bps/gi },
  { kind: 'margin_bps', re: /\b(?:we\s+expect|target(?:ing)?|guidance|aim(?:ing)?|guide(?:d)?)\b[^.]{4,100}\b(\d{2,4})\s*bps/gi },
  { kind: 'margin_bps', re: /\b(\d{2,4})\s*bps\s*(?:margin|OPM)\s*(?:expansion|improvement|gain|increase)/gi },

  // ── PATCH 1057: currency-quantum targets — "MTF book of \u20B9 15,000 million by FY26"
  // "\u20B9X crore / Rs X cr / X million by FYxx | financial year"
  { kind: 'currency_target', re: /(?:\u20B9|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|million|mn|billion|bn|lakh|lakhs|lac)\b[^.]{0,120}?\b(?:by|in|target(?:ing)?|aim|guid(?:e|ed|ance|ing)|FY(?:20)?\d{2}|financial\s+year|next\s+\d+|over\s+the\s+next)/gi },

  // "book size of \u20B9X" / "capacity of X MW" — quantum targets
  { kind: 'quantum',  re: /\b(?:capacity|MTF\s+book|book\s+size|order\s+book|backlog|capex|AUM)\b[^.]{0,80}?(?:\u20B9|Rs\.?|INR)\s*([\d,]+(?:\.\d+)?)\s*(crore|cr|million|mn|lakh|lakhs|lac)/gi },

  // "by FY27 / in FY26" + numerical
  { kind: 'fy_target', re: /\b(?:by|in)\s+(?:FY(?:20)?\d{2}|financial\s+year[\s'\"]*\d{2,4}|\d{4})\b[^.]{0,120}?\b(\d{1,5}(?:[.,]\d+)?)\s*(%|crore|cr|million|mn|MW|GW)/gi },

  // leverage / debt-equity targets — "debt equity ratio of X / restrict to 1.5"
  { kind: 'leverage', re: /\b(?:debt[\s-]?equity\s+ratio|D[/\\]E\s+ratio|leverage\s+ratio|net\s+debt[/\\]EBITDA)\b[^.]{0,80}?\b(\d+(?:\.\d+)?)\b/gi },

  // mix / split targets — "split of 50-50 / 60-40 mix"
  { kind: 'mix',     re: /\b(?:split|mix|share|ratio)\s+of\s+(\d{1,3}\s*[-\u2013:]\s*\d{1,3})\b/gi },
];

const NUMBER_PATTERN = /\b(revenue|sales|EBITDA|margin|PAT|profit|order book|backlog|ARR|GMV|EPS|capex|capacity|utilis?ation)\b[^.]{0,80}\b(\d{1,5}(?:[.,]\d+)?)\s*(?:%|crore|cr|bps|million|billion|MW|GW|tons|tonnes)\b/gi;

// ─── Main handler ──────────────────────────────────────────────────────────
async function loadTranscript(pdf_url?: string, transcript?: string): Promise<string> {
  if (transcript && transcript.length > 200) return transcript;
  if (!pdf_url) return '';
  try {
    const res = await fetch(pdf_url, { headers: { 'User-Agent': 'MarketCockpit/1.0' } });
    if (!res.ok) return '';
    const buf = await res.arrayBuffer();
    // Naive UTF-8 string conversion — works for text-extractable PDFs
    // (Adequate for headlines/themes; full PDF parse would need pdf-parse)
    const txt = Buffer.from(buf).toString('utf-8');
    // Strip non-printable, keep alphanumerics + basic punct
    return txt.replace(/[^\x20-\x7E\n]/g, ' ').replace(/\s+/g, ' ');
  } catch { return ''; }
}

function scoreToneConfidence(text: string): { score: number; pos: number; neg: number; defensive: number; label: string } {
  const pos = (text.match(POSITIVE_TONE_RE) || []).length;
  const neg = (text.match(NEGATIVE_TONE_RE) || []).length;
  const defensive = (text.match(DEFENSIVE_RE) || []).length;
  const total = pos + neg;
  const ratio = total > 0 ? pos / total : 0.5;
  // Defensive language drags score even when overall positive
  const defensivePenalty = Math.min(0.25, defensive * 0.02);
  const score = Math.round(Math.max(0, Math.min(100, ratio * 100 - defensivePenalty * 100)));
  const label = score >= 70 ? 'Confident Bullish' :
                score >= 55 ? 'Cautiously Optimistic' :
                score >= 40 ? 'Mixed / Hedged' :
                score >= 25 ? 'Defensive' : 'Bearish';
  return { score, pos, neg, defensive, label };
}

function extractGuidance(text: string): Array<{ kind: string; pct: string | null; snippet: string }> {
  const out: Array<{ kind: string; pct: string | null; snippet: string }> = [];
  const seenSnippets = new Set<string>();
  for (const g of GUIDANCE_PATTERNS) {
    g.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = g.re.exec(text)) !== null) {
      const matchStart = m.index;
      const snippet = text.slice(Math.max(0, matchStart - 40), Math.min(text.length, matchStart + 180));
      const snippetKey = snippet.trim().toLowerCase().slice(0, 80);
      if (seenSnippets.has(snippetKey)) continue;
      seenSnippets.add(snippetKey);
      // PATCH 1057 — kinds with currency/units have number in m[1], unit in m[2]
      const isCurrency = g.kind === 'currency_target' || g.kind === 'quantum';
      const isFyTarget = g.kind === 'fy_target';
      const isLeverage = g.kind === 'leverage';
      const isMix = g.kind === 'mix';
      let pctStr: string | null;
      if (isCurrency) {
        pctStr = m[1] && m[2] ? `${m[1]} ${m[2]}` : null;
      } else if (isFyTarget) {
        pctStr = m[1] && m[2] ? `${m[1]} ${m[2]}` : null;
      } else if (isLeverage) {
        pctStr = m[1] || null;
      } else if (isMix) {
        pctStr = m[1] || null;
      } else {
        pctStr = m[2] || m[1] || null;
      }
      // PATCH 0513 — bps kinds render as 'N bps', not 'N%'
      const isBps = g.kind === 'margin_bps';
      out.push({
        kind: g.kind,
        pct: pctStr ? (
          isBps ? `${pctStr} bps` :
          isCurrency ? `\u20B9${pctStr}` :
          isFyTarget ? pctStr :
          isLeverage ? `D/E ${pctStr}` :
          isMix ? pctStr :
          `${pctStr}%`
        ) : null,
        snippet: snippet.trim(),
      });
      if (out.length >= 20) break;
    }
  }
  return out;
}

function extractNumbers(text: string): Array<{ metric: string; value: string; snippet: string }> {
  const out: Array<{ metric: string; value: string; snippet: string }> = [];
  NUMBER_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_PATTERN.exec(text)) !== null) {
    const matchStart = m.index;
    const snippet = text.slice(Math.max(0, matchStart - 30), Math.min(text.length, matchStart + 120));
    out.push({ metric: m[1], value: m[2], snippet: snippet.trim() });
    if (out.length >= 25) break;
  }
  return out;
}

function extractThemes(text: string): Array<{ theme: string; mentions: number }> {
  const themes: Record<string, RegExp> = {
    'Capacity Expansion':  /\b(commission|new (?:plant|capacity|line)|expansion|brownfield|greenfield|capex)\b/gi,
    'Margin Expansion':    /\b(margin (?:expansion|improvement)|operating leverage|cost optimi[sz]ation)\b/gi,
    'Order Book Growth':   /\b(order (?:book|inflow|win)|backlog|book to bill)\b/gi,
    'New Geography / Export': /\b(export|new geograph|foreign market|US presence|EU expansion)\b/gi,
    'New Product Launch':  /\b(new product|launch(?:ed|ing)? |portfolio expansion|product pipeline)\b/gi,
    'M&A / Inorganic':     /\b(acqui(?:re|sition|red)|merger|inorganic|amalgamation|joint venture|JV)\b/gi,
    'Debt Reduction':      /\b(deleverag|debt reduction|net cash|repaid|paid down)\b/gi,
    'Demand Recovery':     /\b(demand (?:recovery|revival|return|pickup)|volume growth|inquiries)\b/gi,
    'PLI / Govt Incentive':/\b(PLI|production[- ]linked|government scheme|subsidy)\b/gi,
    'AI / Digital':        /\b(AI|artificial intelligence|machine learning|digital transformation|cloud)\b/gi,
  };
  const out: Array<{ theme: string; mentions: number }> = [];
  for (const [theme, re] of Object.entries(themes)) {
    const n = (text.match(re) || []).length;
    if (n >= 1) out.push({ theme, mentions: n });
  }
  return out.sort((a, b) => b.mentions - a.mentions).slice(0, 6);
}

function extractRedFlags(text: string): string[] {
  const flags: string[] = [];
  const checks: Array<{ re: RegExp; label: string }> = [
    { re: /\b(no comment|cannot disclose|won['']t comment|prefer not to)\b/i, label: 'Refusal to answer / no comment' },
    { re: /\b(legal contingenc|litigation|class action|regulatory inquir|notice from (?:SEBI|MCA|RBI))\b/i, label: 'Pending legal / regulatory issue' },
    { re: /\b(qualified opinion|emphasis of matter|going concern|auditor reservation)\b/i, label: 'Audit reservation' },
    { re: /\b(write[- ]off|impair|exceptional charge|one[- ]time loss|provision for)\b/i, label: 'Write-off / exceptional charge' },
    { re: /\b(resignation|stepped down|CFO (?:resign|leave))\b/i, label: 'Key management exit' },
    { re: /\b(restated?|prior[- ]period adjust|reclassif)\b/i, label: 'Restatement / reclassification' },
    { re: /\b(cash flow (?:concern|tight|negative)|stretched|working capital)\b/i, label: 'Working capital / cash flow strain' },
    { re: /\b(receivable.{0,30}(?:overdue|aged|provision))\b/i, label: 'Aged receivables flagged' },
  ];
  for (const c of checks) if (c.re.test(text)) flags.push(c.label);
  return flags;
}

// ─── POST handler ──────────────────────────────────────────────────────────
export async function POST(req: Request) {
  let body: any = {};
  try { body = await req.json(); } catch {}
  const transcript = body?.transcript || '';
  const pdf_url = body?.pdf_url || '';
  const ticker = body?.ticker || '';

  const text = await loadTranscript(pdf_url, transcript);
  if (!text || text.length < 200) {
    return NextResponse.json({ error: 'transcript empty or too short (need 200+ chars)' }, { status: 400 });
  }

  const tone     = scoreToneConfidence(text);
  const guidance = extractGuidance(text);
  const numbers  = extractNumbers(text);
  const themes   = extractThemes(text);
  const flags    = extractRedFlags(text);

  return NextResponse.json({
    ticker: ticker.toUpperCase(),
    length: text.length,
    tone,
    guidance,
    numbers,
    themes,
    red_flags: flags,
    generated_at: new Date().toISOString(),
  });
}
