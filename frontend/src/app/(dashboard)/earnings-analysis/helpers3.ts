// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import type { AutoValuationReport } from '@/app/(dashboard)/auto-valuation/engine';
import { MUTED, NARRATIVE_THEMES, THEME_MIN_MATCHES, GREEN, RED, YELLOW, HISTORY_KEY2 } from './constants';
import { type EngineOutput, type RawFinancials, type ThemeDetection, type HistEntry2 } from './types';

// ── VALUATION BRIDGE ─────────────────────────────────────────────────────────
// Compute the BASE-CASE average upside% across the auto-valuation report's
// P/E · P/S · EV/EBITDA calculators (mirrors buildReport's own avgBaseUpside
// derivation in auto-valuation/engine.ts). Returns undefined when the report is
// null/empty or the average is not finite, so the scorer contributes 0.
export function baseCaseUpsideFromReport(report: AutoValuationReport | null | undefined): number | undefined {
  if (!report) return undefined;
  const upsides = [report.peResult, report.psResult, report.evResult]
    .flatMap(r => {
      const c = r?.cases?.find(cc => cc.label === 'BASE');
      return (c && Number.isFinite(c.upsidePct)) ? [c.upsidePct] : [];
    });
  if (upsides.length === 0) return undefined;
  const avg = upsides.reduce((a, b) => a + b, 0) / upsides.length;
  return Number.isFinite(avg) ? avg : undefined;
}
// ── ENGINE 1: ACCOUNTING QUALITY ─────────────────────────────────────────────

// ── DATA QUALITY GATE: Returns a failure output when data is too unreliable to score ──
export function dataQualityFail(label: string, reason?: string): EngineOutput {
  return {
    score: 0, grade: 'N/A', color: MUTED, label,
    signals: [{ type:'amber', text: reason || 'Parse state FAILED — revenue or key metrics could not be extracted. Scores require validated numbers.', weight:0 }],
    summary: 'Cannot score — extraction validation failed.',
  };
}
/** Count how many key financial metrics are actually available (non-null) */
export function countValidMetrics(d: RawFinancials): number {
  return [d.revenue, d.grossMargin, d.pat, d.ebit, d.cfo].filter(v => v !== null).length;
}
export function scoreAccountingQuality(d: RawFinancials, valUpside?: number): EngineOutput {
  // GATE 1: Parse state determines whether scoring is allowed at all
  if (d.parseState === 'failed') {
    return dataQualityFail('Accounting Quality', `Parse state: FAILED (confidence ${d.parseConfidence}%) — revenue extraction failed, no scores generated`);
  }
  // GATE 2: Not enough valid metrics even in 'partial' state
  if (countValidMetrics(d) < 2) {
    return dataQualityFail('Accounting Quality');
  }

  const sigs: EngineOutput['signals'] = [];
  // Recalibrated: start at 40 (not 50) — quality must be earned
  let score = 40;

  // Gross margin — only score if within valid range (firewall already nullified impossible values)
  if (d.grossMargin !== null) {
    if (d.grossMargin >= 50)      { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — premium pricing power`, weight:8 }); score+=8; }
    else if (d.grossMargin >= 30) { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — healthy`, weight:4 }); score+=4; }
    else if (d.grossMargin < 10)  { sigs.push({ type:'red',   text:`Gross margin ${d.grossMargin.toFixed(1)}% — extremely thin`, weight:7 }); score-=7; }
  }

  // EBITDA margin
  if (d.ebitdaMargin !== null) {
    if (d.ebitdaMargin >= 25)    { sigs.push({ type:'green',  text:`EBITDA margin ${d.ebitdaMargin.toFixed(1)}% — strong`, weight:5 }); score+=5; }
    else if (d.ebitdaMargin >= 10){ sigs.push({ type:'green',  text:`EBITDA margin ${d.ebitdaMargin.toFixed(1)}%`, weight:3 }); score+=3; }
    else if (d.ebitdaMargin < 0) { sigs.push({ type:'red',    text:`Negative EBITDA ${d.ebitdaMargin.toFixed(1)}%`, weight:8 }); score-=8; }
  }

  // Leverage
  if (d.deRatio !== null) {
    if (d.deRatio <= 0.1)      { sigs.push({ type:'green', text:`Virtually debt-free D/E=${d.deRatio.toFixed(2)}x`, weight:8 }); score+=8; }
    else if (d.deRatio <= 0.5) { sigs.push({ type:'green', text:`Conservative leverage D/E=${d.deRatio.toFixed(2)}x`, weight:4 }); score+=4; }
    else if (d.deRatio > 2.0)  { sigs.push({ type:'red',   text:`High leverage D/E=${d.deRatio.toFixed(2)}x`, weight:7 }); score-=7; }
  }

  if (d.cash !== null && d.totalDebt !== null && d.cash > d.totalDebt) {
    sigs.push({ type:'green', text:'Net cash — cash exceeds total debt', weight:6 }); score+=6;
  }

  // Cash conversion — only if pat is valid
  if (d.cfoPat !== null && d.pat !== null && d.pat > 0) {
    if (d.cfoPat >= 1.0)      { sigs.push({ type:'green',  text:`Excellent cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:8 }); score+=8; }
    else if (d.cfoPat >= 0.6) { sigs.push({ type:'green',  text:`Good cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:4 }); score+=4; }
    else if (d.cfoPat < 0.3)  { sigs.push({ type:'red',    text:`Low cash conversion CFO/PAT=${d.cfoPat.toFixed(2)}x`, weight:6 }); score-=6; }
  } else if (d.cfo !== null && d.cfo < 0 && d.pat !== null) {
    sigs.push({ type:'red', text:'Negative operating cash flow', weight:7 }); score-=7;
  }

  // FCF
  if (d.fcf !== null) {
    if (d.fcf > 0) { sigs.push({ type:'green', text:`FCF positive`, weight:4 }); score+=4; }
    else { sigs.push({ type:'amber', text:`FCF negative (may reflect investment phase)`, weight:2 }); score-=2; }
  }

  // Returns — only if validated
  if (d.roce !== null && d.roce >= 20) { sigs.push({ type:'green', text:`ROCE ${d.roce.toFixed(1)}% — above cost of capital`, weight:5 }); score+=5; }
  if (d.roe !== null && d.roe >= 15)   { sigs.push({ type:'green', text:`ROE ${d.roe.toFixed(1)}%`, weight:3 }); score+=3; }

  // Penalise if operating loss
  if (d.ebit !== null && d.ebit < 0) { score -= 8; }

  // Data quality caveat
  if (!d.isDataReliable) {
    sigs.push({ type:'amber', text:'⚠ Some extraction inconsistencies detected — treat scores as indicative', weight:0 });
    score = Math.min(score, 65); // Hard cap when uncertain
  }

  // ── VALUATION UPSIDE (base case) — ~10% weight (capped ±8) ─────────────────
  // Wired from InlineValuationPanel's auto-valuation report (P/E · P/S ·
  // EV/EBITDA base-case average upside). Graceful: if no report is present or
  // the upside is not finite, contribute 0 and push no signal. Applied BEFORE
  // the final clamp so it can never push the score past the existing bounds.
  if (typeof valUpside === 'number' && Number.isFinite(valUpside)) {
    const u = valUpside;
    let weight = 0;
    if (u >= 40) weight = 8;
    else if (u >= 20) weight = 5;
    else if (u >= 8) weight = 3;
    else if (u <= -40) weight = -8;
    else if (u <= -20) weight = -5;
    else if (u <= -8) weight = -3;
    if (weight !== 0) {
      sigs.push({ type: weight > 0 ? 'green' : 'red', text: `Valuation upside ${u>0?'+':''}${Math.round(u)}% (base case)`, weight });
      score += weight;
    }
  }

  // Recalibrated cap: max 88 (not 95) — 90+ should be extremely rare
  score = Math.max(5, Math.min(88, score));
  const grade = score >= 78 ? 'A+' : score >= 68 ? 'A' : score >= 58 ? 'B+' : score >= 46 ? 'B' : score >= 33 ? 'C' : 'D';
  const col = score >= 68 ? '#10b981' : score >= 53 ? '#f59e0b' : score >= 33 ? '#f97316' : '#ef4444';
  return {
    score, grade, color: col, label: 'Accounting Quality', signals: sigs,
    summary: score >= 70 ? 'Solid balance sheet and cash quality' : score >= 50 ? 'Moderate quality — monitor leverage and cash' : 'Quality concerns — dig into balance sheet',
  };
}
// ── ENGINE 2: EARNINGS REACTION PROBABILITY ───────────────────────────────────
// Measures surprise vs expectations, inflection, guidance, narrative, positioning.
// RECALIBRATED: scores are deliberately conservative. 80+ = genuine strong setup.

export function scoreEarningsReaction(d: RawFinancials): EngineOutput {
  // GATE: parseState controls whether reaction scoring is allowed
  if (d.parseState === 'failed') return dataQualityFail('Earnings Reaction', `Parse state FAILED — no reaction score without valid revenue`);
  if (!d.revenue || d.revenue <= 0) return dataQualityFail('Earnings Reaction', 'Revenue not extracted — cannot compute reaction probability');

  const sigs: EngineOutput['signals'] = [];
  // Start at 30 (not 40) — reaction probability is harder to earn
  let score = 30;

  // ── Revenue Acceleration ────────────────────────────────────────────────
  if (d.revenue && d.revPrior && d.revPrior > 0) {
    const g = ((d.revenue - d.revPrior) / d.revPrior) * 100;
    if (g >= 40)       { sigs.push({ type:'green', text:`Revenue acceleration +${g.toFixed(1)}% YoY`, weight:15 }); score+=15; }
    else if (g >= 20)  { sigs.push({ type:'green', text:`Revenue growth +${g.toFixed(1)}% YoY — meaningful`, weight:10 }); score+=10; }
    else if (g >= 10)  { sigs.push({ type:'green', text:`Revenue growth +${g.toFixed(1)}% YoY`, weight:5 }); score+=5; }
    else if (g < 0)    { sigs.push({ type:'red',   text:`Revenue decline ${g.toFixed(1)}% YoY — negative catalyst`, weight:12 }); score-=12; }
    else if (g < 5)    { sigs.push({ type:'amber', text:`Slow revenue growth +${g.toFixed(1)}% — weak catalyst`, weight:4 }); score-=4; }
  }

  // ── MARGIN INFLECTION — powerful catalyst (only use validated margins) ────
  if (d.grossMargin !== null) {
    if (d.grossMargin >= 50)      { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}% — premium level`, weight:12 }); score+=12; }
    else if (d.grossMargin >= 35) { sigs.push({ type:'green', text:`Gross margin ${d.grossMargin.toFixed(1)}%`, weight:7 }); score+=7; }
    else if (d.grossMargin >= 20) { sigs.push({ type:'amber', text:`Gross margin ${d.grossMargin.toFixed(1)}% — moderate`, weight:3 }); score+=3; }
    else if (d.grossMargin < 10)  { sigs.push({ type:'red',   text:`Gross margin ${d.grossMargin.toFixed(1)}% — thin`, weight:5 }); score-=5; }
  }
  if (d.ebitdaMargin !== null && d.ebitdaMargin > 0) {
    sigs.push({ type:'green', text:`Positive EBITDA margin ${d.ebitdaMargin.toFixed(1)}%`, weight:7 }); score+=7;
  } else if (d.ebitdaMargin !== null && d.ebitdaMargin < 0 && d.ebitdaMargin > -5) {
    sigs.push({ type:'amber', text:`Near-breakeven EBITDA — path to profitability`, weight:4 }); score+=4;
  }

  // ── GUIDANCE / FORWARD SIGNALS ─────────────────────────────────────────
  const guidanceText = [...d.guidance, ...d.forwardStatements].join(' ').toLowerCase();
  if (/(?:pipeline|billion|contract|backlog)\s+(?:in excess of|exceeds?|of\s+over)\s+[\$₹]?\d/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Quantified large pipeline — strong forward catalyst', weight:15 }); score+=15;
  } else if (/pipeline|backlog|order book|rpm|rpo|arr/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Pipeline/backlog commentary — positive forward signal', weight:7 }); score+=7;
  }
  if (/raised guidance|raised.*outlook|above guidance|ahead of guidance|reaffirm.*growth|raised.*full year/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Guidance raised or reaffirmed', weight:12 }); score+=12;
  }
  if (/positive.*ebitda|positive adjusted ebitda|first time.*positive|milestone.*profit|adjusted.*profitable/.test(guidanceText)) {
    sigs.push({ type:'green', text:'Profitability milestone — inflection catalyst', weight:10 }); score+=10;
  }

  // ── MANAGEMENT TONE ─────────────────────────────────────────────────────
  if (d.mgmtTone === 'bullish')   { sigs.push({ type:'green',  text:'Management tone: confident/bullish', weight:5 }); score+=5; }
  else if (d.mgmtTone === 'cautious') { sigs.push({ type:'amber', text:'Management tone: cautious/hedged', weight:3 }); score-=3; }

  // ── NARRATIVE THEMES ────────────────────────────────────────────────────
  const hotThemes = d.themes.filter(t => ['AI_INFRA','EDGE_COMPUTE','CDN_EDGE','DEFENSE','DEFENSE_AI'].includes(t));
  if (hotThemes.length >= 2) {
    sigs.push({ type:'green', text:`${hotThemes.length} premium themes — AI/Defense/Edge narrative`, weight:10 }); score+=10;
  } else if (hotThemes.length === 1) {
    const tName = NARRATIVE_THEMES.find(n => n.tag === hotThemes[0])?.label ?? hotThemes[0];
    sigs.push({ type:'green', text:`Theme exposure: ${tName}`, weight:5 }); score+=5;
  }

  // ── PAT TRAJECTORY ────────────────────────────────────────────────────
  if (d.pat !== null && d.patPrior !== null && d.patPrior !== 0 && d.pat !== null) {
    const pg = ((d.pat - d.patPrior) / Math.abs(d.patPrior)) * 100;
    if (d.pat > 0 && d.patPrior < 0) { sigs.push({ type:'green', text:'Loss → profit inflection — strong catalyst', weight:12 }); score+=12; }
    else if (pg >= 50 && d.pat > 0) { sigs.push({ type:'green', text:`Profit up +${pg.toFixed(0)}% YoY`, weight:7 }); score+=7; }
    else if (pg < -50) { sigs.push({ type:'red', text:`Profit down ${pg.toFixed(0)}% YoY`, weight:8 }); score-=8; }
  }

  // ── DISCONTINUED OPS — only if genuinely confirmed ─────────────────────
  if (d.continuingOpsDetected) {
    sigs.push({ type:'neutral', text:'Discontinued ops flag — verify source before trading on this', weight:0 });
  }

  // Recalibrated: max 85 — true 90+ reactions are rare
  score = Math.max(8, Math.min(85, score));
  const grade = score >= 75 ? 'A+' : score >= 63 ? 'A' : score >= 50 ? 'B+' : score >= 35 ? 'B' : 'C';
  const col = score >= 63 ? '#10b981' : score >= 48 ? '#f59e0b' : score >= 33 ? '#f97316' : '#ef4444';
  return {
    score, grade, color: col,
    label: 'Earnings Reaction',
    signals: sigs,
    summary: score >= 68
      ? 'Strong reaction setup — revenue acceleration + margin + narrative'
      : score >= 50
      ? 'Moderate reaction potential — mixed catalysts'
      : 'Weak reaction probability — limited surprise or catalysts',
  };
}
export function scoreNarrative(d: RawFinancials): EngineOutput & { themeList: typeof NARRATIVE_THEMES; themeDetections: ThemeDetection[] } {
  const sigs: EngineOutput['signals'] = [];
  let score = 10; // Must earn it — start lower

  // Build theme detections with confidence scores
  const themeDetections: ThemeDetection[] = [];
  for (const theme of NARRATIVE_THEMES) {
    const minMatch = THEME_MIN_MATCHES[theme.tag] ?? 1;
    const matchCount = theme.keywords.filter(kw => d.themes.includes(theme.tag) ? true : false).length;
    // Use the already-computed themes list — just assign confidence based on which tag matched
    if (!d.themes.includes(theme.tag)) continue;
    // Confidence = based on theme type and how specific the keywords are
    const HOT_TAGS = new Set(['AI_INFRA','EDGE_COMPUTE','CDN_EDGE','DEFENSE','DEFENSE_AI']);
    const isHot = HOT_TAGS.has(theme.tag);
    // Conservative confidence: hot themes with specific keyword matches = 75%, others = 50%
    const confidence = isHot ? 75 : 50;
    const tier: ThemeDetection['tier'] = confidence >= 70 ? 'core' : confidence >= 40 ? 'adjacent' : 'weak';
    themeDetections.push({ theme, confidence, tier });
  }

  const coreThemes = themeDetections.filter(t => t.tier === 'core');
  const adjThemes = themeDetections.filter(t => t.tier === 'adjacent');

  if (coreThemes.length >= 3) {
    sigs.push({ type:'green', text:`${coreThemes.length} core themes — strong thematic identity`, weight:25 }); score+=25;
  } else if (coreThemes.length >= 2) {
    sigs.push({ type:'green', text:`${coreThemes.length} core themes`, weight:15 }); score+=15;
  } else if (coreThemes.length >= 1) {
    sigs.push({ type:'green', text:`1 core theme: ${coreThemes[0].theme.label}`, weight:8 }); score+=8;
  }

  if (adjThemes.length >= 1) {
    sigs.push({ type:'neutral', text:`${adjThemes.length} adjacent theme(s) — peripheral exposure`, weight:3 });
    score+=3;
  }

  // Pipeline/TAM — only score if there's a specific quantification
  if (d.guidance.some(g => /(?:billion|multi-billion|\$[1-9]\d*b|billion dollar)\s+(?:opportunity|market|pipeline|tam)/.test(g.toLowerCase()))) {
    sigs.push({ type:'green', text:'Billion-dollar TAM or pipeline referenced', weight:8 }); score+=8;
  }

  // Penalise for having ZERO themes (company in un-exciting sector)
  if (coreThemes.length === 0 && adjThemes.length === 0) {
    sigs.push({ type:'neutral', text:'No premium thematic narrative detected — sector/timing may limit multiple expansion', weight:0 });
  }

  // RECALIBRATED: max 80 (not 95) — 90+ only for genuine 3-theme AI/defense/edge plays
  score = Math.max(5, Math.min(80, score));
  const grade = score >= 65 ? 'A' : score >= 50 ? 'B' : score >= 30 ? 'C' : 'D';
  const col = score >= 65 ? '#a78bfa' : score >= 50 ? '#818cf8' : score >= 30 ? '#6366f1' : '#4338ca';
  const allFound = themeDetections.map(t => t.theme);
  return {
    score, grade, color: col,
    label: 'Narrative / Theme',
    signals: sigs,
    summary: coreThemes.length >= 2
      ? `Core: ${coreThemes.slice(0,2).map(t=>t.theme.label).join(', ')}`
      : coreThemes.length === 1
      ? `Theme: ${coreThemes[0].theme.label}`
      : 'No strong thematic premium',
    themeList: allFound,
    themeDetections,
  };
}
// ═════════════════════════════════════════════════════════════════════════════
// DISPLAY HELPERS
// ═════════════════════════════════════════════════════════════════════════════

/*
 * PATCH 0965 BUG #5 — Wrong currency symbol for Indian stocks.
 *
 * Root cause: The Concall AI cards (rendered from earnings-analysis/page.tsx)
 * hard-coded `$` for per-share values (EPS actual/estimate) and for forward
 * estimates (FMP Revenue Next Q, FMP EPS Current FY, Analyst Target Price).
 * For Indian tickers (e.g. KIRLOSKAR.NS) those cells displayed "$10.91"
 * even though `d.currency === 'INR'` was set correctly by the fetch path.
 *
 * Fix: a centralized `formatCurrency(value, ticker, opts)` helper that
 * inspects the ticker suffix (.NS / .BO → India), and falls back to a
 * heuristic for bare uppercase symbols typical of NSE (no suffix but
 * 5-12 uppercase letters → assume Indian). Apply the helper to every
 * `$`-prefixed financial value in the Concall AI surface — EPS, Revenue,
 * PAT, Market Cap, and the Analyst Target Price chip.
 *
 * For large Indian values (>= 1 Cr = 10_000_000) we render `₹X.X Cr`
 * automatically; smaller absolute values render as `₹X.XX`. USD values
 * keep the existing decimals/abbreviation behaviour.
 *
 * HEURISTIC (documented): "bare uppercase NSE symbol" = a ticker that has
 * no exchange suffix, is all uppercase, and is between 4 and 12 chars
 * (KIRLOSKAR, HDFCBANK, BHARTIARTL etc.). US tickers tend to be 1-4
 * letters (NVDA, TSLA, AMZN, BRK.B) so the >=5 length boundary keeps the
 * false-positive rate near zero. When the ticker is empty/unknown we
 * default to USD (existing behavior).
 */
// PATCH 0966a — NOT exported. Next.js page files reject non-standard value
// exports (same constraint we hit on route.ts in P0962a). Function is only
// used inside this file; module-local works fine.
export function formatCurrency(
  value: number | null | undefined,
  ticker: string | null | undefined,
  opts: { decimals?: number; unit?: 'cr' | 'lakh' | 'none'; abbrev?: boolean } = {},
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const decimals = opts.decimals ?? 2;
  const t = (ticker || '').toUpperCase();
  // Suffix-based detection (authoritative).
  const isIndianSuffix = /(\.NS|\.BO)$/i.test(t);
  // Fallback heuristic for bare uppercase NSE-style symbols (no suffix).
  // Length >= 5 keeps US tickers (NVDA, TSLA, AMZN, META, AAPL) safe.
  const isIndianHeuristic =
    !isIndianSuffix && /^[A-Z][A-Z0-9&-]{4,11}$/.test(t) && !/\./.test(t);
  const isIndian = isIndianSuffix || isIndianHeuristic;
  const sym = isIndian ? '₹' : '$';
  const abs = Math.abs(value);
  const neg = value < 0;
  let body: string;
  if (isIndian && opts.unit !== 'none' && abs >= 1_00_00_000) {
    // ≥ 1 Cr in raw rupees → display as Cr
    body = `${(abs / 1_00_00_000).toFixed(1)} Cr`;
  } else if (opts.abbrev && abs >= 1e9) {
    body = `${(abs / 1e9).toFixed(2)}B`;
  } else if (opts.abbrev && abs >= 1e6) {
    body = `${(abs / 1e6).toFixed(2)}M`;
  } else {
    body = abs.toFixed(decimals);
  }
  return neg ? `(${sym}${body})` : `${sym}${body}`;
}
export function n(v: number|null, d: RawFinancials, decimals = 1): string {
  if (v === null) return '—';
  const abs = Math.abs(v);
  const sym = d.currency === 'USD' ? '$' : d.currency === 'INR' ? '₹' : '';
  const isMn = d.scaleLabel.includes('Mn') || d.scaleLabel.includes('$');
  const isCr = d.scaleLabel.includes('Cr') || d.scaleLabel.includes('₹');

  // Unit-aware display: NEVER create nonsense like "$16K Mn" or "₹400K Cr"
  // When the value is already in Mn, scale up to Bn for large values:
  let formatted: string;
  if (isMn) {
    if (abs >= 1000)       formatted = `${sym}${(v/1000).toFixed(1)} Bn`;  // $16K Mn → $16.0 Bn
    else if (abs >= 0.1)   formatted = `${sym}${abs.toFixed(decimals)} Mn`;
    else if (abs > 0)      formatted = `${sym}${abs.toFixed(3)} Mn`;
    else                   formatted = `${sym}0 Mn`;
  } else if (isCr) {
    if (abs >= 10000)      formatted = `₹${(v/1000).toFixed(1)}K Cr`;     // ₹41000 Cr → ₹41.0K Cr
    else if (abs >= 0.1)   formatted = `₹${abs.toFixed(decimals)} Cr`;
    else if (abs > 0)      formatted = `₹${abs.toFixed(3)} Cr`;
    else                   formatted = `₹0 Cr`;
  } else {
    // Generic fallback (no clear unit)
    if (abs >= 1e9)        formatted = `${sym}${(v/1e9).toFixed(1)}B`;
    else if (abs >= 1e6)   formatted = `${sym}${(v/1e6).toFixed(1)}M`;
    else if (abs >= 1e3)   formatted = `${sym}${(v/1e3).toFixed(1)}K`;
    else                   formatted = `${sym}${abs.toFixed(decimals)}`;
  }
  return v < 0 ? `(${formatted.replace(sym, '')})`.replace('(', `(${sym}`) : formatted;
}
export function pct(v: number|null): string { return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`; }
export function growth(cur: number|null, prior: number|null): { text: string; col: string }|null {
  if (cur === null || prior === null || prior === 0) return null;
  const g = ((cur - prior) / Math.abs(prior)) * 100;
  return { text: `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`, col: g >= 0 ? GREEN : RED };
}
export function mColor(v: number|null, good: number, ok: number): string {
  if (v === null) return MUTED;
  return v >= good ? GREEN : v >= ok ? YELLOW : RED;
}
export function loadHist2(): HistEntry2[] { try { return JSON.parse(localStorage.getItem(HISTORY_KEY2)||'[]'); } catch { return []; } }
export function saveHist2(e: HistEntry2[]) { try { localStorage.setItem(HISTORY_KEY2, JSON.stringify(e.slice(0,20))); } catch {} }
