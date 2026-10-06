'use client';

// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DAY_ONE_FILTERS } from './constants';
import { type AIForwardGuidance, type AITier, type EarningsScanCard, type CommentarySignal, type UniverseAggregation, type PostGap, type DayOneFilter } from './types';

  // 1 hour
export const _cacheMonth = () => new Date().toISOString().slice(0, 7);
// PATCH 0948 — Derive a stable cache period like "Q4-FY26" from the card's
// "period" string (typically "Mar 2026" / "Jun 2025" / etc — Screener.in
// publishes quarter-end month + year). Indian FY convention: Apr→Mar.
export function deriveCachePeriod(periodStr: string | undefined): string {
  if (!periodStr) return 'unknown';
  const m = String(periodStr).trim().match(/^(\w{3})\s+(\d{4})$/);
  if (!m) return 'unknown';
  const month = m[1].toUpperCase();
  const year = parseInt(m[2], 10);
  const Q = ({ MAR: 'Q4', JUN: 'Q1', SEP: 'Q2', DEC: 'Q3' } as Record<string, string>)[month];
  if (!Q) return 'unknown';
  // FY26 = Apr 2025 → Mar 2026. So Mar 2026 → FY26 = year % 100. Jun/Sep/Dec
  // of YEAR fall in FY(YEAR+1) since they precede the next March.
  const fy = Q === 'Q4' ? (year % 100) : ((year + 1) % 100);
  return `${Q}-FY${fy.toString().padStart(2, '0')}`;
}
// PATCH 0962 — Client-side cache validator (ISSUE #10). Mirrors the server's
// isValidGuidanceObject so hydration drops malformed or partially migrated
// entries instead of silently rendering them.
// NOT exported: Next.js page files reject non-standard exports.
export function isValidGuidanceObject(v: unknown): v is AIForwardGuidance {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (!['Positive', 'Neutral', 'Negative', 'NoGuidance'].includes(o.label as string)) return false;
  if (typeof o.score !== 'number' || !isFinite(o.score)) return false;
  if (!['HIGH', 'MEDIUM', 'LOW'].includes(o.confidence as string)) return false;
  if (typeof o.rationale !== 'string') return false;
  if (!Array.isArray(o.quotes)) return false;
  if (typeof o.period !== 'string' || !o.period) return false;
  return true;
}
export function aiTier(ai: AIForwardGuidance | null | undefined):
  | { tier: AITier; color: string; icon: string; label: string }
  | null {
  if (!ai) return null;
  // PATCH 0951 — NoGuidance is its own tier (greyed out, "no forward content").
  // Honest: better than fabricating Neutral 0.00 on an intimation PDF.
  if (ai.label === 'NoGuidance') {
    return { tier: 'NOGUIDANCE', color: '#6B7280', icon: '◌', label: 'No fwd guidance' };
  }
  const s = ai.score;
  if (s >= 0.6)  return { tier: 'EXCELLENT', color: '#10B981', icon: '🚀', label: 'AI-Excellent' };
  if (s >= 0.2)  return { tier: 'POSITIVE',  color: '#34D399', icon: '▲',  label: 'AI-Positive'  };
  if (s > -0.2)  return { tier: 'NEUTRAL',   color: '#94A3B8', icon: '●',  label: 'AI-Neutral'   };
  if (s > -0.6)  return { tier: 'CAUTIOUS',  color: '#F59E0B', icon: '▽',  label: 'AI-Cautious'  };
  return            { tier: 'NEGATIVE', color: '#EF4444', icon: '⚠',  label: 'AI-Negative' };
}
export function formatMcap(num: number | null, cmp?: number | null): string {
  if (num === null || num === undefined || num <= 0) return '—';
  // PATCH 0972 BUG-2 — MCap sanity validation. User reported POLICYBZR
  // (PB Fintech) showing "MCap: ₹5 Cr" while CMP was ₹426 — implies only
  // ~12 lakh shares outstanding (vs the real ~46 Cr). Almost certainly an
  // upstream parser bug (probably stripping "₹65,XXX Cr" digits). Rule:
  // any company with CMP > ₹50 should have MCap > ₹100 Cr (smallest
  // floating shares scenario: 2 lakh shares × ₹50 = ₹1 Cr). When the
  // displayed mcap implies < 2 lakh shares outstanding, suppress with
  // a question-mark hint so user knows the value is suspect.
  if (cmp && cmp > 0 && num > 0) {
    const impliedSharesCr = num / cmp;  // num and cmp both in same currency unit
    // < 2 lakh shares (0.02 Cr) for a company trading > ₹50 is nonsensical
    if (cmp > 50 && impliedSharesCr < 0.02) {
      return '? (data error)';
    }
  }
  // num is in Cr
  if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L Cr`;  // lakh crore
  if (num >= 1000) return `₹${Math.round(num).toLocaleString('en-IN')} Cr`;
  return `₹${num.toFixed(0)} Cr`;
}
export function parseQuarterDate(quarterStr: string): Date | null {
  if (!quarterStr || quarterStr === 'N/A' || quarterStr === '-') return null;
  // Parse "Mar 2023" or "December 2024" format
  const parts = quarterStr.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const monthStr = parts[0];
  const year = parseInt(parts[parts.length - 1]);
  if (isNaN(year)) return null;

  const months: Record<string, number> = {
    'January': 0, 'February': 1, 'March': 2, 'April': 3, 'May': 4, 'June': 5,
    'July': 6, 'August': 7, 'September': 8, 'October': 9, 'November': 10, 'December': 11,
    'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'Jun': 5,
    'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11,
  };

  const month = months[monthStr];
  if (month === undefined) return null;
  return new Date(year, month, 1);
}
export function isDataStale(quarterStr: string, maxMonths: number = 6): boolean {
  const quarterDate = parseQuarterDate(quarterStr);
  if (!quarterDate) return true;

  const now = new Date();
  const monthsAgo = (now.getFullYear() - quarterDate.getFullYear()) * 12 + (now.getMonth() - quarterDate.getMonth());
  return monthsAgo > maxMonths;
}
// ══════════════════════════════════════════════
// One-line earnings verdict.
//
// FORMAT:  [Beat/Strong/Mixed/Miss] | [causal driver in plain English]
//
// Rules (institutional analyst voice):
// - Explain the business driver, not the metric relationship
// - Use strong verbs: lifted, squeezed, dragged, capped, stretched, absorbed
// - No numbers in commentary — the table already shows numbers
// - 3-10 words, 14 max
// - No emojis, no bullets, one line only
// ══════════════════════════════════════════════

export function generateEarningsCommentary(card: EarningsScanCard): { text: string; forward: string; signal: CommentarySignal } | null {
  if (card.dataQuality === 'PRICE_ONLY' || card.quarters.length === 0) return null;

  const rev = card.revenueYoY;
  const pat = card.patYoY;
  const q0 = card.quarters[0];
  const latestMonth = q0?.period?.split(' ')[0];
  const latestYear = parseInt(q0?.period?.split(' ')[1] || '0');
  const yoyQ = card.quarters.find(q => {
    const m = q.period.split(' ')[0];
    const y = parseInt(q.period.split(' ')[1]);
    return m === latestMonth && y === latestYear - 1;
  });
  const opmDelta = yoyQ ? q0.opm - yoyQ.opm : 0;
  const opmNow = q0.opm;
  const hasRev = rev !== null;
  const hasPat = pat !== null;

  // QoQ margin check (did margins improve sequentially?)
  const prevQ = card.quarters[1] || null;
  const qoqOpmDelta = prevQ ? q0.opm - prevQ.opm : 0;

  // Qualitative flags from screener.in Pros/Cons
  const posKeys = (card.keyPhrasesPositive || []).map(k => k.toLowerCase());
  const negKeys = (card.keyPhrasesNegative || []).map(k => k.toLowerCase());
  const guidance = card.guidance;
  const capexSignal = card.capexSignal;

  const isDebtFree = posKeys.some(k => k.includes('debt free') || k.includes('zero debt'));
  const hasOrderBook = posKeys.some(k => k.includes('order') || k.includes('book'));
  const hasHighDebt = negKeys.some(k => k.includes('debt') || k.includes('leverage') || k.includes('borrowing'));
  const hasWCStress = negKeys.some(k => k.includes('working capital') || k.includes('inventory') || k.includes('receivable') || k.includes('cash flow'));

  // Revenue-PAT divergence ratio: how much of revenue growth reached profit
  const profitConversion = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;

  // ── CLASSIFY ──
  let label: 'Beat' | 'Strong' | 'Mixed' | 'Miss';
  if (q0.pat < 0) {
    label = 'Miss';
  } else if (!hasRev || !hasPat) {
    label = 'Mixed';
  } else if (rev! <= -5 && pat! <= -10) {
    label = 'Miss';
  } else if (rev! <= 0 && pat! <= 0) {
    label = 'Miss';
  } else if (rev! > 5 && pat! <= 0) {
    label = 'Mixed';
  } else if (rev! > 15 && profitConversion < 0.25 && opmDelta < -3) {
    // Revenue surging but profit barely moved + margins crushed = Mixed
    label = 'Mixed';
  } else if (rev! > 10 && profitConversion < 0.3 && opmDelta < -2) {
    // Good revenue but weak profit conversion with margin pressure
    label = 'Mixed';
  } else if (hasWCStress && opmDelta < -3) {
    // Working capital stress + margin compression = quality concern overrides P&L
    label = 'Mixed';
  } else if (rev! > 12 && pat! > 18 && opmDelta >= -1) {
    label = 'Beat';
  } else if (rev! > 8 && pat! > 10) {
    label = pat! > rev! ? 'Beat' : 'Strong';
  } else if (rev! > 0 && pat! > 0) {
    label = 'Strong';
  } else {
    label = 'Mixed';
  }

  // ── IDENTIFY PRIMARY DRIVER ──
  let driver: string;

  // --- MISS patterns ---
  if (label === 'Miss') {
    if (q0.pat < 0 && hasHighDebt) {
      driver = 'Interest burden pushed earnings into loss';
    } else if (q0.pat < 0) {
      driver = 'Operating losses; cost base exceeds revenue';
    } else if (hasRev && rev! > 5 && hasPat && pat! < -10) {
      // Revenue up but profit down
      if (hasHighDebt) {
        driver = 'Finance costs eroded operating gains';
      } else if (opmDelta < -4) {
        driver = 'Scaling costs squeezed margins despite growth';
      } else {
        driver = 'Rising costs absorbed revenue growth';
      }
    } else if (hasRev && rev! < -5 && hasHighDebt) {
      driver = 'Demand weakness compounded by debt burden';
    } else if (hasRev && rev! < -5 && hasWCStress) {
      driver = 'Demand weakness compounded by working capital strain';
    } else if (hasRev && rev! < -5) {
      driver = 'Revenue decline and weaker demand dragged profits';
    } else {
      driver = 'Revenue and profit both declined';
    }

  // --- MIXED patterns ---
  } else if (label === 'Mixed') {
    if (hasRev && rev! > 30 && opmDelta < -4) {
      // Hyper-growth + margin crush
      if (capexSignal === 'Expanding' || hasOrderBook) {
        driver = 'Capacity ramp-up costs absorbed the revenue surge';
      } else {
        driver = 'Scaling costs absorbed most of the revenue surge';
      }
    } else if (hasRev && rev! > 10 && opmDelta < -3) {
      driver = 'Employee and project costs squeezed margins';
    } else if (hasRev && rev! > 5 && hasPat && pat! <= 0) {
      if (hasHighDebt) {
        driver = 'Finance costs capped profit despite revenue growth';
      } else {
        driver = 'Rising costs offset revenue growth entirely';
      }
    } else if (hasWCStress && hasRev && rev! > 0) {
      driver = 'Growth stretched working capital and weakened cash quality';
    } else if (hasRev && hasPat && profitConversion < 0.3 && rev! > 10) {
      if (opmDelta < -2) {
        driver = 'Input cost inflation squeezed operating margins';
      } else {
        driver = 'Weaker operating leverage capped profit growth';
      }
    } else if (hasRev && Math.abs(rev!) < 5 && hasPat && Math.abs(pat!) < 8) {
      if (guidance === 'Negative') {
        driver = 'Flat quarter with cautious forward outlook';
      } else {
        driver = 'No clear earnings inflection this quarter';
      }
    } else {
      driver = 'Earnings lacked clear direction this quarter';
    }

  // --- BEAT / STRONG patterns (merged — each card gets a unique driver) ---
  } else {
    // Identify the DOMINANT driver from the actual numbers
    const patRevRatio = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;
    const marginExpanded = opmDelta > 2;
    const marginHeld = opmDelta >= -1;
    const marginSoftened = opmDelta < -1 && opmDelta >= -4;
    const marginCrushed = opmDelta < -4;

    if (marginExpanded && patRevRatio > 1.3) {
      // PAT grew much faster than revenue + margins expanded = operating leverage
      driver = 'Margin expansion and operating leverage lifted profits';
    } else if (marginExpanded && isDebtFree) {
      driver = 'Margins expanded on a debt-free base';
    } else if (marginExpanded) {
      driver = 'Cost discipline and mix improvement drove margin expansion';
    } else if (patRevRatio > 2 && marginHeld) {
      // PAT grew 2x revenue = strong leverage even without big margin move
      driver = 'Operating leverage amplified profit growth';
    } else if (marginCrushed && hasRev && rev! > 30) {
      driver = 'Scaling costs diluted margins during rapid growth phase';
    } else if (marginCrushed) {
      driver = 'Input cost inflation squeezed margins despite growth';
    } else if (marginSoftened && hasPat && pat! > 20) {
      driver = 'Volume growth drove profits despite softer margins';
    } else if (marginSoftened) {
      driver = 'Revenue growth partly offset by margin dilution';
    } else if (hasWCStress && hasPat && pat! > 10) {
      driver = 'Earnings grew but working capital absorbed cash';
    } else if (hasHighDebt && hasPat && pat! > 15) {
      driver = 'Earnings grew but financial leverage remains elevated';
    } else if (isDebtFree && hasPat && pat! > 20) {
      driver = 'Strong profit growth on a clean balance sheet';
    } else if (hasOrderBook) {
      driver = 'Order book execution supported earnings growth';
    } else if (hasRev && rev! > 20 && marginHeld) {
      driver = 'Strong revenue growth with margins intact';
    } else if (hasPat && pat! > 30) {
      driver = 'Profit surge driven by volume and cost control';
    } else if (hasRev && rev! > 10) {
      driver = 'Revenue momentum supported earnings this quarter';
    } else {
      driver = 'Incremental growth across revenue and profits';
    }
  }

  // ── LINE 2: FORWARD OUTLOOK (operating leverage, capex, inflection) ──
  const g = card.guidance;
  const cap = card.capexSignal;
  const dem = card.demandSignal;
  const mar = card.marginOutlook;

  // ── LINE 2: QUALITY & INFLECTION — pattern detection from financials ──
  // Detects: divergences, cash quality flags, operating leverage shifts,
  // margin inflection, inorganic distortion, one-off items. Every statement
  // must be backed by data in the card — no filler.

  // ── LINE 2: QUALITY & INFLECTION — always generate, never blank ──
  const fwdRevQoQ = card.revenueQoQ;
  const fwdQoqOpmUp = prevQ ? q0.opm > prevQ.opm : false;
  const fwdQoqOpmDelta = prevQ ? q0.opm - prevQ.opm : 0;
  const patRevRatio2 = (hasRev && hasPat && rev! > 0) ? pat! / rev! : 1;

  let forward = '';
  const insights: string[] = [];

  // ── RED FLAGS ──
  if (q0.pat < 0 && hasRev && rev! > 0)
    insights.push('losses despite revenue growth — cost base unsustainable');
  if (hasPat && pat! > 10 && opmDelta < -3 && fwdQoqOpmDelta < -1)
    insights.push('profit growth masks deteriorating margin trend');
  if (hasRev && rev! > 15 && hasPat && pat! < 3 && pat! > -10)
    insights.push('revenue surge not reaching bottom line');
  if (hasWCStress)
    insights.push('working capital stretched — watch cash conversion');
  if (hasHighDebt && hasPat && pat! > 0 && patRevRatio2 < 0.5)
    insights.push('finance costs capping profit conversion');

  // ── OPERATING LEVERAGE / DELEVERAGE ──
  if (hasPat && hasRev && pat! > rev! * 1.3 && opmDelta > 0)
    insights.push('operating leverage visible — profit outpacing revenue');
  else if (hasPat && hasRev && rev! > 8 && pat! < rev! * 0.3 && pat! > 0 && insights.length === 0)
    insights.push('operating deleverage — profit lagging revenue growth');

  // ── MARGIN TRAJECTORY ──
  if (opmDelta > 3)
    insights.push(`OPM expanded ${opmDelta.toFixed(0)}pp YoY`);
  else if (opmDelta < -3 && fwdQoqOpmUp && fwdQoqOpmDelta > 0.5)
    insights.push('margin inflection — QoQ recovery despite YoY decline');
  else if (opmDelta < -3)
    insights.push(`OPM contracted ${Math.abs(opmDelta).toFixed(0)}pp YoY`);

  // ── MOMENTUM ──
  if (fwdRevQoQ !== null && fwdRevQoQ > 15)
    insights.push('sequential revenue momentum strong');
  else if (fwdRevQoQ !== null && fwdRevQoQ < -10)
    insights.push('sequential revenue declined — watch for demand softness');

  // ── CAPEX / QUALITATIVE (screener data) ──
  if (cap === 'Expanding')
    insights.push('capex expanding — capacity addition underway');
  else if (cap === 'Reducing')
    insights.push('capex reducing');
  if (dem === 'Strong')
    insights.push('demand signals strong');
  else if (dem === 'Weak')
    insights.push('demand weakening');

  // ── BALANCE SHEET SIGNAL ──
  if (isDebtFree && insights.every(i => !i.includes('debt') && !i.includes('leverage')))
    insights.push('debt-free balance sheet');

  // ── SCREENER PROS/CONS as additive context ──
  if (posKeys.length > 0 && negKeys.length > 0) {
    insights.push(`${posKeys.slice(0, 2).join(', ')}; but ${negKeys.slice(0, 2).join(', ')}`);
  } else if (negKeys.length > 0 && insights.length < 2) {
    insights.push(negKeys.slice(0, 2).join(', '));
  } else if (posKeys.length > 0 && insights.length < 2) {
    insights.push(posKeys.slice(0, 2).join(', '));
  }

  // Always produce line 2 — pick best 2 insights, capitalize
  if (insights.length > 0) {
    // Deduplicate similar insights
    const unique = insights.filter((v, i, a) => a.findIndex(x => x.slice(0, 15) === v.slice(0, 15)) === i);
    const combined = unique.slice(0, 2).join('. ');
    forward = combined.charAt(0).toUpperCase() + combined.slice(1);
  }

  const text = `${label} | ${driver}`;
  const signal: CommentarySignal = label === 'Beat' || label === 'Strong' ? 'POSITIVE' : label === 'Miss' ? 'RED_FLAG' : 'MIXED';

  return { text, forward, signal };
}
// ══════════════════════════════════════════════
// CARD COMPONENT
// ══════════════════════════════════════════════

// PATCH 0956/0958 — eligibility helper. P0958 dropped the D1 gate, so only
// two states now: 'eligible' (EX/ST grade) and 'low-grade' (GOOD/OK/BAD).
// Universe filter is the cost lever, not per-card D1.
export function aiEligibilityReason(card: EarningsScanCard): { state: 'eligible' | 'low-grade'; reason: string } {
  if (card.grade !== 'EXCELLENT' && card.grade !== 'STRONG') {
    return { state: 'low-grade', reason: `AI gated: ${card.grade} grade (only EX/ST)` };
  }
  return { state: 'eligible', reason: '' };
}
// ══════════════════════════════════════════════
// COMPUTE AGGREGATIONS
// ══════════════════════════════════════════════

export function computeAggregation(cards: EarningsScanCard[], label: string): UniverseAggregation {
  const withData = cards.filter(c => c.dataQuality !== 'PRICE_ONLY');
  if (withData.length === 0) return { label, count: 0, avgRevenueYoY: null, avgPatYoY: null, avgEpsYoY: null, avgOpmChange: null, risingEarningsPct: 0, marginExpansionPct: 0, riskFlags: 0, avgScore: 0 };

  const revYoY = withData.filter(c => c.revenueYoY !== null).map(c => c.revenueYoY!);
  const patYoY = withData.filter(c => c.patYoY !== null).map(c => c.patYoY!);
  const epsYoY = withData.filter(c => c.epsYoY !== null).map(c => c.epsYoY!);

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : null;

  const risingCount = withData.filter(c => (c.revenueYoY || 0) > 0 && (c.patYoY || 0) > 0).length;
  const marginExpCount = withData.filter(c => {
    if (c.quarters.length < 2) return false;
    return c.quarters[0].opm > c.quarters[1].opm;
  }).length;
  // PATCH 0357 — broadened risk-flag detector (matches the system-summary
  // detector above): fires on PAT < -20% OR rev < -10% OR divergence.
  const riskCount = withData.filter(c => {
    const patBad = (c.patYoY ?? 0) < -20;
    const revBad = (c.revenueYoY ?? 0) < -10;
    const divergence = !!c.divergence && c.divergence !== 'None';
    return patBad || revBad || divergence;
  }).length;

  return {
    label,
    count: cards.length,
    avgRevenueYoY: avg(revYoY),
    avgPatYoY: avg(patYoY),
    avgEpsYoY: avg(epsYoY),
    avgOpmChange: null, // Not computed directly
    risingEarningsPct: withData.length > 0 ? (risingCount / withData.length) * 100 : 0,
    marginExpansionPct: withData.length > 0 ? (marginExpCount / withData.length) * 100 : 0,
    riskFlags: riskCount,
    avgScore: cards.length > 0 ? cards.reduce((s, c) => s + c.totalScore, 0) / cards.length : 0,
  };
}
// ═══════════════════════════════════════════════════════════════════════════
// POST-EARNINGS GAP PROVIDER (PATCH 0201, normalizer added in 0202)
// Fetches Yahoo-based post-earnings price action for the visible cards.
// Render-prop pattern so the same hook lives once per visible set, not per card.
// ═══════════════════════════════════════════════════════════════════════════

/** Convert Screener-style resultDate strings into ISO YYYY-MM-DD.
 *  Accepts:
 *    "2026-04-15" / "2026-04-15T17:30:00"        → already ISO, slice to date
 *    "15-Apr-2026" / "15-Apr-2026 17:30:00"      → human format, parse + emit ISO
 *    "Mar 2026" / "-" / "N/A" / empty / null     → null (no real filing date) */
export function toIsoFilingDate(resultDate?: string | null): string | null {
  if (!resultDate) return null;
  const trimmed = resultDate.trim();
  if (!trimmed || trimmed === '-' || trimmed === 'N/A') return null;
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  // Just a quarter period like "Mar 2026" — no real filing date. Caller decides
  // whether to fall back to an estimate (see toFilingOrEstimate).
  if (/^[A-Za-z]{3,9}\s+\d{4}$/.test(trimmed)) return null;
  // Human format like "15-Apr-2026 17:30:00" → "Apr 15, 2026 17:30:00"
  const normalized = trimmed.replace(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/, '$2 $1, $3');
  const parsed = new Date(normalized);
  if (isNaN(parsed.getTime())) return null;
  // Local-day components — filing date is calendar-day specific; safe for IST/UTC.
  const y = parsed.getFullYear();
  const m = String(parsed.getMonth() + 1).padStart(2, '0');
  const d = String(parsed.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
/** Estimate an approximate filing date from a quarter period string like
 *  "Mar 2026". Uses end-of-quarter + 15-day reporting lag — the SAME rule
 *  applied by the date-range filter at /earnings (lines 1416 / 1476).
 *  Returns null if the period is unparseable or if the estimated date is in
 *  the future (filing hasn't happened yet → no post-gap to show). */
export function estimateFilingFromPeriod(period?: string | null): string | null {
  if (!period) return null;
  const quarterEnd = parseQuarterDate(period);
  if (!quarterEnd) return null;
  const endOfMonth = new Date(quarterEnd.getFullYear(), quarterEnd.getMonth() + 1, 0);
  const est = new Date(endOfMonth.getTime() + 15 * 24 * 60 * 60 * 1000);
  if (est.getTime() > Date.now()) return null;  // filing not yet expected
  const y = est.getFullYear();
  const m = String(est.getMonth() + 1).padStart(2, '0');
  const d = String(est.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
/** Best-effort filing date: prefer the real date, fall back to quarter estimate. */
export function toFilingOrEstimate(resultDate?: string | null, period?: string | null): string | null {
  return toIsoFilingDate(resultDate) || estimateFilingFromPeriod(period);
}
// PATCH 0207 — Converted from render-prop component to a hook so `gapMap` is
// available to the filter pipeline (Day-1 close threshold). Behaviour
// otherwise identical to the previous PostGapProvider.
export function usePostGapData(cards: EarningsScanCard[]): Record<string, PostGap> {
  const items = useMemo(() => {
    return cards.slice(0, 80).map((c) => ({
      ticker: c.symbol,
      filing_date: toFilingOrEstimate(c.resultDate, c.period),
      period: c.period || '',
      timing: 'post' as const,
    })).filter((x): x is { ticker: string; filing_date: string; period: string; timing: 'post' } => !!x.ticker && !!x.filing_date);
  }, [cards]);

  const key = useMemo(() => items.map((i) => `${i.ticker}|${i.filing_date}`).join(','), [items]);
  const { data } = useQuery<Record<string, PostGap>>({
    queryKey: ['post-earnings-gap', key],
    enabled: items.length > 0,
    queryFn: async () => {
      // PATCH 0716 — added 20s timeout + safe JSON parse.
      const _pgCtl = new AbortController();
      const _pgTimer = setTimeout(() => _pgCtl.abort(), 20_000);
      let res: Response;
      try {
        res = await fetch('/api/v1/earnings/post-gap', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items }),
          signal: _pgCtl.signal,
        });
      } catch { clearTimeout(_pgTimer); return {} as Record<string, PostGap>; }
      finally { clearTimeout(_pgTimer); }
      if (!res.ok) return {};
      let j: any = {};
      try { j = await res.json(); } catch { return {} as Record<string, PostGap>; }
      return (j && typeof j === 'object' && j.data && typeof j.data === 'object') ? j.data : {};
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  return data || {};
}
export function matchesDayOneFilter(postGap: PostGap | undefined, filters: Set<DayOneFilter>): boolean {
  if (filters.size === 0) return true;
  const v = postGap?.close_move_pct;
  if (v == null) return false;
  for (const f of filters) {
    const def = DAY_ONE_FILTERS.find(d => d.key === f);
    if (def && def.predicate(v)) return true;
  }
  return false;
}
