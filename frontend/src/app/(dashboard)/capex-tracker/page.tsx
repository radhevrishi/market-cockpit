'use client';

// ════════════════════════════════════════════════════════════════════════════
// CAPEX TRACKER v4.3 — QUALITY × TIMING engine.
// QUALITY: "The CAPEX Masterclass" (200 cases) Ch.12 verbatim — 21 weighted
//   factors (100 pts) → industry multiplier → deal-breaker override (3+ of 6
//   ⇒ cap 30) → ANCHOR/CORE/SATELLITE/WATCHLIST/AVOID/REJECT bands.
// TIMING: "Capex-Utilization Multibagger Framework" (~250 cases) — T0→T5
//   inflections, Stage A-F entry classification (Stage C ≈40% util = modal
//   winner entry, 55% of winners; Stage F = documented anti-pattern), sell
//   staircase + mechanical risk rules.
// ENTRY VERDICT = quality band ∩ stage. Screener.in workbooks are mined for
// telemetry + '(est)' fills; rows merge by company and persist locally.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

// ── theme (cockpit dark palette) ────────────────────────────────────────────
const C = {
  bg: '#0B1220', panel: '#101A2C', panel2: '#0D1623', line: '#1A2540',
  txt: '#E6EDF7', dim: '#8B98AC', muted: '#5B6A82',
  green: '#00E68A', red: '#FF4D6A', amber: '#FFB347', blue: '#4DA6FF',
  cyan: '#22D3EE', violet: '#A78BFA', gold: '#FFD700', teal: '#2DD4BF', orange: '#F0883E',
};
const F = { xs: 11, sm: 12.5, md: 14, lg: 17, xl: 24 };

// ── data model ──────────────────────────────────────────────────────────────
type Row = Record<string, string>;
type Factor = { id: number; label: string; pts: number; max: number; note: string; tier: 1 | 2 | 3 | 4 };
type Scored = {
  name: string; sector: string; industry: string; country: 'IN' | 'US';
  base: number; final: number; decision: string; decisionColor: string;
  dbCount: number; dbList: string[]; mult: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  position: string; gaps: number; estUsed: number; factors: Factor[];
  comment: string; action: string; theme: string | null;
  roce: number; de: number; util: number; anchor: number; debtFund: number; ocfYears: number;
  ebitda: number; pledge: number; raw: Row;
  phase: string; capexToSales: number; cwipRatio: number; capexAccel: number; deChange: number; selfFund: number;
  netDebtEbitda: number; capexPreRev: number; utilEff: number; nbGrowth: number; revYoY: number;
  stage: string; stageLabel: string; entry: string; entryColor: string; entryShort: string;
  capexSeries: { y: string; v: number }[]; cycleNote: string;
  watch: string[]; sells: string[]; measuredPct: number; availMax: number;
  tiers: { label: string; pts: number; max: number }[];
};

// ── flexible header resolution (Appendix B names + common variants) ─────────
const HEADERS: [string, RegExp][] = [
  ['name', /^(company ?name|company|name|stock)$/i],
  ['sector', /^sector$/i],
  ['industry', /^industry$/i],
  ['country', /country|region|market|geo/i],
  ['roce', /roce/i],
  ['roic', /roic/i],
  ['util', /utili[sz]ation/i],
  ['de', /^d\/?e( ratio)?$|debt.?to.?equity/i],
  // exact-shape only: must NOT match telemetry like 'OCF/Capex 3y %'
  ['ocf', /^ocf ?(positive)? ?(years|status|yrs|3-? ?yr)?$/i],
  ['fcf', /fcf/i],
  ['internalPct', /internal/i],
  ['debtPct', /debt ?%|% ?debt|debt.?fund/i],
  ['capex', /^capex( size)?( rs)?( cr)?$|capex.?size|capex.?amount/i],
  ['grossBlock', /gross.?block/i],
  ['revenue', /^(annual ?revenue|revenue|sales)$/i],
  ['anchor', /anchor/i],
  ['promoter', /promoter.?hold/i],
  ['pledge', /pledge/i],
  ['tenure', /tenure|founder.?ceo/i],
  ['ebitda', /ebitda ?margin|^ebitda ?%?$/i],
  ['revCagr', /cagr/i],
  ['brownfield', /brownfield|green.?field/i],
  ['cycle', /^cycle|cycle.?position/i],
  ['overrun', /overrun/i],
  ['wc', /working.?capital|^wc/i],
  ['policy', /policy/i],
  ['peVsMean', /pe.?vs|pe.?rel|valuation|5.?yr.?mean/i],
  ['importSub', /import/i],
  ['exportOpp', /export/i],
  ['moat', /moat|competitive/i],
  ['mgmtHistory', /track.?record|execution.?history|prior.?capex/i],
  ['industryGrowth', /industry.?growth/i],
];

// Parser TELEMETRY columns are read by exact name in scoreRow and must NEVER
// enter the header race — a loose factor regex matching one of these silently
// corrupts scores (e.g. /ocf/ once read 'OCF/Capex 3y %' as the OCF streak).
const TELEMETRY_COLS = new Set([
  'Capex Phase', 'Capex/Sales %', 'CWIP/NetBlock %', 'Capex Accel x',
  'D/E change 2y', 'OCF/Capex 3y %', 'Net Debt/EBITDA', 'Capex/PreRev %',
  'Util Effective % (est)', 'NB Growth %', 'Rev YoY %', 'Capex Series', 'Prior Cycle Note',
]);

// non-'(est)' columns win the header race; est columns only match as fallback
function resolveHeaders(cols: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const ordered = [...cols.filter((c) => !/\(est\)/i.test(c)), ...cols.filter((c) => /\(est\)/i.test(c))];
  for (const col of ordered) {
    const c = col.trim();
    if (TELEMETRY_COLS.has(c)) continue;
    for (const [key, re] of HEADERS) {
      if (!map[key] && re.test(c)) { map[key] = col; break; }
    }
  }
  return map;
}

const num = (v: string | undefined): number => {
  if (v === undefined || v === null) return NaN;
  const n = parseFloat(String(v).replace(/[%,₹$ ]|cr/gi, ''));
  return isFinite(n) ? n : NaN;
};
const yes = (v: string | undefined): boolean | null => {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(s)) return true;
  if (['n', 'no', 'false', '0'].includes(s)) return false;
  return null;
};

// ── industry multiplier (Masterclass Ch.12.2) ───────────────────────────────
const IND_MULT: [RegExp, number, string][] = [
  [/defen[cs]e|aerospace/i, 1.10, 'Defence/Aerospace'],
  [/special(i?ty)? ?chem/i, 1.08, 'Specialty Chemicals'],
  [/cdmo|cro\b|pharma|biolog/i, 1.06, 'Pharma/CDMO'],
  [/consumer|brand|fmcg|jewell?er|retail premium/i, 1.05, 'Consumer Premium'],
  [/cement|mining|peb|pre.?engineered|structural steel|building products/i, 1.03, 'Cement/MiningTech/PEB'],
  [/renewab|solar|wind|green energy/i, 1.02, 'Renewables'],
  [/semi ?conductor|chip|ai |cloud|data ?cent/i, 1.00, 'Semis/AI/Cloud'],
  [/\bems\b|electronics manufacturing/i, 1.00, 'EMS'],
  [/bank|nbfc|finance|financial/i, 0.95, 'Banks/NBFC'],
  [/real ?estate|residential|commercial project/i, 0.85, 'Real Estate'],
  [/telecom/i, 0.75, 'Telecom'],
  [/airline|aviation/i, 0.70, 'Airlines'],
  [/merchant power/i, 0.65, 'Merchant Power'],
  [/\bsteel\b|metal/i, 0.65, 'Steel/Metals'],
];

// ── 2026-2030 theme tagger (Masterclass Ch.11 Tier-1) ───────────────────────
const THEMES: [RegExp, string][] = [
  [/defen[cs]e|aerospace|missile|forging/i, '🛡 Defence Indigenization'],
  [/peb|pre.?engineered|warehous|structural|building products/i, '🏗 PEB/Warehousing'],
  [/hydrogen|cryogenic|cylinder|critical mineral|lithium|graphite|recycl/i, '⚡ Hydrogen/Critical Minerals'],
  [/mining|beneficiation|mill liner|crane/i, '⛏ Mining Tech'],
  [/special(i?ty)? ?chem|fluoro|agrochem/i, '🧪 SpecChem China+1 W2'],
  [/jewell?er|mangalsutra|gold/i, '💍 Wedding Jewellery'],
  [/\bems\b|electronics/i, '📟 EMS PLI Wave (glut risk)'],
  [/cdmo|biolog|pharma/i, '💊 Pharma CDMO'],
];

// ── Stage A-F meta (Framework Phase 5 + 7) ──────────────────────────────────
const STAGE_META: Record<string, { color: string; label: string; size: string; note: string; pos: number }> = {
  A: { color: '#A78BFA', label: 'ANNOUNCED / BUILDING', size: '0.5-1%', pos: 0.5,
    note: 'Highest return when it works, worst hit rate. Only for proven executors with net-cash sheets (HEICO, Mazagon, Jubilant archetype).' },
  B: { color: '#00E68A', label: 'JUST COMMISSIONED', size: '1.5-2.5%', pos: 1.5,
    note: 'Strongest hit-rate × multiple combo (~20% of optimal entries). Plant live, consensus has not modeled the ramp (Astral ’13, Deepak ’18, Symphony ’11).' },
  C: { color: '#FFD700', label: '~40% UTILIZATION — MODAL ENTRY', size: '2-3.5%', pos: 2.2,
    note: 'THE modal optimal entry — ~55% of winners. Depreciation visible, GAAP not yet inflected, consensus extrapolates the depressed margin. This is the alpha window.' },
  D: { color: '#22D3EE', label: '~60% UTIL — SECOND CHANCE', size: '1.5-2.5%', pos: 2.8,
    note: 'Second-chance entry (~20% of optimal). Typically 5-10x but the multiple has expanded — pair with a temporary sector overhang.' },
  E: { color: '#FFB347', label: '70-90% — LATE', size: '0.5-1%', pos: 3.6,
    note: 'Operating leverage mostly exhausted. Enter only with a 30%+ valuation cushion to the prior cycle peak.' },
  F: { color: '#FF4D6A', label: '>90% / INFLECTION PRINTED', size: '0%', pos: 4.6,
    note: 'The documented ANTI-PATTERN. Stage F entries are net NEGATIVE in the 250-case data (Tatva, Anupam, Wolfspeed post-print). Do not chase.' },
  '—': { color: '#8B98AC', label: 'NO MAJOR CYCLE', size: '—', pos: 0,
    note: 'Cycle capex below 25% of pre-capex revenue with no spend acceleration — serial-brownfield steady compounder. The Stage A-F multibagger arc does not apply; judge on quality and wait for a real cycle.' },
};

// ── THE SCORING ENGINE — quality (Ch.12) + timing (Stage A-F) ───────────────
function scoreRow(r: Row, h: Record<string, string>): Scored {
  const g = (k: string) => r[h[k]];
  let estUsed = 0;
  // precedence: clean canonical header (manual/editor) → resolved column → '(est)' fill
  const gv = (hkey: string, canonical: string): { v: string; est: boolean } => {
    const clean = String(r[canonical] ?? '').trim();
    if (clean) return { v: clean, est: false };
    const col = h[hkey];
    if (col && col !== canonical + ' (est)') {
      const rv = String(r[col] ?? '').trim();
      if (rv) return { v: rv, est: /\(est\)/i.test(col) };
    }
    const ev = String(r[canonical + ' (est)'] ?? '').trim();
    if (ev) return { v: ev, est: true };
    return { v: '', est: false };
  };
  const name = (g('name') || '').trim() || 'Unknown';
  const sector = (g('sector') || '').trim();
  const industry = (g('industry') || sector).trim();
  const countryRaw = (g('country') || '').trim().toUpperCase();
  const promoterV = num(g('promoter'));
  const tenureV = num(g('tenure'));
  const country: 'IN' | 'US' =
    countryRaw.startsWith('US') ? 'US' : countryRaw.startsWith('IN') ? 'IN'
    : !isNaN(tenureV) && isNaN(promoterV) ? 'US' : 'IN';

  const roce = !isNaN(num(g('roce'))) ? num(g('roce')) : num(g('roic'));
  const anchor = num(g('anchor'));
  const de = num(g('de'));
  // exact parser field first — never let a fuzzy header match feed the streak
  const ocfRaw = String(r['OCF positive years'] ?? '').trim() || g('ocf');
  let ocfYears = num(ocfRaw);
  if (isNaN(ocfYears)) { const b = yes(ocfRaw); ocfYears = b === true ? 4 : b === false ? -1 : NaN; }
  const fundI = gv('internalPct', 'Internal funding %');
  const fundD = gv('debtPct', 'Debt funding %');
  let internal = num(fundI.v), debtPct = num(fundD.v);
  const fundEst = (fundI.est && !isNaN(internal)) || (fundD.est && !isNaN(debtPct));
  if (isNaN(internal) && !isNaN(debtPct)) internal = 100 - debtPct;
  if (isNaN(debtPct) && !isNaN(internal)) debtPct = 100 - internal;
  const utilV = gv('util', 'Capacity Utilization %');
  const util = num(utilV.v);
  const pledge = num(g('pledge'));
  const ebitda = num(g('ebitda'));
  const capex = num(g('capex')); const gb = num(g('grossBlock'));
  const capexPct = capex > 0 && gb > 0 ? (capex / gb) * 100 : NaN;
  const overrunV = gv('overrun', 'Cost Overrun History');
  const overrunRaw = overrunV.v.toLowerCase();
  const cycleV = gv('cycle', 'Cycle Position');
  const cycleRaw = cycleV.v.trim().toUpperCase();
  const wcRaw = (g('wc') || '').toLowerCase();
  const brownV = gv('brownfield', 'Brownfield');
  const brownRaw = brownV.v.toLowerCase();
  const priorV = gv('mgmtHistory', 'Prior Capex Success');
  const revCagr = num(g('revCagr'));
  const peVsMean = num(g('peVsMean'));
  const indGrowth = num(g('industryGrowth'));

  const factors: Factor[] = [];
  let gaps = 0;
  const add = (id: number, tier: 1 | 2 | 3 | 4, label: string, max: number, pts: number | null, note: string, isEst = false) => {
    if (pts === null) { gaps++; factors.push({ id, label, pts: 0, max, note: 'no data', tier }); }
    else { if (isEst) estUsed++; factors.push({ id, label, pts, max, note: note + (isEst ? ' (est)' : ''), tier }); }
  };

  // T1 (50)
  add(1, 1, 'Pre-CAPEX ROCE/ROIC', 12, isNaN(roce) ? null :
    roce >= 20 ? 12 : roce >= 15 ? 9 : roce >= 10 ? 6 : roce >= 5 ? 3 : 0, isNaN(roce) ? '' : roce.toFixed(1) + '%');
  add(2, 1, 'Anchor demand visibility', 12, isNaN(anchor) ? null :
    anchor > 60 ? 12 : anchor >= 40 ? 9 : anchor >= 20 ? 6 : anchor >= 10 ? 3 : 0, isNaN(anchor) ? '' : anchor.toFixed(0) + '% covered');
  add(3, 1, 'D/E at announcement', 11, isNaN(de) ? null :
    de < 0.3 ? 11 : de < 0.5 ? 9 : de < 1.0 ? 7 : de < 1.5 ? 4 : 0, isNaN(de) ? '' : de.toFixed(2) + 'x');
  add(4, 1, 'OCF status', 8, isNaN(ocfYears) ? null :
    ocfYears >= 5 ? 8 : ocfYears >= 3 ? 6 : ocfYears >= 1 ? 3 : 0, isNaN(ocfYears) ? '' : ocfYears < 0 ? 'negative' : Math.min(Math.round(ocfYears), 10) + 'y positive');
  add(5, 1, 'Funding source', 7, isNaN(internal) ? null :
    internal > 70 ? 7 : internal >= 40 ? 5 : internal >= 20 ? 3 : 0, isNaN(internal) ? '' : internal.toFixed(0) + '% internal', fundEst);
  // T2 (25)
  add(6, 2, 'Capacity utilization', 6, isNaN(util) ? null :
    util > 90 ? 6 : util >= 85 ? 5 : util >= 75 ? 3 : util >= 60 ? 1 : 0, isNaN(util) ? '' : util.toFixed(0) + '%', utilV.est);
  let f7: number | null = null, f7n = '';
  if (country === 'IN') {
    if (!isNaN(promoterV) || !isNaN(pledge)) {
      const p = isNaN(promoterV) ? 0 : promoterV; const pl = isNaN(pledge) ? 0 : pledge;
      f7 = pl > 30 ? 0 : p > 60 && pl === 0 ? 6 : p >= 40 && pl < 10 ? 4 : p >= 30 && pl < 30 ? 2 : 0;
      f7n = 'prom ' + (isNaN(promoterV) ? '—' : p.toFixed(0) + '%') + ' · pledge ' + (isNaN(pledge) ? '0' : pl.toFixed(0)) + '%';
    }
  } else if (!isNaN(tenureV)) {
    f7 = tenureV > 10 ? 6 : tenureV >= 5 ? 4 : tenureV >= 0 ? 2 : 0; f7n = 'CEO tenure ' + tenureV.toFixed(0) + 'y';
  }
  add(7, 2, country === 'IN' ? 'Promoter quality' : 'Founder-CEO', 6, f7, f7n);
  add(8, 2, 'EBITDA margin', 5, isNaN(ebitda) ? null :
    ebitda > 25 ? 5 : ebitda >= 20 ? 4 : ebitda >= 15 ? 3 : ebitda >= 10 ? 1 : 0, isNaN(ebitda) ? '' : ebitda.toFixed(1) + '%');
  add(9, 2, 'Capex size sweet spot', 4, isNaN(capexPct) ? null :
    capexPct >= 50 && capexPct <= 150 ? 4 : (capexPct >= 30 && capexPct < 50) || (capexPct > 150 && capexPct <= 200) ? 2 : 0,
    isNaN(capexPct) ? '' : capexPct.toFixed(0) + '% of gross block');
  add(10, 2, 'Cost-overrun record', 4, !overrunRaw ? null :
    /^(n|no|none|zero|0)/.test(overrunRaw) ? 4 : /minor|<10/.test(overrunRaw) ? 2 : 0, overrunV.v, overrunV.est);
  // T3 (15)
  add(11, 3, 'Cycle timing', 4, !cycleRaw ? null :
    cycleRaw.startsWith('M') ? 4 : cycleRaw.startsWith('E') ? 2 : 0,
    cycleRaw.startsWith('M') ? 'mid-cycle' : cycleRaw.startsWith('E') ? 'early' : cycleRaw ? 'peak' : '', cycleV.est);
  add(12, 3, 'Working-capital trend', 3, !wcRaw ? null :
    /stable|improv|s\b|i\b/.test(wcRaw) ? 3 : 0, g('wc') || '');
  add(13, 3, 'Revenue CAGR 3-yr', 3, isNaN(revCagr) ? null :
    revCagr >= 12 && revCagr <= 25 ? 3 : (revCagr >= 5 && revCagr < 12) || (revCagr > 25 && revCagr <= 35) ? 1 : 0,
    isNaN(revCagr) ? '' : revCagr.toFixed(0) + '%');
  add(14, 3, 'Brownfield vs greenfield', 3, !brownRaw ? null :
    /brown|^y/.test(brownRaw) ? 3 : /hybrid|mix/.test(brownRaw) ? 1 : 0, brownV.v, brownV.est);
  add(15, 3, 'Policy support', 2, !(g('policy') || '').trim() ? null :
    /pli|ira|chips|mandate|^y/i.test(g('policy')!) ? 2 : /indirect|partial/i.test(g('policy')!) ? 1 : 0, (g('policy') || '').slice(0, 24));
  // T4 (10)
  add(16, 4, 'Industry growth', 2, isNaN(indGrowth) ? null : indGrowth > 2 ? 2 : indGrowth >= 1 ? 1 : 0,
    isNaN(indGrowth) ? '' : indGrowth.toFixed(1) + 'x GDP');
  add(17, 4, 'Import substitution', 2, yes(g('importSub')) === null ? null : yes(g('importSub')) ? 2 : 0, '');
  add(18, 4, 'Export opportunity', 1, yes(g('exportOpp')) === null ? null : yes(g('exportOpp')) ? 1 : 0, '');
  add(19, 4, 'Valuation vs 5-yr mean', 2, isNaN(peVsMean) ? null :
    peVsMean < 1 ? 2 : peVsMean <= 1.5 ? 1 : 0, isNaN(peVsMean) ? '' : peVsMean.toFixed(2) + 'x mean');
  add(20, 4, 'Competitive moat', 2, yes(g('moat')) === null ? null : yes(g('moat')) ? 2 : 0, '');
  const priorYes = yes(priorV.v);
  add(21, 4, 'Prior capex success', 1, priorYes === null ? null : priorYes ? 1 : 0, '', priorV.est);

  const base = factors.reduce((s, f) => s + f.pts, 0);
  const tiers = [1, 2, 3, 4].map((t) => ({
    label: 'T' + t,
    pts: factors.filter((f) => f.tier === t).reduce((s, f) => s + f.pts, 0),
    max: factors.filter((f) => f.tier === t).reduce((s, f) => s + f.max, 0),
  }));

  // Deal breakers (§12.3)
  const dbList: string[] = [];
  if (de > 1.5) dbList.push('DB1 D/E>1.5x');
  if (ocfYears <= 0) dbList.push('DB2 OCF negative');
  if (pledge > 30) dbList.push('DB3 Pledge>30%');
  if (debtPct > 70) dbList.push('DB4 Debt-funded>70%');
  if (!isNaN(anchor) && anchor < 25) dbList.push('DB5 Anchor<25%');
  if (!isNaN(roce) && roce < 8) dbList.push('DB6 ROCE<cost of debt');
  const dbCount = dbList.length;

  const im = IND_MULT.find(([re]) => re.test(industry) || re.test(sector));
  const mult = im ? im[1] : 1.0;
  let final = Math.round(base * mult);
  if (dbCount >= 3) final = Math.min(30, final);
  final = Math.max(0, Math.min(100, final));

  // Decision bands (§12.4)
  let [decision, decisionColor, position, hit] =
    final >= 85 ? ['ANCHOR BUY', C.gold, '4-6%', '88%'] :
    final >= 70 ? ['CORE BUY', C.green, '3-4%', '72%'] :
    final >= 55 ? ['SATELLITE', C.cyan, '1.5-2.5%', '55%'] :
    final >= 40 ? ['WATCHLIST', C.amber, '0%', '—'] :
    final >= 25 ? ['AVOID', C.orange, '0%', '—'] : ['REJECT', C.red, '0%', '—'];

  // Missing data is NOT bad data. With est-fills a Screener-only row carries
  // ~7-8 true gaps and deserves a REAL verdict; NEEDS DATA only at ≥10 gaps.
  const availMax = factors.reduce((s, f) => s + (f.note === 'no data' ? 0 : f.max), 0);
  const measuredPct = availMax > 0 ? Math.round((base / availMax) * 100) : 0;
  const needsData = gaps >= 10 && dbCount < 3 && final < 70;
  if (needsData) { decision = 'NEEDS DATA'; decisionColor = C.violet; position = '—'; hit = '—'; }

  // Confidence (§12.5): completeness + industry proxy; any est ⇒ cap MEDIUM
  const filled = 21 - gaps;
  let confidence: Scored['confidence'] =
    filled >= 17 && mult >= 1.0 ? 'HIGH' : filled >= 12 ? 'MEDIUM' : 'LOW';
  if (estUsed > 0 && confidence === 'HIGH') confidence = 'MEDIUM';
  const positionFinal = confidence === 'LOW' && (final >= 55) ? position + ' → halve (LOW conf)' : position;

  // ── TELEMETRY (parser-derived) + Framework cross-checks ───────────────────
  const phase = (r['Capex Phase'] || '').trim();
  const capexToSales = num(r['Capex/Sales %']);
  const cwipRatio = num(r['CWIP/NetBlock %']);
  const capexAccel = num(r['Capex Accel x']);
  const deChange = num(r['D/E change 2y']);
  const selfFund = num(r['OCF/Capex 3y %']);
  const netDebtEbitda = num(r['Net Debt/EBITDA']);
  const capexPreRev = num(r['Capex/PreRev %']);
  const utilEff = num(r['Util Effective % (est)']);
  const nbGrowth = num(r['NB Growth %']);
  const revYoY = num(r['Rev YoY %']);
  let capexSeries: { y: string; v: number }[] = [];
  try { const cs = JSON.parse(r['Capex Series'] || '[]'); if (Array.isArray(cs)) capexSeries = cs; } catch {}
  const cycleNote = (r['Prior Cycle Note'] || '').trim();

  // ── STAGE A-F classification (Framework Phase 2 + 5) ──────────────────────
  // stage input: MANUAL utilization → asset-sweat proxy (utilEff). The F6
  // '(est)' announcement heuristic is deliberately excluded — it floors at 65
  // and would misplace freshly-commissioned plants up the arc.
  const utilManualStr = String(r['Capacity Utilization %'] ?? '').trim() ||
    (h['util'] && !/\(est\)/i.test(h['util']) ? String(r[h['util']] ?? '').trim() : '');
  const utilManual = num(utilManualStr);
  const uEff = !isNaN(utilManual) ? utilManual : !isNaN(utilEff) ? utilEff : util;
  const activeBuild = phase === 'BUILDING' || phase === 'RAMPING' || capexAccel > 1.5 || cwipRatio > 15;
  const commissioned = nbGrowth > 25; // block just jumped — CWIP rolled into Net Block
  // Pre-commissioning the NEW capacity is offline by definition ⇒ Stage A no
  // matter how hot the OLD assets run (that heat is F6's job). Utilization
  // maps to B-F only AFTER a commissioning event (Net Block jump).
  let stage = '';
  if (isFinite(capexToSales) || isFinite(cwipRatio) || !isNaN(uEff)) {
    if (commissioned) {
      if (isNaN(uEff) || uEff < 30) stage = 'B';
      else if (uEff < 50) stage = 'C';
      else if (uEff < 70) stage = 'D';
      else if (uEff <= 90) stage = 'E';
      else stage = 'F';
    } else if (activeBuild) stage = 'A';
    else if (!isNaN(uEff) && uEff > 90 && revYoY > 20) stage = 'F';
  }
  // earnings inflection already printed + high util ⇒ F regardless
  if (!isNaN(uEff) && uEff > 70 && revYoY > 25 && capexAccel < 1.2 && (stage === 'D' || stage === 'E')) stage = 'F';
  // NO MAJOR CYCLE: cycle capex <25% of pre-capex revenue AND no spend
  // acceleration ⇒ steady serial-brownfield compounder, Stage A-F N/A.
  const noMajorCycle = isFinite(capexPreRev) && capexPreRev < 25 && !(capexAccel >= 1.5);
  if (noMajorCycle) stage = '—';
  const sm = stage ? STAGE_META[stage] : null;
  const stageLabel = sm ? sm.label : 'NO ACTIVE CYCLE DETECTED';

  // ── monitoring triggers (Masterclass App.A) + sell signals (Framework P6) ─
  const watch: string[] = [];
  if (deChange > 0.3) watch.push('D/E rose +' + deChange.toFixed(2) + 'x in 2y — Appendix-A construction trigger (>+0.3x = flag)');
  if (phase === 'BUILDING' && selfFund < 50) watch.push('Building while OCF covers only ' + (isNaN(selfFund) ? '0' : selfFund.toFixed(0)) + '% of capex — funding-stress watch');
  if (phase === 'BUILDING' && /deterior/i.test(g('wc') || '')) watch.push('WC deteriorating mid-build — the classic failure tell');
  if (netDebtEbitda > 3) watch.push('Net Debt/EBITDA ' + netDebtEbitda.toFixed(1) + 'x > 3x — MECHANICAL REJECT rule (Framework M6) if it persists 2 quarters');
  else if (netDebtEbitda > 2) watch.push('Net Debt/EBITDA ' + netDebtEbitda.toFixed(1) + 'x — above the 2x clean-sheet line at peak capex');
  if (capexPreRev > 100) watch.push('Cycle capex ≈' + capexPreRev.toFixed(0) + '% of pre-capex revenue — far above the 30-60% sweet spot (bet-the-company territory)');
  const sells: string[] = [];
  if (!isNaN(uEff) && uEff > 90) sells.push('Utilization >90% — operating leverage exhausted (sell signal 1)');
  if (!isNaN(uEff) && uEff > 85 && capexAccel > 1.5) sells.push('High util + NEW larger capex cycle announced — T5 distribution zone (sell signal 2)');
  if (peVsMean > 1.5) sells.push('Multiple above prior-cycle peak (PE ' + peVsMean.toFixed(1) + 'x own mean) — sell signal 5');
  if (!isNaN(roce) && roce > 35) sells.push('ROCE ' + roce.toFixed(0) + '% prints above the 35-40% mean-reversion band — sell signal 4');

  // ── ENTRY VERDICT = quality band ∩ stage ──────────────────────────────────
  const quality = needsData ? 'NEEDS' : final >= 85 ? 'ANCHOR' : final >= 70 ? 'CORE' : final >= 55 ? 'SAT' : final >= 40 ? 'WATCH' : 'BAD';
  const proven = priorYes === true;
  let entry = '', entryColor = C.dim, entryShort = '';
  if (quality === 'BAD') {
    entry = '⛔ NO ENTRY at any stage — quality band ' + decision + ' (' + (dbCount ? dbCount + ' deal-breakers; ' : '') + 'capital-impairment cohort). Stage is irrelevant when quality fails.';
    entryColor = C.red; entryShort = 'NO ENTRY';
  } else if (quality === 'NEEDS') {
    entry = '🧩 Verdict pending data — ' + measuredPct + '% on measured evidence' + (stage ? ' · telemetry reads Stage ' + stage : '') + '. Fill anchor %, promoter/pledge and utilization below for the real call.';
    entryColor = C.violet; entryShort = 'FILL DATA';
  } else if (stage === '—') {
    entry = '⚪ No discrete capex cycle underway (capex ' + (isFinite(capexPreRev) ? capexPreRev.toFixed(0) : '?') + '% of pre-capex revenue, below the 30-60% multibagger sweet spot' + (isFinite(capexAccel) ? '; spend accel ' + capexAccel.toFixed(1) + 'x' : '') + ') — judge as a steady compounder on the ' + decision + ' quality band; track for a real cycle announcement.';
    entryColor = quality === 'ANCHOR' || quality === 'CORE' ? C.blue : quality === 'SAT' ? C.cyan : C.amber;
    entryShort = quality === 'ANCHOR' || quality === 'CORE' ? 'STEADY COMPOUNDER' : quality === 'SAT' ? 'COMPOUNDER — MID QUALITY' : 'NO CYCLE — WATCH';
  } else if (stage === 'F') {
    entry = '🚫 DO NOT CHASE — Stage F (earnings inflection already printed). Net-negative cohort in the 250-case data.' + (sells.length ? ' ' + sells[0] : '') + (quality === 'ANCHOR' || quality === 'CORE' ? ' If already holding: run the staircase exit (⅓ per sell signal).' : '');
    entryColor = C.red; entryShort = 'DO NOT CHASE';
  } else if (stage === 'E') {
    entry = '⚠ LATE (Stage E, 70-90% util) — most of the operating leverage is done. Enter only with a 30%+ valuation cushion' + (!isNaN(peVsMean) ? ' (PE now ' + peVsMean.toFixed(2) + 'x own mean' + (peVsMean < 0.9 ? ' — cushion EXISTS)' : ' — no cushion)') : '') + '. Max 0.5-1%.';
    entryColor = C.amber; entryShort = 'LATE — CUSHION ONLY';
  } else if (stage === 'C' && (quality === 'ANCHOR' || quality === 'CORE')) {
    entry = '🎯 BUY NOW — quality ' + decision + ' ∩ Stage C: the modal winner entry (~55% of 250-case winners entered here). Size ' + (quality === 'ANCHOR' ? '3.5%+' : '2-3.5%') + '; plant live, GAAP inflection not yet printed.';
    entryColor = C.gold; entryShort = 'BUY NOW — MODAL ENTRY';
  } else if (stage === 'D' && (quality === 'ANCHOR' || quality === 'CORE')) {
    entry = '🟢 BUY — second-chance window (Stage D, ~60% util). Size 1.5-2.5%; multiple has expanded so prefer a temporary overhang to enter.';
    entryColor = C.green; entryShort = 'BUY — 2ND CHANCE';
  } else if (stage === 'B' && (quality === 'ANCHOR' || quality === 'CORE')) {
    entry = '🟢 BUY — just commissioned (Stage B): strongest hit-rate entry; consensus has not modeled the ramp. Size 1.5-2.5%, add into Stage C.';
    entryColor = C.green; entryShort = 'BUY — RAMP AHEAD';
  } else if (stage === 'A') {
    entry = proven && quality === 'ANCHOR'
      ? '🌱 EARLY ENTRY PERMITTED — Stage A works only for proven executors with clean sheets, and this name has a delivered prior cycle + ANCHOR quality. Cap at 0.5-1%, add at commissioning.'
      : '⏳ TOO EARLY — Stage A (capital committed, little commissioned) has the worst hit rate' + (proven ? '' : ' and no delivered prior cycle is visible') + '. Wait for commissioning (Stage B) or the ~40% util window (Stage C).';
    entryColor = proven && quality === 'ANCHOR' ? C.teal : C.amber;
    entryShort = proven && quality === 'ANCHOR' ? 'EARLY OK (PROVEN)' : 'TOO EARLY — WAIT';
  } else if ((stage === 'B' || stage === 'C' || stage === 'D') && quality === 'SAT') {
    entry = '🟡 STAGE RIGHT, QUALITY MIDDLING — Stage ' + stage + ' timing window is open but score is SATELLITE (' + final + '). Starter 1-1.5% only after Q1 post-capex confirmation; upgrade triggers below.';
    entryColor = C.cyan; entryShort = 'STARTER ON CONFIRM';
  } else if (quality === 'WATCH') {
    entry = '👁 WATCH — quality below the buy line (' + final + ').' + (stage === 'B' || stage === 'C' ? ' Timing window (Stage ' + stage + ') is open, so re-score fast if weak factors improve — windows close.' : '') + ' No deployment yet.';
    entryColor = C.amber; entryShort = 'WATCH';
  } else {
    entry = (quality === 'ANCHOR' || quality === 'CORE')
      ? '🕰 QUALITY CLEARS (' + decision + ') but no active capex cycle detected — nothing to time. Track for a T0 announcement; at announcement this profile is the Stage A→B archetype.'
      : '🛰 SATELLITE quality, no cycle telemetry — wait for Q1 confirmation after the next capex event before sizing ' + position + '.';
    entryColor = quality === 'ANCHOR' || quality === 'CORE' ? C.blue : C.cyan;
    entryShort = quality === 'ANCHOR' || quality === 'CORE' ? 'QUALITY OK — NO CYCLE' : 'WAIT FOR CYCLE';
  }

  const action = entry;
  const top = [...factors].sort((a, b) => b.pts - a.pts).slice(0, 3).filter((f) => f.pts > 0);
  const weak = factors.filter((f) => f.pts === 0 && f.max >= 4).slice(0, 3);
  const comment =
    'Drivers: ' + (top.map((f) => f.label + ' ' + f.pts + '/' + f.max).join(' · ') || 'none') +
    (weak.length ? ' | Weak: ' + weak.map((f) => f.label).join(' · ') : '') +
    (dbList.length ? ' | ⛔ ' + dbList.join(' · ') : '') +
    (estUsed ? ' | ' + estUsed + ' factor' + (estUsed > 1 ? 's' : '') + ' on (est) values — confirm on concall' : '');

  const th = THEMES.find(([re]) => re.test(industry) || re.test(sector) || re.test(name));

  return {
    name, sector, industry, country, base, final, decision, decisionColor, dbCount, dbList,
    mult, confidence, position: positionFinal, gaps, estUsed, factors, comment, action,
    theme: th ? th[1] : null, roce, de, util: uEff, anchor, debtFund: debtPct, ocfYears, ebitda, pledge, raw: r,
    phase, capexToSales, cwipRatio, capexAccel, deChange, selfFund,
    netDebtEbitda, capexPreRev, utilEff, nbGrowth, revYoY,
    stage, stageLabel, entry, entryColor, entryShort, capexSeries, cycleNote,
    watch, sells, measuredPct, availMax, tiers,
  };
}

// ── CSV parsing (quote-aware) ───────────────────────────────────────────────
function parseCSV(text: string): Row[] {
  const rows: string[][] = []; let cur: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; cur.push(cell); cell = ''; if (cur.some((c) => c.trim() !== '')) rows.push(cur); cur = []; }
    else cell += ch;
  }
  if (cell !== '' || cur.length) { cur.push(cell); if (cur.some((c) => c.trim() !== '')) rows.push(cur); }
  if (rows.length < 2) return [];
  const head = rows[0].map((s) => s.trim());
  return rows.slice(1).map((r) => { const o: Row = {}; head.forEach((hh, i) => { o[hh] = (r[i] ?? '').trim(); }); return o; });
}

function loadSheetJS(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.XLSX) return resolve(w.XLSX);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = () => resolve(w.XLSX); s.onerror = reject;
    document.head.appendChild(s);
  });
}

const TEMPLATE_HEADERS = 'Company Name,Sector,Industry,Country,ROCE 3-yr avg,Capacity Utilization %,D/E ratio,OCF positive years,FCF 3-yr,Internal funding %,Debt funding %,CAPEX size Cr,Gross Block,Annual Revenue,Anchor Demand %,Promoter Holding %,Promoter Pledge %,Founder-CEO Tenure,EBITDA Margin %,Revenue CAGR 3-yr %,Brownfield,Cycle Position,Cost Overrun History,Working Capital Trend,Policy Support,PE vs 5-yr Mean,Import Substitution,Export Opportunity,Competitive Moat,Prior Capex Success';
const TEMPLATE_SAMPLE = 'Interarch Building,Industrials,PEB / Building Products,IN,28,88,0.04,5,120,90,10,400,650,1300,65,60,0,,14,22,Brownfield,Mid,No,Stable,Indirect,0.9,N,Y,Y,Y';

// ── Screener.in workbook parser ─────────────────────────────────────────────
// Mines the "Data Sheet" raw values: quantitative factors, capex telemetry,
// history (prior cycles, funding, utilization proxies) and the Framework
// cross-checks (Net Debt/EBITDA, cycle-capex vs pre-capex revenue). Fields it
// can only estimate are emitted ONLY as '... (est)' — never as empty clean
// headers (so estimates can't be shadowed). Manual edits write clean headers
// and always win.
function parseScreenerWorkbook(XLSX: any, wb: any, fname: string): Row | null {
  try {
    const sheetName = wb.SheetNames.includes('Data Sheet') ? 'Data Sheet' : wb.SheetNames[0];
    const aoa: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true, defval: null });
    const lab = (r: any[]) => String((r && r[0]) ?? '').trim().toUpperCase();
    const findIdx = (re: RegExp, from = 0) => aoa.findIndex((r, i) => i >= from && re.test(lab(r)));
    const iName = findIdx(/^COMPANY NAME/);
    if (iName < 0) return null;
    const name = String(aoa[iName][1] ?? '').trim() || fname.replace(/\.(xlsx|xls)$/i, '');
    const iPL = findIdx(/^PROFIT/); const iQ = findIdx(/^QUARTERS/, iPL + 1);
    const iBS = findIdx(/^BALANCE/); const iCF = findIdx(/^CASH FLOW/);
    const iPrice = findIdx(/^PRICE/, iCF + 1); const iDer = findIdx(/^DERIVED/);
    const rowVals = (re: RegExp, from: number, to: number): (number | null)[] => {
      for (let i = Math.max(0, from); i < (to > 0 ? to : aoa.length); i++) {
        if (re.test(lab(aoa[i]))) return (aoa[i] || []).slice(1).map((v: any) => (typeof v === 'number' && isFinite(v) ? v : null));
      }
      return [];
    };
    const sales = rowVals(/^SALES$/, iPL, iQ);
    const pbt = rowVals(/^PROFIT BEFORE/, iPL, iQ);
    const dep = rowVals(/^DEPRECIATION/, iPL, iQ);
    const intr = rowVals(/^INTEREST/, iPL, iQ);
    const oi = rowVals(/^OTHER INCOME/, iPL, iQ);
    const np = rowVals(/^NET PROFIT/, iPL, iQ);
    const eq = rowVals(/^EQUITY SHARE C/, iBS, iCF);
    const res = rowVals(/^RESERVES/, iBS, iCF);
    const bor = rowVals(/^BORROWINGS/, iBS, iCF);
    const nb = rowVals(/^NET BLOCK/, iBS, iCF);
    const cwip = rowVals(/^CAPITAL WORK/, iBS, iCF);
    const cashBank = rowVals(/^CASH & BANK/, iBS, iCF);
    const recv = rowVals(/^RECEIVABLES/, iBS, iCF);
    const inv = rowVals(/^INVENTORY/, iBS, iCF);
    const ocf = rowVals(/^CASH FROM OPER/, iCF, iPrice > 0 ? iPrice : aoa.length);
    const priceRow = iPrice >= 0 ? (aoa[iPrice] || []).slice(1).map((v: any) => (typeof v === 'number' ? v : null)) : [];
    const shares = rowVals(/^ADJUSTED EQUIT/, iDer, aoa.length);
    const mcapRow = aoa.find((r) => /^MARKET CAPITAL/.test(lab(r)));
    const mcap = mcapRow && typeof mcapRow[1] === 'number' ? mcapRow[1] : NaN;
    const last = (a: (number | null)[]) => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null) return i; return -1; };
    const c = last(sales); if (c < 0) return null;
    const at = (a: (number | null)[], i: number) => (i >= 0 && i < a.length && a[i] !== null ? (a[i] as number) : NaN);
    const salesL = at(sales, c);
    const ebitdaCr = at(pbt, c) + at(intr, c) + at(dep, c) - (at(oi, c) || 0);
    const ebitdaM = (ebitdaCr / salesL) * 100;
    const s3 = at(sales, c - 3);
    const cagr = s3 > 0 ? (Math.pow(salesL / s3, 1 / 3) - 1) * 100 : NaN;
    const revYoY = at(sales, c - 1) > 0 ? (salesL / at(sales, c - 1) - 1) * 100 : NaN;
    const bc = last(eq.length ? eq : res);
    const deV = at(bor, bc) / (at(eq, bc) + at(res, bc));
    const roces: number[] = [];
    for (let k = 0; k < 3; k++) {
      const i = bc - k; const ce = at(eq, i) + at(res, i) + (at(bor, i) || 0);
      const ebit = at(pbt, i) + (at(intr, i) || 0);
      if (isFinite(ce) && ce > 0 && isFinite(ebit)) roces.push((ebit / ce) * 100);
    }
    const roce = roces.length ? roces.reduce((a, b) => a + b, 0) / roces.length : NaN;
    let ocfYears = 0; const oc = last(ocf);
    for (let i = oc; i >= 0; i--) { const v = ocf[i]; if (v !== null && v > 0) ocfYears++; else if (v !== null) break; }
    const gbV = (at(nb, bc) || 0) + (at(cwip, bc) || 0);
    const capexEst = Math.max(0, (at(nb, bc) - at(nb, bc - 1)) + (at(cwip, bc) - at(cwip, bc - 1)) + (at(dep, c) || 0));
    let peVsMean = NaN;
    const pes: number[] = [];
    for (let i = 0; i < priceRow.length; i++) {
      const p = priceRow[i]; const n = at(np, i); const sh = at(shares, i);
      if (p && n > 0 && sh > 0) pes.push((p * sh) / n);
    }
    const npL = at(np, c);
    if (pes.length >= 2 && mcap > 0 && npL > 0) peVsMean = (mcap / npL) / (pes.reduce((a, b) => a + b, 0) / pes.length);
    // ── telemetry: capex series (ΔNB + ΔCWIP + Dep per year) ─────────────────
    const capexSeries: number[] = [];
    for (let i = 1; i <= bc; i++) {
      const v = (at(nb, i) - at(nb, i - 1)) + ((at(cwip, i) || 0) - (at(cwip, i - 1) || 0)) + (at(dep, i) || 0);
      capexSeries.push(isFinite(v) ? Math.max(0, v) : NaN);
    }
    const cl = capexSeries.length;
    const capexNow = cl ? capexSeries[cl - 1] : NaN;
    const capexPrevAvg = cl >= 3 ? (capexSeries[cl - 2] + capexSeries[cl - 3]) / 2 : cl >= 2 ? capexSeries[cl - 2] : NaN;
    const capexAccel = capexPrevAvg > 0 ? capexNow / capexPrevAvg : NaN;
    const capexToSales = salesL > 0 ? (capexNow / salesL) * 100 : NaN;
    const cwipRatio = at(nb, bc) > 0 ? ((at(cwip, bc) || 0) / at(nb, bc)) * 100 : NaN;
    const nbGrowth = at(nb, bc - 1) > 0 ? (at(nb, bc) / at(nb, bc - 1) - 1) * 100 : NaN;
    const dePrev = at(bor, bc - 2) / (at(eq, bc - 2) + at(res, bc - 2));
    const deChange = isFinite(deV) && isFinite(dePrev) ? deV - dePrev : NaN;
    const wcDays = (i: number) => ((at(recv, i) || 0) + (at(inv, i) || 0)) / (at(sales, i) || NaN) * 365;
    const wcNow = wcDays(bc), wcPrev = wcDays(bc - 2);
    const wcAuto = !isFinite(wcNow) || !isFinite(wcPrev) ? '' : wcNow <= wcPrev * 1.15 ? 'Stable' : 'Deteriorating';
    let ocf3 = 0, cap3 = 0;
    for (let k = 0; k < 3; k++) { const o = at(ocf, oc - k); const cx = capexSeries[cl - 1 - k]; if (isFinite(o)) ocf3 += o; if (isFinite(cx)) cap3 += cx; }
    const selfFund = cap3 > 0 ? (ocf3 / cap3) * 100 : NaN;
    const phase =
      !isFinite(capexNow) ? '' :
      cwipRatio > 15 || capexAccel > 1.6 ? 'BUILDING' :
      nbGrowth > 30 && cwipRatio < 15 ? 'RAMPING' :
      capexToSales < 4 ? 'MAINTENANCE' : 'STEADY';
    // ── Framework cross-checks ───────────────────────────────────────────────
    const netDebt = at(bor, bc) - (at(cashBank, bc) || 0);
    const ndEbitda = isFinite(netDebt) && ebitdaCr > 0 ? netDebt / ebitdaCr : NaN;
    // cycle capex vs pre-capex revenue (30-60% sweet spot): trailing build window
    const baseVals = capexSeries.slice(0, Math.max(0, cl - 3)).filter((v) => isFinite(v));
    const baseline = baseVals.length ? baseVals.sort((a, b) => a - b)[Math.floor(baseVals.length / 2)] : NaN;
    let winStart = cl; let cycleCapex = 0;
    for (let i = cl - 1; i >= 0 && cl - i <= 4; i--) {
      const cut = Math.max(isFinite(baseline) ? 1.8 * baseline : Infinity, 0.06 * (at(sales, i + 1) || Infinity));
      if (isFinite(capexSeries[i]) && capexSeries[i] > cut) { cycleCapex += capexSeries[i]; winStart = i; } else break;
    }
    const preRev = winStart < cl ? at(sales, winStart) : NaN;
    const capexPreRev = winStart < cl && preRev > 0 ? (cycleCapex / preRev) * 100 : NaN;
    // ── history mining ───────────────────────────────────────────────────────
    const bsDates = (() => {
      for (let i = iBS; i < iCF; i++) if (/^REPORT DATE/.test(lab(aoa[i]))) {
        return (aoa[i] || []).slice(1).map((v: any) => { const d = v instanceof Date ? v : (typeof v === 'string' ? new Date(v) : null); return d && !isNaN(+d) ? 'FY' + String(d.getFullYear()).slice(2) : ''; });
      }
      return [] as string[];
    })();
    const yr = (i: number) => bsDates[i] || 'Y' + i;
    const roceSeries: (number | null)[] = [];
    for (let i = 0; i <= bc; i++) {
      const ce = at(eq, i) + at(res, i) + (at(bor, i) || 0); const ebit = at(pbt, i) + (at(intr, i) || 0);
      roceSeries.push(isFinite(ce) && ce > 0 && isFinite(ebit) ? (ebit / ce) * 100 : null);
    }
    let priorEst = ''; let lastCycleNote = '';
    for (let i = cl - 3; i >= 2; i--) {
      const prevAvg = ((capexSeries[i - 1] || 0) + (capexSeries[i - 2] || 0)) / 2;
      if (prevAvg > 0 && capexSeries[i] > 1.6 * prevAvg && capexSeries[i] > 0.05 * (at(sales, i + 1) || Infinity)) {
        const bi = i + 1;
        const before = roceSeries[bi - 1] ?? roceSeries[bi];
        const a1 = roceSeries[Math.min(bc, bi + 1)]; const a2 = roceSeries[Math.min(bc, bi + 2)];
        const after = a1 !== null && a2 !== null ? (a1 + a2) / 2 : a1 ?? a2;
        const salesB = at(sales, bi); const salesA = at(sales, Math.min(bc, bi + 2));
        if (before !== null && after !== null && after !== undefined) {
          const delivered = after >= before - 2 && salesA > salesB;
          // calibration: small ROCE dips (within 4pts) or strong sales delivery
          // (≥1.25x) despite a ROCE dip are BORDERLINE, not failures.
          const borderline = !delivered &&
            ((after >= before - 4 && after < before - 2) ||
             (after < before - 2 && salesB > 0 && salesA / salesB >= 1.25));
          priorEst = delivered ? 'Y' : borderline ? '' : 'N';
          lastCycleNote = 'Prior cycle ' + yr(bi) + ' (' + capexSeries[i].toFixed(0) + ' Cr, ' + (capexSeries[i] / prevAvg).toFixed(1) + 'x avg): ROCE ' + before.toFixed(0) + '%→' + after.toFixed(0) + '%, sales ' + salesB.toFixed(0) + '→' + salesA.toFixed(0) + ' ⇒ ' + (delivered ? 'DELIVERED ✓' : borderline ? 'BORDERLINE ~' : 'DID NOT DELIVER ✗');
          break;
        }
      }
    }
    const dBor3 = at(bor, bc) - at(bor, bc - 3);
    const debtEst = cap3 > 0 ? Math.max(0, Math.min(100, (dBor3 / cap3) * 100)) : NaN;
    const internalEst = cap3 > 0 ? Math.max(0, Math.min(100, (Math.max(0, ocf3) / cap3) * 100)) : NaN;
    // utilization at announcement proxy (F6) + current effective utilization (stage)
    const turns: number[] = [];
    for (let i = Math.max(0, bc - 5); i <= bc; i++) { const v = at(sales, i) / at(nb, i); if (isFinite(v) && v > 0) turns.push(v); }
    const turnNow = at(sales, bc) / at(nb, bc); const turnMax = turns.length ? Math.max(...turns) : NaN;
    const utilEst = isFinite(turnNow) && isFinite(turnMax) && turnMax > 0 ? (turnNow >= 0.95 * turnMax ? 88 : turnNow >= 0.8 * turnMax ? 78 : 65) : NaN;
    const utilEff = isFinite(turnNow) && isFinite(turnMax) && turnMax > 0 ? Math.max(5, Math.min(98, Math.round((turnNow / turnMax) * 100))) : NaN;
    const margSeries: number[] = [];
    for (let i = 0; i <= c; i++) { const m = ((at(pbt, i) + at(intr, i) + at(dep, i) - (at(oi, i) || 0)) / at(sales, i)) * 100; if (isFinite(m)) margSeries.push(m); }
    const margMax = margSeries.length ? Math.max(...margSeries) : NaN;
    const cycleEst = !isFinite(peVsMean) ? '' : peVsMean > 1.5 && isFinite(margMax) && ebitdaM >= margMax * 0.95 ? 'Peak' : peVsMean < 0.9 ? 'Mid' : 'Early';
    let cwipStuck = 0;
    for (let i = bc; i >= Math.max(0, bc - 2); i--) { if (((at(cwip, i) || 0) / (at(nb, i) || 1)) > 0.2) cwipStuck++; }
    const overrunEst = cwipStuck >= 3 ? 'Minor <10%' : 'No';
    const seriesJson = JSON.stringify(capexSeries.map((v, i) => ({ y: yr(i + 1), v: isFinite(v) ? Math.round(v) : 0 })));

    const fx = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : '');
    const out: Row = {
      'Company Name': name, Country: 'IN',
      'Capex Phase': phase, 'Capex/Sales %': fx(capexToSales), 'CWIP/NetBlock %': fx(cwipRatio),
      'Capex Accel x': fx(capexAccel, 2), 'D/E change 2y': fx(deChange, 2), 'OCF/Capex 3y %': fx(selfFund, 0),
      'Net Debt/EBITDA': fx(ndEbitda, 2), 'Capex/PreRev %': fx(capexPreRev, 0),
      'Util Effective % (est)': fx(utilEff, 0), 'NB Growth %': fx(nbGrowth, 0), 'Rev YoY %': fx(revYoY, 0),
      'Capex Series': seriesJson, 'Prior Cycle Note': lastCycleNote,
      'Internal funding % (est)': fx(internalEst, 0), 'Debt funding % (est)': fx(debtEst, 0),
      'Capacity Utilization % (est)': fx(utilEst, 0), 'Cycle Position (est)': cycleEst,
      'Cost Overrun History (est)': overrunEst, 'Prior Capex Success (est)': priorEst,
      'Brownfield (est)': 'Brownfield',
      'Working Capital Trend': wcAuto,
      'ROCE 3-yr avg': fx(roce), 'D/E ratio': fx(deV, 2), 'OCF positive years': String(ocfYears),
      'EBITDA Margin %': fx(ebitdaM), 'Revenue CAGR 3-yr %': fx(cagr),
      'Gross Block': fx(gbV, 0), 'CAPEX size Cr': fx(capexEst, 0), 'Annual Revenue': fx(salesL, 0),
      'PE vs 5-yr Mean': fx(peVsMean, 2),
    };
    return out;
  } catch { return null; }
}

const KD = 'mc:capex-tracker:data:v1'; const KN = 'mc:capex-tracker:files:v1';

// ── small visual atoms ──────────────────────────────────────────────────────
const TierBars = ({ s, w = 30 }: { s: Scored; w?: number }) => (
  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }} title={s.tiers.map((t) => t.label + ' ' + t.pts + '/' + t.max).join(' · ')}>
    {s.tiers.map((t) => {
      const pct = t.max ? t.pts / t.max : 0;
      const col = pct >= 0.7 ? C.green : pct >= 0.4 ? C.amber : C.red;
      return (
        <div key={t.label} style={{ width: w }}>
          <div style={{ fontSize: 8, color: C.muted, textAlign: 'center', lineHeight: '8px' }}>{t.label}</div>
          <div style={{ height: 5, borderRadius: 3, background: C.line, overflow: 'hidden' }}>
            <div style={{ width: Math.round(pct * 100) + '%', height: '100%', background: col }} />
          </div>
        </div>
      );
    })}
  </div>
);

const StageChip = ({ stage, big }: { stage: string; big?: boolean }) => {
  const m = stage ? STAGE_META[stage] : null;
  if (!m) return <span style={{ color: C.muted, fontSize: F.xs }}>—</span>;
  return (
    <span title={m.label + ' · entry size ' + m.size} style={{
      display: 'inline-block', fontWeight: 900, color: m.color, background: m.color + '1E',
      border: '1px solid ' + m.color + '66', borderRadius: big ? 10 : 7,
      padding: big ? '4px 12px' : '1px 8px', fontSize: big ? F.md : F.xs,
    }}>
      {stage}
    </span>
  );
};

// T0→T5 timeline with the company's current position marked
const Timeline = ({ s }: { s: Scored }) => {
  const noCycle = s.stage === '—';
  const m = s.stage && !noCycle ? STAGE_META[s.stage] : null;
  const T = [
    ['T0', 'Announced'], ['T1', 'Commissioned'], ['T2', 'Util rising'],
    ['T3', 'Earnings inflect'], ['T4', 'Recognition'], ['T5', 'Peak / new capex'],
  ];
  const lags = ['12-24m', '6-12m', '6-12m', '6-12m', '12-24m'];
  const pct = m ? (m.pos / 5) * 100 : -10;
  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 10, padding: '14px 16px 8px', opacity: noCycle ? 0.45 : 1 }}>
      <div style={{ position: 'relative', height: 4, background: C.line, borderRadius: 2, margin: '12px 6px 4px' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: pct + '%', background: 'linear-gradient(90deg,' + C.violet + ',' + (m ? m.color : C.cyan) + ')', borderRadius: 2 }} />
        {m && (
          <div style={{ position: 'absolute', left: 'calc(' + pct + '% - 9px)', top: -7 }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', background: m.color, border: '3px solid ' + C.bg, boxShadow: '0 0 8px ' + m.color }} />
          </div>
        )}
        {T.map(([t], i) => (
          <div key={t} style={{ position: 'absolute', left: 'calc(' + (i / 5) * 100 + '% - 1px)', top: -3, width: 2, height: 10, background: C.muted }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9.5, color: C.dim, margin: '8px 0 2px' }}>
        {T.map(([t, lbl], i) => (
          <div key={t} style={{ textAlign: i === 0 ? 'left' : i === 5 ? 'right' : 'center', width: '16.6%' }}>
            <b style={{ color: C.txt }}>{t}</b> {lbl}
            {i < 5 && <div style={{ color: C.muted, fontSize: 8.5 }}>→ {lags[i]}</div>}
          </div>
        ))}
      </div>
      {m && (
        <div style={{ marginTop: 8, fontSize: F.xs, color: m.color, fontWeight: 700 }}>
          ● Stage {s.stage} — {m.label} <span style={{ color: C.dim, fontWeight: 400 }}>· {m.note} · framework size {m.size}</span>
        </div>
      )}
      {!m && (
        <div style={{ marginTop: 8, fontSize: F.xs, color: C.muted }}>
          {noCycle
            ? 'NO MAJOR CYCLE — capex is routine/serial-brownfield scale, so the T0→T5 arc does not apply. Re-arm on a real capex announcement.'
            : 'No active capex cycle in the telemetry — nothing to place on the arc yet.'}
        </div>
      )}
    </div>
  );
};

// year-by-year capex strip (clean bars, not a wall of text)
const CapexStrip = ({ s }: { s: Scored }) => {
  const ser = s.capexSeries.filter((d) => d.y);
  if (!ser.length) return null;
  const mx = Math.max(...ser.map((d) => d.v), 1);
  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 10, padding: '10px 12px' }}>
      <div style={{ fontSize: F.xs, fontWeight: 800, color: C.orange, marginBottom: 6 }}>CAPEX BY YEAR (Cr, derived from ΔNB + ΔCWIP + Dep)</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 64 }}>
        {ser.map((d, i) => {
          const lastN = i >= ser.length - 1;
          return (
            <div key={d.y + i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }} title={d.y + ': ' + d.v + ' Cr'}>
              <div style={{ fontSize: 8.5, color: lastN ? C.orange : C.muted, fontWeight: lastN ? 800 : 400 }}>{d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v}</div>
              <div style={{ width: '70%', maxWidth: 26, height: Math.max(2, Math.round((d.v / mx) * 42)), background: lastN ? C.orange : C.blue + '88', borderRadius: '3px 3px 0 0' }} />
              <div style={{ fontSize: 8.5, color: C.muted }}>{d.y}</div>
            </div>
          );
        })}
      </div>
      {s.cycleNote && <div style={{ marginTop: 6, fontSize: F.xs, color: s.cycleNote.includes('DELIVERED ✓') ? C.green : s.cycleNote.includes('BORDERLINE') ? C.amber : C.red }}>🕰 {s.cycleNote}</div>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
export default function CapexTrackerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [tab, setTab] = useState<'board' | 'analytics' | 'model'>('board');
  const [q, setQ] = useState('');
  const [band, setBand] = useState('ALL');
  const [minScore, setMinScore] = useState(0);
  const [sortKey, setSortKey] = useState('final');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const d = localStorage.getItem(KD); const n = localStorage.getItem(KN);
      if (d) setRows(JSON.parse(d)); if (n) setFiles(JSON.parse(n));
    } catch {}
  }, []);

  const persist = (r: Row[], f: string[]) => {
    setRows(r); setFiles(f);
    try { localStorage.setItem(KD, JSON.stringify(r)); localStorage.setItem(KN, JSON.stringify(f)); } catch {}
  };

  const mergeRows = (incoming: Row[], fname: string) => {
    if (!incoming.length) { setMsg('No data rows found in ' + fname); return; }
    const h = resolveHeaders(Object.keys(incoming[0]));
    if (!h['name']) { setMsg('Could not read ' + fname + ': plain tables need a Company Name column (Screener.in Excel exports are auto-detected). Download the template for the flat format.'); return; }
    const key = (r: Row, hh: Record<string, string>) => (r[hh['name']] || '').trim().toLowerCase();
    const merged = [...rows];
    let updated = 0, added = 0;
    for (const inc of incoming) {
      const k = key(inc, h); if (!k) continue;
      const idx = merged.findIndex((r) => key(r, resolveHeaders(Object.keys(r))) === k);
      if (idx >= 0) {
        // field-level merge: incoming non-empty overwrites (so a re-upload of
        // the same workbook regenerates telemetry); manual inputs survive
        // because the parser never emits clean qualitative headers.
        const patch = Object.fromEntries(Object.entries(inc).filter(([, v]) => String(v ?? '').trim() !== ''));
        merged[idx] = { ...merged[idx], ...patch }; updated++;
      } else { merged.push(inc); added++; }
    }
    persist(merged, [...files.filter((f) => f !== fname), fname]);
    setMsg('Loaded ' + fname + ': ' + added + ' added · ' + updated + ' updated · ' + merged.length + ' total (saved — survives reloads)');
  };

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) {
      try {
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          const XLSX = await loadSheetJS();
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array', cellDates: true });
          const screener = parseScreenerWorkbook(XLSX, wb, f.name);
          if (screener) { mergeRows([screener], f.name); continue; }
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json: Row[] = XLSX.utils.sheet_to_json(ws, { raw: false, defval: '' });
          mergeRows(json.map((r) => { const o: Row = {}; Object.keys(r).forEach((k) => { o[String(k).trim()] = String((r as any)[k] ?? '').trim(); }); return o; }), f.name);
        } else {
          mergeRows(parseCSV(await f.text()), f.name);
        }
      } catch (e: any) { setMsg('Failed to read ' + f.name + ': ' + (e?.message || e)); }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const clearAll = () => {
    if (!confirm('Clear ALL saved capex data? This cannot be undone.')) return;
    persist([], []); setMsg('All data cleared.');
  };

  const scored = useMemo(() => {
    if (!rows.length) return [] as Scored[];
    return rows.map((r) => scoreRow(r, resolveHeaders(Object.keys(r)))).sort((a, b) => b.final - a.final);
  }, [rows]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { 'ANCHOR BUY': 0, 'CORE BUY': 0, SATELLITE: 0, 'NEEDS DATA': 0, WATCHLIST: 0, AVOID: 0, REJECT: 0 };
    scored.forEach((s) => { c[s.decision] = (c[s.decision] || 0) + 1; });
    return c;
  }, [scored]);

  const visible = useMemo(() => {
    let v = scored.filter((s) => s.final >= minScore);
    if (band !== 'ALL') v = v.filter((s) => s.decision === band);
    if (q.trim()) { const qq = q.trim().toLowerCase(); v = v.filter((s) => s.name.toLowerCase().includes(qq) || s.industry.toLowerCase().includes(qq)); }
    const get = (s: Scored): number | string => (s as any)[sortKey] ?? 0;
    v = [...v].sort((a, b) => { const x = get(a), y = get(b); return (typeof x === 'string' ? String(x).localeCompare(String(y)) : (x as number) - (y as number)) * sortDir; });
    return v;
  }, [scored, band, q, minScore, sortKey, sortDir]);

  const setSort = (k: string) => { if (sortKey === k) setSortDir((d) => (d === 1 ? -1 : 1)); else { setSortKey(k); setSortDir(-1); } };
  const fmt = (n: number, d = 1) => (isNaN(n) ? '—' : n.toFixed(d));
  const card: any = { background: C.panel, border: '1px solid ' + C.line, borderRadius: 12, padding: 14 };
  const pill = (active: boolean, color: string): any => ({
    fontSize: F.xs, padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontWeight: 800,
    background: active ? color + '26' : C.panel2, border: '1px solid ' + (active ? color : C.line), color: active ? color : C.dim,
  });
  const TH = ({ k, label, right }: { k: string; label: string; right?: boolean }) => (
    <th onClick={() => setSort(k)} style={{ padding: '7px 8px', cursor: 'pointer', whiteSpace: 'nowrap', textAlign: right ? 'right' : 'left', color: sortKey === k ? C.cyan : C.dim, fontSize: F.xs, fontWeight: 800 }}>
      {label}{sortKey === k ? (sortDir === -1 ? ' ▼' : ' ▲') : ''}
    </th>
  );

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE_HEADERS + '\n' + TEMPLATE_SAMPLE + '\n'], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'capex-tracker-template.csv'; a.click();
  };

  // manual edits always write the CLEAN canonical header (wins over est)
  const updateRow = (name: string, canonical: string, value: string) => {
    const next = rows.map((r) => {
      const h = resolveHeaders(Object.keys(r));
      if ((r[h['name']] || '').trim().toLowerCase() !== name.trim().toLowerCase()) return r;
      return { ...r, [canonical]: value };
    });
    persist(next, files);
  };

  const EDIT_FIELDS: [string, string, 'num' | string[]][] = [
    ['Capacity Utilization %', 'util', 'num'], ['Anchor Demand %', 'anchor', 'num'],
    ['Internal funding %', 'internalPct', 'num'], ['Promoter Holding %', 'promoter', 'num'],
    ['Promoter Pledge %', 'pledge', 'num'], ['PE vs 5-yr Mean', 'peVsMean', 'num'],
    ['Brownfield', 'brownfield', ['', 'Brownfield', 'Hybrid', 'Greenfield']],
    ['Cycle Position', 'cycle', ['', 'Mid', 'Early', 'Peak']],
    ['Cost Overrun History', 'overrun', ['', 'No', 'Minor <10%', 'Yes >20%']],
    ['Working Capital Trend', 'wc', ['', 'Stable', 'Improving', 'Deteriorating']],
    ['Policy Support', 'policy', ['', 'PLI/Mandate', 'Indirect', 'None']],
    ['Import Substitution', 'importSub', ['', 'Y', 'N']], ['Export Opportunity', 'exportOpp', ['', 'Y', 'N']],
    ['Competitive Moat', 'moat', ['', 'Y', 'N']], ['Prior Capex Success', 'mgmtHistory', ['', 'Y', 'N']],
    ['Industry', 'industry', 'num'],
  ];

  // current value precedence mirrors the engine: clean → resolver → (est)
  const Editor = ({ s }: { s: Scored }) => {
    const h = resolveHeaders(Object.keys(s.raw));
    const inputStyle: any = { background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '3px 6px', fontSize: F.xs, width: '100%' };
    return (
      <div style={{ marginTop: 10, borderTop: '1px dashed ' + C.line, paddingTop: 8 }}>
        <div style={{ fontSize: F.xs, fontWeight: 800, color: C.violet, marginBottom: 6 }}>
          ✍️ FILL / OVERRIDE THE QUALITATIVE FACTORS (auto-saves, rescores instantly — manual entries beat (est) fills)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 6 }}>
          {EDIT_FIELDS.map(([canonical, hkey, kind]) => {
            const clean = String(s.raw[canonical] ?? '').trim();
            const col = h[hkey];
            const resolved = col && col !== canonical + ' (est)' ? String(s.raw[col] ?? '').trim() : '';
            const est = String(s.raw[canonical + ' (est)'] ?? '').trim();
            const cur = clean || resolved || est;
            const isEst = !clean && !resolved && !!est;
            return (
              <label key={canonical} style={{ fontSize: 10, color: isEst ? C.amber : C.dim }}>
                {canonical}{isEst ? ' · est' : ''}
                {kind === 'num' ? (
                  <input defaultValue={cur} onBlur={(e) => { if (e.target.value !== cur) updateRow(s.name, canonical, e.target.value); }} style={inputStyle} />
                ) : (
                  <select value={cur} onChange={(e) => updateRow(s.name, canonical, e.target.value)} style={inputStyle}>
                    {(kind as string[]).map((o) => <option key={o} value={o}>{o || '—'}</option>)}
                    {cur && !(kind as string[]).includes(cur) && <option value={cur}>{cur}</option>}
                  </select>
                )}
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  // ── expanded detail: entry banner → timeline → telemetry → factors → editor ─
  const Detail = ({ s }: { s: Scored }) => {
    const chip = (txt: string, col: string): any => ({
      fontSize: F.xs, padding: '3px 9px', borderRadius: 8, fontWeight: 700,
      background: col + '14', border: '1px solid ' + col + '44', color: col, whiteSpace: 'nowrap' as const,
    });
    const tile = (label: string, val: string, col: string) => (
      <div style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 8, padding: '6px 10px', minWidth: 96 }}>
        <div style={{ fontSize: 9, color: C.muted, fontWeight: 700, letterSpacing: 0.4 }}>{label}</div>
        <div style={{ fontSize: F.md, fontWeight: 900, color: col }}>{val}</div>
      </div>
    );
    return (
      <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 12, margin: '6px 0 10px', display: 'grid', gap: 10 }}>
        {/* ENTRY VERDICT banner */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', background: s.entryColor + '10', border: '1px solid ' + s.entryColor + '55', borderRadius: 10, padding: '10px 14px' }}>
          <div style={{ fontSize: 30, fontWeight: 900, color: s.decisionColor, lineHeight: 1 }}>{s.final}</div>
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55' }}>{s.decision}</span>
              <StageChip stage={s.stage} />
              <span style={{ fontSize: F.xs, color: C.dim }}>{s.stageLabel}</span>
            </div>
            <div style={{ fontSize: F.sm, color: s.entryColor, fontWeight: 700 }}>{s.entry}</div>
          </div>
        </div>
        <Timeline s={s} />
        {/* telemetry tiles + cross-checks */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {s.phase && tile('PHASE', s.phase, s.phase === 'BUILDING' ? C.orange : s.phase === 'RAMPING' ? C.green : C.dim)}
          {!isNaN(s.capexToSales) && tile('CAPEX/SALES', s.capexToSales.toFixed(1) + '%', C.txt)}
          {!isNaN(s.cwipRatio) && tile('CWIP/BLOCK', s.cwipRatio.toFixed(0) + '%', s.cwipRatio > 30 ? C.amber : C.txt)}
          {!isNaN(s.capexAccel) && tile('SPEND ACCEL', s.capexAccel.toFixed(1) + 'x', s.capexAccel > 1.6 ? C.orange : C.txt)}
          {!isNaN(s.netDebtEbitda) && tile('NET DEBT/EBITDA', s.netDebtEbitda < 0 ? 'net cash' : s.netDebtEbitda.toFixed(2) + 'x', s.netDebtEbitda > 2 ? C.red : C.green)}
          {!isNaN(s.capexPreRev) && tile('CYCLE CAPEX/PRE-REV', s.capexPreRev.toFixed(0) + '%', s.capexPreRev >= 30 && s.capexPreRev <= 60 ? C.green : s.capexPreRev > 100 ? C.red : C.amber)}
          {!isNaN(s.utilEff) && tile('EFF. UTIL (est)', s.utilEff.toFixed(0) + '%', s.utilEff > 90 ? C.red : s.utilEff >= 30 && s.utilEff < 70 ? C.gold : C.txt)}
          {!isNaN(s.selfFund) && tile('OCF/CAPEX 3Y', s.selfFund.toFixed(0) + '%', s.selfFund >= 70 ? C.green : s.selfFund >= 40 ? C.amber : C.red)}
          {!isNaN(s.deChange) && tile('ΔD/E 2Y', (s.deChange >= 0 ? '+' : '') + s.deChange.toFixed(2), s.deChange > 0.3 ? C.red : C.txt)}
        </div>
        {!isNaN(s.capexPreRev) && (
          <div style={{ fontSize: F.xs, color: C.dim, marginTop: -4 }}>
            Framework sweet spot: cycle capex 30-60% of pre-capex revenue.{' '}
            <b style={{ color: s.capexPreRev >= 30 && s.capexPreRev <= 60 ? C.green : s.capexPreRev > 100 ? C.red : C.amber }}>
              {s.capexPreRev < 30 ? 'Below 30% — lever too small for multibagger math.' : s.capexPreRev <= 60 ? 'IN the sweet spot.' : s.capexPreRev <= 100 ? 'Above 60% — execution + leverage risk rising.' : 'Way above — bet-the-company build.'}
            </b>{' '}Net Debt/EBITDA rule: &lt;2x clean at peak capex; &gt;3x for 2 quarters = mechanical reject.
          </div>
        )}
        {(s.watch.length > 0 || s.sells.length > 0) && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {s.watch.map((w, i) => <span key={'w' + i} style={chip('🚨 ' + w, C.red)}>🚨 {w}</span>)}
            {s.sells.map((w, i) => <span key={'s' + i} style={chip('📤 ' + w, C.amber)}>📤 {w}</span>)}
          </div>
        )}
        <CapexStrip s={s} />
        {/* 21 factors grouped by tier with fill bars */}
        <div>
          <div style={{ fontSize: F.xs, fontWeight: 800, color: C.cyan, marginBottom: 6 }}>
            21-FACTOR QUALITY BREAKDOWN — base {s.base} × industry {s.mult.toFixed(2)}{s.dbCount >= 3 ? ' → CAPPED 30 (deal-breakers)' : ''} = <b style={{ color: s.decisionColor }}>{s.final}</b>
            <span style={{ color: C.dim, fontWeight: 400 }}> · measured {s.base}/{s.availMax} ({s.measuredPct}%) · confidence {s.confidence}{s.gaps ? ' · ' + s.gaps + ' gaps' : ''}{s.estUsed ? ' · ' + s.estUsed + ' est' : ''}</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 6 }}>
            {s.factors.map((f) => {
              const nd = f.note === 'no data';
              const pct = f.max ? f.pts / f.max : 0;
              const col = nd ? C.muted : pct >= 0.7 ? C.green : pct > 0 ? C.amber : C.red;
              return (
                <div key={f.id} style={{ background: nd ? C.panel : C.bg, border: '1px solid ' + C.line, borderRadius: 7, padding: '4px 8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.xs }}>
                    <span style={{ color: C.dim }}><b style={{ color: C.muted }}>T{f.tier}</b> F{f.id} {f.label}{f.note && !nd ? ' · ' + f.note : ''}</span>
                    <span style={{ fontWeight: 900, color: col }}>{nd ? 'n/a' : f.pts + '/' + f.max}</span>
                  </div>
                  <div style={{ height: 3, borderRadius: 2, background: C.line, marginTop: 3, overflow: 'hidden' }}>
                    <div style={{ width: Math.round(pct * 100) + '%', height: '100%', background: col }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ fontSize: F.sm, color: C.amber }}>{s.comment}</div>
        <Editor s={s} />
      </div>
    );
  };

  const BAND_ORDER = ['ALL', 'ANCHOR BUY', 'CORE BUY', 'SATELLITE', 'NEEDS DATA', 'WATCHLIST', 'AVOID', 'REJECT'];
  const bandColor = (b: string) => b === 'ANCHOR BUY' ? C.gold : b === 'CORE BUY' ? C.green : b === 'SATELLITE' ? C.cyan : b === 'NEEDS DATA' ? C.violet : b === 'WATCHLIST' ? C.amber : b === 'AVOID' ? C.orange : b === 'REJECT' ? C.red : C.blue;

  const buyNow = useMemo(() => scored.filter((s) => (s.decision === 'ANCHOR BUY' || s.decision === 'CORE BUY') && (s.stage === 'B' || s.stage === 'C' || s.stage === 'D')), [scored]);
  const wrongStage = useMemo(() => scored.filter((s) => (s.decision === 'ANCHOR BUY' || s.decision === 'CORE BUY') && !(s.stage === 'B' || s.stage === 'C' || s.stage === 'D')), [scored]);
  // 'needs:' must only list factors the owner can actually fill/verify —
  // F2 anchor, F6 utilization, F7 promoter, F15 policy, F16 industry growth,
  // F17 import-sub, F20 moat. Never structural ones (capex size, valuation,
  // revenue CAGR, cycle timing) the owner cannot change by research.
  const ACTIONABLE_FACTORS = useMemo(() => new Set([2, 6, 7, 15, 16, 17, 20]), []);
  const upgradeWatch = useMemo(() => scored.filter((s) => s.decision === 'WATCHLIST' || s.decision === 'SATELLITE')
    .map((s) => ({ s, need: s.factors.filter((f) => ACTIONABLE_FACTORS.has(f.id) && f.pts === 0).slice(0, 2) }))
    .sort((a, b) => b.s.final - a.s.final).slice(0, 10), [scored, ACTIONABLE_FACTORS]);

  return (
    <div style={{ maxWidth: 2100, margin: '0 auto', padding: '14px 18px', color: C.txt, fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: C.dim, textDecoration: 'none', fontSize: F.sm }}>← Home</Link>
        <span style={{ fontSize: F.xl, fontWeight: 900, color: C.orange }}>🏗 CAPEX TRACKER</span>
        <span style={{ fontSize: F.sm, color: C.dim }}>quality (200-case masterclass, 21 factors) × timing (250-case Stage A-F arc) → one entry verdict</span>
        <span style={{ fontSize: F.xs, color: C.muted }}>{files.length} file{files.length === 1 ? '' : 's'} · {scored.length} companies (saved locally)</span>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <span onClick={() => setTab('board')} style={pill(tab === 'board', C.cyan)}>☰ Scoreboard</span>
        <span onClick={() => setTab('analytics')} style={pill(tab === 'analytics', C.green)}>🎯 Decision Board</span>
        <span onClick={() => setTab('model')} style={pill(tab === 'model', C.violet)}>📐 The Model</span>
        <span style={{ flex: 1 }} />
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" multiple onChange={(e) => onFiles(e.target.files)} style={{ fontSize: F.xs, color: C.dim }} />
        <button onClick={downloadTemplate} style={{ ...pill(false, C.blue), background: C.panel2 }}>⬇ Input template</button>
        {rows.length > 0 && <button onClick={clearAll} style={{ ...pill(false, C.red) }}>Clear all</button>}
      </div>
      {msg && <div style={{ fontSize: F.sm, color: C.teal, marginBottom: 8 }}>{msg}</div>}

      {!scored.length && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: F.lg, fontWeight: 800 }}>Upload your capex universe (Screener.in Excel exports or CSV)</div>
          <div style={{ fontSize: F.sm, color: C.dim, marginTop: 8, maxWidth: 780, margin: '8px auto' }}>
            Screener workbooks are mined automatically: quantitative factors, capex telemetry, prior-cycle history, stage classification — with (est) fills for what the statements imply.
            Qualitative edges (anchor %, promoter/pledge, policy) are yours to fill inline. Data persists in this browser; re-upload any time to refresh — nothing is lost unless you press Clear all.
          </div>
        </div>
      )}

      {/* ═══ SCOREBOARD ═══ */}
      {tab === 'board' && scored.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', margin: '4px 0 10px', alignItems: 'center' }}>
            {BAND_ORDER.map((b) => (
              <span key={b} onClick={() => setBand(b)} style={pill(band === b, bandColor(b))}>
                {b === 'ALL' ? 'All ' + scored.length : b + ' · ' + (counts[b] || 0)}
              </span>
            ))}
            <input placeholder="search…" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ background: C.panel2, border: '1px solid ' + C.line, color: C.txt, borderRadius: 8, padding: '4px 10px', fontSize: F.sm }} />
            <span style={{ fontSize: F.xs, color: C.dim }}>min score {minScore}</span>
            <input type="range" min={0} max={100} value={minScore} onChange={(e) => setMinScore(+e.target.value)} />
          </div>
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                <TH k="name" label="COMPANY" />
                <TH k="final" label="SCORE" right /><TH k="decision" label="QUALITY" />
                <TH k="stage" label="STAGE" /><TH k="base" label="T1·T2·T3·T4" />
                <TH k="entryShort" label="ENTRY VERDICT" />
                <TH k="confidence" label="CONF" /><TH k="dbCount" label="⛔" right />
                <TH k="roce" label="ROCE%" right /><TH k="de" label="D/E" right />
                <TH k="netDebtEbitda" label="ND/EBITDA" right /><TH k="util" label="UTIL%" right />
                <TH k="anchor" label="ANCHOR%" right />
              </tr></thead>
              <tbody>
                {visible.map((s) => (
                  <ScoreRow key={s.name} s={s} open={open === s.name} toggle={() => setOpen(open === s.name ? null : s.name)} fmt={fmt} Detail={Detail} />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.xs, color: C.muted, marginTop: 8 }}>
            Click any row: T0→T5 timeline, capex-by-year strip, 21-factor bars, telemetry, inline editor. Quality = masterclass score; Stage = where on the utilization arc; the entry verdict is the intersection. Not investment advice.
          </div>
        </>
      )}

      {/* ═══ DECISION BOARD ═══ */}
      {tab === 'analytics' && scored.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
          <div style={{ ...card, border: '1px solid ' + C.gold + '66' }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 4 }}>🎯 BUY NOW — quality ∩ stage · {buyNow.length}</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>ANCHOR/CORE quality AND Stage B/C/D — both models agree. Stage C is the modal winner entry (~55% of 250-case winners).</div>
            {buyNow.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                <span><b>{s.name}</b> <StageChip stage={s.stage} /> <span style={{ color: C.muted }}>{s.industry || s.sector}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision), whiteSpace: 'nowrap' }}>{s.final}{s.confidence === 'LOW' ? ' ⚠' : ''}</span>
              </div>
            ))}
            {!buyNow.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No name clears BOTH filters yet — that is the discipline working.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.blue, marginBottom: 4 }}>⏳ RIGHT QUALITY, WRONG STAGE · {wrongStage.length}</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>Masterclass quality clears but the timing window isn't open — too early (A), too late (E/F) or no cycle. Watch for Stage B/C.</div>
            {wrongStage.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                <span><b>{s.name}</b> <StageChip stage={s.stage} /> <span style={{ color: C.muted, fontSize: F.xs }}>{s.entryShort}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision) }}>{s.final}</span>
              </div>
            ))}
            {!wrongStage.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>Empty — every quality name is also in its window.</div>}
          </div>
          {(['ANCHOR BUY', 'CORE BUY', 'SATELLITE'] as const).map((b) => (
            <div key={b} style={card}>
              <div style={{ fontSize: F.md, fontWeight: 800, color: bandColor(b), marginBottom: 4 }}>
                {b === 'ANCHOR BUY' ? '🥇' : b === 'CORE BUY' ? '🟢' : '🛰'} {b} · {counts[b] || 0}
              </div>
              <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>
                {b === 'ANCHOR BUY' ? '85-100 · 4-6% position · 88% historical hit rate' : b === 'CORE BUY' ? '70-84 · 3-4% · 72% hit rate · verify anchor on concall' : '55-69 · wait for Q1 post-capex confirmation, then 1.5-2.5% · 55%'}
              </div>
              {scored.filter((s) => s.decision === b).slice(0, 10).map((s) => (
                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                  <span><b>{s.name}</b> <StageChip stage={s.stage} />{s.theme && <span style={{ color: C.violet, fontSize: F.xs }}> {s.theme}</span>}</span>
                  <span style={{ fontWeight: 900, color: bandColor(b), whiteSpace: 'nowrap' }}>{s.final}{s.confidence === 'LOW' ? ' ⚠' : ''}</span>
                </div>
              ))}
              {!(counts[b] || 0) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>None in this band.</div>}
            </div>
          ))}
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 4 }}>⛔ Deal-breaker board</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>3+ deal-breakers ⇒ score capped at 30. Historically 80%+ default within 5-7 years.</div>
            {scored.filter((s) => s.dbCount > 0).sort((a, b) => b.dbCount - a.dbCount).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.red, fontSize: F.xs }}>{s.dbList.join(' · ')}</span></span>
                <span style={{ fontWeight: 900, color: s.dbCount >= 3 ? C.red : C.amber }}>{s.dbCount} DB</span>
              </div>
            ))}
            {!scored.some((s) => s.dbCount > 0) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No deal-breakers in the set — clean universe.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 4 }}>🧩 NEEDS DATA — judged on measured evidence only · {counts['NEEDS DATA'] || 0}</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>% = score on factors Screener can prove. Open the row, fill anchor/promoter/pledge for the real verdict.</div>
            {scored.filter((s) => s.decision === 'NEEDS DATA').sort((a, b) => b.measuredPct - a.measuredPct).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.muted }}>· {s.gaps} gaps{s.stage ? ' · Stage ' + s.stage : ''}</span></span>
                <span style={{ fontWeight: 900, color: s.measuredPct >= 70 ? C.green : s.measuredPct >= 50 ? C.amber : C.red }}>{s.measuredPct}% measured</span>
              </div>
            ))}
            {!(counts['NEEDS DATA'] || 0) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>All names carry enough evidence for a verdict.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 4 }}>📈 Upgrade watch — what would change the call</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>Watchlist/Satellite names and the exact factors holding them back.</div>
            {upgradeWatch.map(({ s, need }) => (
              <div key={s.name} style={{ padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <b>{s.name}</b> <span style={{ fontWeight: 900, color: C.amber }}>{s.final}</span>
                <span style={{ color: C.dim }}> — needs: {need.length ? need.map((f) => f.label).join(' + ') : 'data gaps filled'}</span>
              </div>
            ))}
            {!upgradeWatch.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>Nothing on watch.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 4 }}>🔮 2026-2030 theme map (Masterclass Ch.11 Tier-1)</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>Your names matched to the highest-probability forward themes.</div>
            {scored.filter((s) => s.theme).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.violet }}>{s.theme}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision) }}>{s.final}</span>
              </div>
            ))}
            {!scored.some((s) => s.theme) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No theme matches yet.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.teal, marginBottom: 4 }}>⏱ The playbook — entry, sell, monitoring (both docs)</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.75 }}>
              <b style={{ color: C.gold }}>ENTRY:</b> Stage C (~40% util) is the modal winner entry · Stage B strongest hit rate · Stage A only for proven executors with net cash · Stage F = net-negative cohort, never chase.<br />
              <b style={{ color: C.amber }}>SELL (staircase — ⅓ per signal, full exit at 4):</b> ① util &gt;90% ② new larger capex announced ③ EBITDA margin at historical peak ④ ROCE prints &gt;35-40% ⑤ multiple above prior-cycle peak ⑥ "they can't make enough" is consensus.<br />
              <b style={{ color: C.red }}>MECHANICAL EXITS:</b> pledge crosses 50% · Net Debt/EBITDA &gt;3x for 2 quarters · receivables outgrow revenue 3 quarters · foreign acquisition &gt;12x EV/EBITDA.<br />
              <b style={{ color: C.cyan }}>QUARTERLY (Appendix A):</b> spend vs schedule · utilization ramp · D/E creep &gt;+0.3x = flag · OCF stays positive · <b>2 guidance moderations = TRIM 50%, 3 = EXIT FULL.</b>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODEL ═══ */}
      {tab === 'model' && <ModelTab card={card} />}
    </div>
  );
}

// scoreboard row + expandable detail
function ScoreRow({ s, open, toggle, fmt, Detail }: { s: Scored; open: boolean; toggle: () => void; fmt: (n: number, d?: number) => string; Detail: (p: { s: Scored }) => any }) {
  return (
    <>
      <tr onClick={toggle} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: open ? '#16233B' : 'transparent' }}>
        <td style={{ padding: '8px 8px', fontWeight: 800 }}>
          {s.name} <span style={{ fontSize: 10, color: C.muted }}>{s.country === 'US' ? '🇺🇸' : '🇮🇳'}</span>
          <div style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}>{s.industry || s.sector}{s.theme ? ' · ' + s.theme : ''}</div>
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: s.decisionColor, background: s.decisionColor + '14', border: '1px solid ' + s.decisionColor + '44', borderRadius: 9, padding: '3px 10px' }}>{s.final}</span>
        </td>
        <td style={{ padding: '8px 8px' }}><span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55', whiteSpace: 'nowrap' }}>{s.decision}</span></td>
        <td style={{ padding: '8px 8px' }}><StageChip stage={s.stage} />{s.watch.length > 0 && <span title={s.watch.join(' | ')}> 🚨</span>}{s.sells.length > 0 && <span title={s.sells.join(' | ')}> 📤</span>}</td>
        <td style={{ padding: '8px 8px' }}><TierBars s={s} /></td>
        <td style={{ padding: '8px 8px', fontSize: F.xs, fontWeight: 800, color: s.entryColor, whiteSpace: 'nowrap' }}>{s.entryShort}</td>
        <td style={{ padding: '8px 8px', fontSize: F.xs, color: s.confidence === 'HIGH' ? C.green : s.confidence === 'MEDIUM' ? C.amber : C.red }}>{s.confidence}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 900, color: s.dbCount >= 3 ? C.red : s.dbCount ? C.amber : C.muted }}>{s.dbCount || '—'}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.roce)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.de, 2)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right', color: s.netDebtEbitda > 2 ? C.red : s.netDebtEbitda < 0 ? C.green : C.txt }}>{s.netDebtEbitda < 0 ? 'net cash' : fmt(s.netDebtEbitda, 2)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.util, 0)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.anchor, 0)}</td>
      </tr>
      {open && <tr><td colSpan={13} style={{ padding: '0 8px' }}><Detail s={s} /></td></tr>}
    </>
  );
}

// ── 📐 The Model — the COMBINED framework, documented ───────────────────────
function ModelTab({ card }: { card: any }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.cyan, marginBottom: 6 }}>1 · QUALITY — 21 factors, 100 pts (Masterclass Ch.12)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          <b>Tier 1 (50):</b> ROCE/ROIC 12 · Anchor demand 12 · D/E 11 · OCF 8 · Funding source 7<br />
          <b>Tier 2 (25):</b> Utilization 6 · Promoter/Founder 6 · EBITDA 5 · Capex sweet-spot 4 · Overrun record 4<br />
          <b>Tier 3 (15):</b> Cycle timing 4 · WC trend 3 · Rev CAGR 3 · Brownfield 3 · Policy 2<br />
          <b>Tier 4 (10):</b> Industry growth 2 · Import-sub 2 · Export 1 · Valuation 2 · Moat 2 · Prior capex 1<br />
          <span style={{ color: C.dim }}>× industry multiplier: Defence 1.10 · SpecChem 1.08 · CDMO 1.06 · Consumer 1.05 · Cement/PEB 1.03 · Renewables 1.02 · Semis/EMS 1.00 · Banks 0.95 · RE 0.85 · Telecom 0.75 · Airlines 0.70 · Merchant power/Steel 0.65</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>2 · DEAL BREAKERS (any 3 ⇒ score capped at 30)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          DB1 D/E &gt;1.5x · DB2 OCF negative/below maintenance · DB3 pledge &gt;30% / material RPT · DB4 debt-funding &gt;70% · DB5 anchor &lt;25% of new capacity · DB6 ROCE below cost of debt.<br />
          <span style={{ color: C.dim }}>In 38 of 40 India failures, ≥4 of 8 red flags were visible in audited financials TWO YEARS before the announcement. The information was never the problem — discipline was.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>3 · QUALITY BANDS (Ch.12.4) + confidence (§12.5)</div>
        <div style={{ fontSize: F.sm, lineHeight: 1.9 }}>
          <span style={{ color: C.gold }}>85-100 ANCHOR BUY</span> · 4-6% · 88% hit rate<br />
          <span style={{ color: C.green }}>70-84 CORE BUY</span> · 3-4% · 72%<br />
          <span style={{ color: C.cyan }}>55-69 SATELLITE</span> · 1.5-2.5% · 55% · Q1 confirmation first<br />
          <span style={{ color: C.amber }}>40-54 WATCHLIST</span> · <span style={{ color: C.orange }}>25-39 AVOID</span> · <span style={{ color: C.red }}>0-24 REJECT</span><br />
          <span style={{ color: C.dim }}>LOW confidence ⇒ halve the position. Any (est)-filled factor caps confidence at MEDIUM. ≥10 unmeasured factors ⇒ NEEDS DATA, not a fake AVOID.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 6 }}>4 · TIMING — the T0→T5 arc (Framework, ~250 cases)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          T0 announce → <b>12-24m</b> → T1 commission → <b>6-12m</b> → T2 util rises → <b>6-12m</b> → T3 GAAP earnings inflect → <b>6-12m</b> → T4 street recognition → <b>12-24m</b> → T5 peak (new mega-capex announced).<br />
          <span style={{ color: C.dim }}>The institutional alpha window is the 6-18 months BEFORE T3 — execution visible, inflection not yet printed. Entries after T4 are systematically penalized.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>5 · STAGE A-F — entry classification + sizing</div>
        <div style={{ fontSize: F.sm, lineHeight: 1.9 }}>
          {(['A', 'B', 'C', 'D', 'E', 'F'] as const).map((st) => {
            const m = STAGE_META[st];
            return (
              <div key={st} style={{ display: 'flex', gap: 8, alignItems: 'baseline', borderTop: '1px solid ' + C.line, padding: '4px 0' }}>
                <span style={{ fontWeight: 900, color: m.color, minWidth: 16 }}>{st}</span>
                <span style={{ color: C.txt }}><b style={{ color: m.color }}>{m.label}</b> · size {m.size} <span style={{ color: C.dim }}>— {m.note}</span></span>
              </div>
            );
          })}
          <div style={{ color: C.dim, marginTop: 4 }}>Optimal-entry distribution across winners: C ≈55% · B ≈20% · D ≈20% · A only for proven executors · F net-negative.</div>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.teal, marginBottom: 6 }}>6 · WINNER DNA cross-checks (Framework Phase 3)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Cycle capex <b>30-60% of pre-capex revenue</b> (below 25% too small, above 60% leverage/execution risk acute) · <b>Net Debt/EBITDA &lt;2x at peak capex</b> · OCF positive + growing 2y pre-capex · receivable days flat/declining · utilization 65-80% at announcement ("bursting at the seams") · ramp to 85-95% within 18-30 months of T1 (stall below 70% for 24m ⇒ loser cohort) · brownfield &gt; greenfield by 20-30% on multiple · Stage-C entry valuation: PE 18-25x trailing, EV/EBITDA 10-14x; above 40x PE = negative-outcome zone.
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 6 }}>7 · SELL — the staircase (Framework Phase 6)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Six signals: ① utilization &gt;90% on the new plant ② management announces a NEW larger capex cycle ③ EBITDA margin at historical peak band ④ ROCE prints above 35-40% (mean-reverts) ⑤ multiple above prior-cycle peak ⑥ "capacity-constrained" is the consensus narrative.<br />
          <b>Sell ⅓ on the 1st signal, ⅓ on the 2nd, the rest on the 4th.</b> Captured 70-80% of upside while sidestepping the next-cycle 50-80% drawdown. Holding past T5 is the documented failure mode (2008 infra, 2014-16 shale, 2021-22 EV/SPAC).
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>8 · RISK — mechanical rules (Framework Module 6 + Masterclass App.A)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Exit on the print: promoter pledge crosses 50% (led collapse by 6-18m in almost every Indian failure) · Net Debt/EBITDA &gt;3x for 2 consecutive quarters · receivables outgrow revenue for 3 quarters · foreign acquisition above 12x EV/EBITDA · auditor exit / filing delay.<br />
          Quarterly: D/E creep &gt;+0.3x during construction = flag · <b>2 consecutive guidance moderations = TRIM 50% · 3 = EXIT FULL.</b> Single-name cap 5%; theme exposure 15-30% of book.
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.blue, marginBottom: 6 }}>9 · The three universal predictors (Masterclass Ch.6)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          (A) Pre-existing ROCE/ROIC above industry median — 84% of winners.<br />
          (B) Demand visibility BEFORE commitment (anchor &gt;40% of new capacity) — 81%.<br />
          (C) Balance-sheet shock capacity (D/E &lt;1.0) — 79%.<br />
          All three present ⇒ 85%+ success. All three absent ⇒ 80%+ failure.<br />
          <span style={{ color: C.dim }}>Asymmetries: brownfield 72% vs greenfield 51% · internal-funded 76% vs debt-funded 41% · &gt;85% util 74% vs &lt;70% 43% · domestic 68% vs cross-border M&A 37%.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 6 }}>10 · How this page computes it</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Screener workbooks → quantitative factors + telemetry (phase, capex/sales, CWIP ratio, spend accel, ΔD/E, OCF self-funding, Net Debt/EBITDA, cycle-capex/pre-revenue, prior-cycle delivery, utilization proxies — all marked (est) where inferred).<br />
          Stage = commissioning telemetry × effective utilization × inflection status. <b>Entry verdict = quality band ∩ stage</b>, with the Stage-F never-chase override and the proven-executor exception for Stage A. Manual inline edits always overwrite estimates and rescore instantly.
        </div>
      </div>
    </div>
  );
}




