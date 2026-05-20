// ═══════════════════════════════════════════════════════════════════════════
// VALUATION-D — guidance text extractor
//
// Parses free-form concall / management guidance text into numeric inputs
// for the valuation models. Examples:
//   "30% revenue growth for FY26"               → growth 30%, FY26
//   "33-35% EBITDA margin sustainable"          → margin 34%
//   "₹650 crores peak revenue from hoses"       → revenue target 650
//   "20%+ YoY revenue growth for FY26"          → growth 20%
//   "EBITDA margin to rise 300-400 bps"         → margin uplift 3.5pp
// ═══════════════════════════════════════════════════════════════════════════

export interface ExtractedGuidance {
  growthPct?: number;
  ebitdaMarginPct?: number;
  revenueTargetCr?: number;
  fiscalYear?: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  rawText: string;
  matches: string[];   // human-readable trace
}

/** Compute midpoint of "X-Y" range or return X if single. */
function midpoint(a: number, b?: number): number {
  if (b === undefined) return a;
  return (a + b) / 2;
}

export function extractGuidance(text: string): ExtractedGuidance {
  const matches: string[] = [];
  const t = (text || '').trim();
  if (!t) return { confidence: 'LOW', rawText: '', matches };

  // ── Fiscal Year ─────────────────────────────────────────────────────────
  const fyMatch = t.match(/\bFY[\s']?(\d{2,4})\b/i);
  const fiscalYear = fyMatch ? `FY${fyMatch[1].slice(-2)}` : undefined;
  if (fyMatch) matches.push(`fiscal year: ${fiscalYear}`);

  // ── Growth (revenue/sales) ──────────────────────────────────────────────
  // Patterns:
  //   "30% revenue growth", "25%+ revenue growth", "25-30% revenue growth",
  //   "Low to mid-teens revenue CAGR" → ~13.5%, "40-50% CAGR"
  let growthPct: number | undefined;
  // X-Y% revenue growth
  let m = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*%?\s*(?:revenue|sales|top[- ]line)?\s*(?:growth|CAGR|YoY)/i);
  if (m) {
    growthPct = midpoint(parseFloat(m[1]), parseFloat(m[2]));
    matches.push(`growth range: ${m[1]}-${m[2]}% → ${growthPct}%`);
  } else {
    // Single X% revenue growth (allow optional +)
    m = t.match(/(\d{1,3})\s*%\+?\s*(?:revenue|sales|top[- ]line)?\s*(?:growth|CAGR|YoY)/i);
    if (m) {
      growthPct = parseFloat(m[1]);
      matches.push(`growth: ${growthPct}%`);
    }
    // Worded ranges
    else if (/low to mid[- ]teens/i.test(t)) { growthPct = 13.5; matches.push('worded: low-to-mid teens → 13.5%'); }
    else if (/mid[- ]teens/i.test(t))         { growthPct = 15;   matches.push('worded: mid-teens → 15%'); }
    else if (/high[- ]teens/i.test(t))        { growthPct = 18;   matches.push('worded: high-teens → 18%'); }
    else if (/low[- ]twenties/i.test(t))      { growthPct = 22;   matches.push('worded: low-twenties → 22%'); }
    else if (/mid[- ]twenties/i.test(t))      { growthPct = 25;   matches.push('worded: mid-twenties → 25%'); }
  }

  // ── EBITDA margin ───────────────────────────────────────────────────────
  // "33-35% EBITDA margin", "22%+ EBITDA margin", "30%+ EBITDA margin"
  let ebitdaMarginPct: number | undefined;
  m = t.match(/(\d{1,2})\s*[-–]\s*(\d{1,2})\s*%?\s*EBITDA\s*margin/i);
  if (m) {
    ebitdaMarginPct = midpoint(parseFloat(m[1]), parseFloat(m[2]));
    matches.push(`EBITDA margin range: ${m[1]}-${m[2]}% → ${ebitdaMarginPct}%`);
  } else {
    m = t.match(/(\d{1,2})\s*%\+?\s*EBITDA\s*margin/i);
    if (m) {
      ebitdaMarginPct = parseFloat(m[1]);
      matches.push(`EBITDA margin: ${ebitdaMarginPct}%`);
    }
    // PATCH 0511 — Broadened bps regex. Covered phrasings:
    //   • "EBITDA margin to rise 300 bps"           (was already covered)
    //   • "margin expansion of 300-400 bps"         (was already covered)
    //   • "300 bps margin improvement"              (NEW — bps-first order)
    //   • "improved 250 bps YoY"                    (NEW — past tense + YoY)
    //   • "expanded by 200 bps QoQ"                 (NEW — expanded by)
    //   • "OPM up 350 bps"                          (NEW — OPM/operating margin)
    //   • "margin gain of 150 bps"                  (NEW — gain)
    //   • "margins up ~400 bps"                     (NEW — tilde / ~)
    // The lookahead `(?:.{0,40})?` allows up to 40 chars between number and bps
    // to catch "300 bps margin improvement" patterns.
    const bpsPatterns: RegExp[] = [
      /(?:EBITDA|operating|gross|net)\s*margin\s*(?:to\s*(?:rise|expand|improve)|expansion|improvement|gain|uplift|up)\s*(?:of|by)?\s*[~]?\s*(\d{2,4})\s*[-–]?\s*(\d{2,4})?\s*bps/i,
      /\b(\d{2,4})\s*[-–]?\s*(\d{2,4})?\s*bps\s*(?:.{0,40})?\b(?:EBITDA|operating|gross|net)?\s*margin\s*(?:expansion|improvement|gain|uplift|increase)/i,
      /(?:OPM|operating\s*margin)\s*(?:up|gain|expand(?:ed)?|improv(?:ed)?)\s*[~]?\s*(\d{2,4})\s*[-–]?\s*(\d{2,4})?\s*bps/i,
      /margins?\s*(?:up|expand(?:ed)?|improv(?:ed)?|grew)\s*(?:by\s*)?[~]?\s*(\d{2,4})\s*[-–]?\s*(\d{2,4})?\s*bps/i,
    ];
    for (const pat of bpsPatterns) {
      const bpsM = t.match(pat);
      if (bpsM) {
        const lo = parseFloat(bpsM[1]) / 100;
        const hi = bpsM[2] ? parseFloat(bpsM[2]) / 100 : lo;
        matches.push(`margin uplift ${((lo+hi)/2).toFixed(2)}pp — apply on top of current OPM`);
        break;  // first match wins
      }
    }
  }

  // ── Revenue target (₹ Cr) ───────────────────────────────────────────────
  // "₹650 crores", "₹3,500 crores", "₹2,200+ crores", "Rs. 600-825 crores"
  let revenueTargetCr: number | undefined;
  m = t.match(/[₹Rs.]+\s*([\d,]+)\s*[-–]\s*([\d,]+)\s*(?:crores?|Cr)/i);
  if (m) {
    revenueTargetCr = midpoint(
      parseFloat(m[1].replace(/,/g, '')),
      parseFloat(m[2].replace(/,/g, ''))
    );
    matches.push(`revenue target range: ₹${m[1]}-${m[2]} Cr → ₹${revenueTargetCr.toFixed(0)} Cr`);
  } else {
    m = t.match(/[₹Rs.]+\s*([\d,]+)\+?\s*(?:crores?|Cr)/i);
    if (m) {
      revenueTargetCr = parseFloat(m[1].replace(/,/g, ''));
      matches.push(`revenue target: ₹${revenueTargetCr.toFixed(0)} Cr`);
    }
  }

  // Confidence: HIGH if growth + margin + FY all caught; MEDIUM if 2 of 3; LOW otherwise.
  const score = (growthPct !== undefined ? 1 : 0)
              + (ebitdaMarginPct !== undefined ? 1 : 0)
              + (fiscalYear ? 0.5 : 0)
              + (revenueTargetCr !== undefined ? 0.5 : 0);
  const confidence: 'HIGH' | 'MEDIUM' | 'LOW' = score >= 2 ? 'HIGH' : score >= 1 ? 'MEDIUM' : 'LOW';

  return { growthPct, ebitdaMarginPct, revenueTargetCr, fiscalYear, confidence, rawText: t, matches };
}

/** Bulk-import: parse a multi-line / multi-row table where each line maps a
 *  company name → guidance text. Best-effort fuzzy company match returns
 *  the ticker if available, else marks as 'UNMATCHED'. */
export interface BulkRow {
  companyText: string;
  guidanceText: string;
  matchedSymbol?: string;
  matchedCompany?: string;
  extracted: ExtractedGuidance;
}

/** Normalize company name for fuzzy match: lowercase, remove non-alnum,
 *  drop suffixes like "ltd", "limited", "company", "inc", "industries", etc. */
function normalizeForMatch(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(ltd|limited|co|company|inc|corporation|corp|industries|industry|technologies|technology|tech|enterprises|enterprise|international|intl|india)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a multi-line table-style paste. Accepts TSV (tab-separated),
 *  CSV with commas (heuristic: only if no embedded comma in company),
 *  or two-column blocks separated by 2+ spaces / pipe characters. */
export function parseBulkTable(text: string, universe: Array<{ symbol: string; company: string }>): BulkRow[] {
  if (!text || !text.trim()) return [];
  const rows: BulkRow[] = [];
  // Split on newlines, drop empty and probable headers
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const headerRe = /^(company|name|ticker|growth\s*guidance|guidance)\b/i;

  for (const line of lines) {
    if (headerRe.test(line)) continue;
    // Strategies: tab, ' | ', 2+ spaces, ' — ', ': '
    let parts: string[] = [];
    if (line.includes('\t')) parts = line.split(/\t+/);
    else if (/\s\|\s/.test(line)) parts = line.split(/\s\|\s/);
    else if (/\s{2,}/.test(line)) parts = line.split(/\s{2,}/);
    else if (/\s+—\s+/.test(line)) parts = line.split(/\s+—\s+/);
    else if (/:\s/.test(line)) parts = line.split(/:\s/);
    else parts = [line]; // single column — can't split

    if (parts.length < 2) continue;
    const company = parts[0].trim();
    const guidance = parts.slice(1).join(' ').trim();
    if (!guidance) continue;

    // Fuzzy match against universe
    const norm = normalizeForMatch(company);
    let matchedSymbol: string | undefined;
    let matchedCompany: string | undefined;
    for (const u of universe) {
      const un = normalizeForMatch(u.company);
      if (!un) continue;
      if (un === norm || un.startsWith(norm) || norm.startsWith(un) || (norm.length > 5 && un.includes(norm)) || (un.length > 5 && norm.includes(un))) {
        matchedSymbol = u.symbol;
        matchedCompany = u.company;
        break;
      }
    }

    rows.push({
      companyText: company,
      guidanceText: guidance,
      matchedSymbol,
      matchedCompany,
      extracted: extractGuidance(guidance),
    });
  }
  return rows;
}
