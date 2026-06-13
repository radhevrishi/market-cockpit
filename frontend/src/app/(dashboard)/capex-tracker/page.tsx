'use client';
import ConcallPro from './ConcallPro';
import { classifyTranscriptV2 } from './concallClassifierV2';
import MultibaggerStrips from './MultibaggerStrips';
import CapexPlaybook from './CapexPlaybook';

// ════════════════════════════════════════════════════════════════════════════
// CAPEX TRACKER v5.0 — Company Intelligence Engine.
// Four lenses on ONE dataset: capex QUALITY × TIMING (v4.3 engine, untouched)
// + 🚀 MULTIBAGGER DNA (12-component SQGLP-style score from 10y workbook data)
// + 🔬 FORENSICS (12 fraud-checklist checks codified) + 🎙 CONCALL (local
// transcripts, heuristic extraction → one-click apply to the capex engine)
// → 🧭 VERDICT (fused ranked call with forensic veto).
//
// v4.3 core below — QUALITY × TIMING engine.
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

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

// ── theme (cockpit dark palette) ────────────────────────────────────────────
const C = {
  bg: '#0B1220', panel: '#101A2C', panel2: '#0D1623', line: '#1A2540',
  txt: '#E6EDF7', body: '#AEBBD0', dim: '#8B98AC', muted: '#5B6A82',
  green: '#00E68A', red: '#FF4D6A', amber: '#FFB347', blue: '#4DA6FF',
  cyan: '#22D3EE', violet: '#A78BFA', gold: '#FFD700', teal: '#2DD4BF', orange: '#F0883E',
};
// contrast contract: C.txt = data/values · C.body = any full sentence or explanation
// (readable on the dark bg) · C.dim = SHORT labels only · C.muted = true de-emphasis
// (placeholders, separators, captions) — never sentences, never below 11px for words.
const F = { xs: 11, sm: 12.5, md: 14, lg: 17, xl: 24 };

// section header used across every detail panel — small caps, letter-spaced, accent
const SectionHead = ({ label, color, extra }: { label: string; color: string; extra?: any }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color, textTransform: 'uppercase' as const, whiteSpace: 'nowrap' }}>{label}</span>
    <span style={{ flex: 1, borderBottom: '1px solid ' + C.line, transform: 'translateY(-3px)' }} />
    {extra}
  </div>
);

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
  capexSeries: { y: string; v: number }[]; nbSeries: { y: string; v: number }[]; cwipSeries: { y: string; v: number }[]; cycleNote: string;
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
  ['ndTrend', /nd\/?ebitda trend|^trend nd/i],
  ['wealthDestroying', /^wealth destroying$/i],
];

// Parser TELEMETRY columns are read by exact name in scoreRow and must NEVER
// enter the header race — a loose factor regex matching one of these silently
// corrupts scores (e.g. /ocf/ once read 'OCF/Capex 3y %' as the OCF streak).
const TELEMETRY_COLS = new Set([
  'Capex Phase', 'Capex/Sales %', 'CWIP/NetBlock %', 'Capex Accel x',
  'D/E change 2y', 'OCF/Capex 3y %', 'Net Debt/EBITDA', 'Capex/PreRev %',
  'Util Effective % (est)', 'NB Growth %', 'Rev YoY %', 'Capex Series', 'NB Series', 'CWIP Series', 'Prior Cycle Note', 'ND/EBITDA Trend', 'Wealth Destroying',
  // v5 intelligence columns — JSON blobs, must never win a factor header race
  'Fin Series', 'Fraud Tab', 'Moat Tab',
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
  C: { color: '#FFD700', label: '~40% UTILIZATION (est) — MODAL ENTRY IF QUALITY HOLDS', size: '2-3.5%', pos: 2.2,
    note: 'THE modal optimal entry — ~55% of winners. Depreciation visible, GAAP not yet inflected, consensus extrapolates the depressed margin. Potential alpha window — but only if utilization ramps successfully AND leverage normalizes.' },
  D: { color: '#22D3EE', label: '~60% UTIL (est) — SECOND CHANCE', size: '1.5-2.5%', pos: 2.8,
    note: 'Second-chance entry (~20% of optimal). Typically 5-10x but the multiple has expanded — pair with a temporary sector overhang.' },
  E: { color: '#FFB347', label: '70-90% UTIL (est) — LATE', size: '0.5-1%', pos: 3.6,
    note: 'Operating leverage mostly exhausted. Enter only with a 30%+ valuation cushion to the prior cycle peak.' },
  F: { color: '#FF4D6A', label: '>90% UTIL (est) / INFLECTION PRINTED', size: '0%', pos: 4.6,
    note: 'The documented ANTI-PATTERN. Stage F entries are net NEGATIVE in the 250-case data (Tatva, Anupam, Wolfspeed post-print). Do not chase.' },
  '—': { color: '#8B98AC', label: 'NO MAJOR CYCLE', size: '—', pos: 0,
    note: 'Cycle capex below 25% of pre-capex revenue with no spend acceleration — serial-brownfield steady compounder. The Stage A-F multibagger arc does not apply; judge on quality and wait for a real cycle.' },
};

// ── THE SCORING ENGINE — quality (Ch.12) + timing (Stage A-F) ───────────────
function scoreRow(r: Row, h: Record<string, string>, extras?: Record<string, any>): Scored {
  const g = (k: string) => (extras && k in extras && extras[k] != null) ? extras[k] : r[h[k]];
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
  let industry = (g('industry') || sector).trim();
  // v5.4.6 — when Excel doesn't carry Industry/Sector, infer from company-name patterns.
  // Catches the Yasho-style "INDUSTRIES" + chem signal, plus Pharma/Lifesci/Solar/Cement/etc.
  if (!industry) {
    const NM = name.toUpperCase();
    const inferred =
      /\bPHARMA(?:CEUTICAL)?|\bLIFE\s*SCI|\bDRUGS?\b|\bAPI\b/.test(NM) ? 'Pharma/CDMO' :
      /\b(SOLAR|RENEWABLE|GREEN ENERGY|ENERGIES)\b/.test(NM) ? 'Renewables/Solar' :
      /\b(POWER|ELECTRIC(?:AL)?|TRANSFORMER|TRANSMISSION|GRID)\b/.test(NM) ? 'T&D/Power Equipment' :
      /\b(STEEL|CEMENT|IRON|METAL|MINING|ALUMINIUM)\b/.test(NM) ? 'Steel/Cement/Bulk' :
      /\b(BANK|FINANCE|NBFC|FINSERV|CAPITAL)\b/.test(NM) ? 'Banks/NBFC' :
      /\b(CHEM(?:ICAL)?|SPECIAL(?:ITY|TY))\b/.test(NM) ? 'Specialty Chemicals' :
      /\b(BIMETAL|FORG(?:E|INGS)|BEARING|SPRING|ANCILLAR(?:Y|IES)|MOTORS?|AUTO)\b/.test(NM) ? 'Auto-Ancillary' :
      /\b(ELECTRONICS|SEMICONDUCTOR|EMS)\b/.test(NM) ? 'EMS/Electronics' :
      /\b(EGG|FOOD|BEVERAGE|DAIRY|POULTRY)\b/.test(NM) ? 'Food/FMCG' :
      /\b(DEFEN[CS]E|AEROSPACE|SHIP|ARMS)\b/.test(NM) ? 'Defence/Aerospace' :
      /\b(RAIL|WAGON|LOCO|METRO)\b/.test(NM) ? 'Railways' :
      /\b(IT|SOFTWARE|TECH(?:NOLOG|NOLOGIES))\b/.test(NM) ? 'IT Services' :
      /\b(INDUSTR(?:Y|IES))\b/.test(NM) ? 'Specialty Chemicals' : // common Indian SME default for "X INDUSTRIES"
      /\b(ENGINEERING|MACHINERY|EQUIPMENTS?)\b/.test(NM) ? 'Capital Goods' :
      '';
    if (inferred) industry = inferred;
  }
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
  // F2 (v5.4-ext) — concall-fallback anchor when no manual value (Critique #2)
  // Uses g('orderBookCr' | 'bookToBill' | 'customerCount' | 'exportPct') if extractor populates them.
  // When those fields aren't on the row, all NaN → falls back to original anchor behavior (no regression).
  const __cobk = num(g('orderBookCr'));
  const __cb2b = num(g('bookToBill'));
  const __ccust = num(g('customerCount'));
  const __cexp = num(g('exportPct'));
  let __synAnchor = anchor;
  let __synEst = false;
  if (isNaN(anchor) && (!isNaN(__cb2b) || !isNaN(__cobk) || !isNaN(__ccust) || !isNaN(__cexp))) {
    let __syn = 30;
    if (!isNaN(__cb2b)) __syn = Math.min(85, Math.round(30 + __cb2b * 25));
    else if (!isNaN(__cobk) && __cobk > 0) __syn = 45;
    if (!isNaN(__ccust) && __ccust >= 100) __syn = Math.min(85, __syn + 10);
    if (!isNaN(__cexp) && __cexp >= 30) __syn = Math.min(85, __syn + 5);
    __synAnchor = __syn;
    __synEst = true;
  }
  const __f2Pts = isNaN(__synAnchor) ? null :
    __synAnchor > 60 ? 12 : __synAnchor >= 40 ? 9 : __synAnchor >= 20 ? 6 : __synAnchor >= 10 ? 3 : 0;
  const __f2Note = isNaN(__synAnchor) ? '' :
    __synAnchor.toFixed(0) + '% covered' + (__synEst ? ' (synth)' : '');
  add(2, 1, 'Anchor demand visibility', 12, __f2Pts, __f2Note, __synEst);
  add(3, 1, 'D/E at announcement', 11, isNaN(de) ? null :
    de < 0.3 ? 11 : de < 0.5 ? 9 : de < 1.0 ? 7 : de < 1.5 ? 4 : 0, isNaN(de) ? '' : de.toFixed(2) + 'x');
  add(4, 1, 'OCF status', 8, isNaN(ocfYears) ? null :
    ocfYears >= 5 ? 8 : ocfYears >= 3 ? 6 : ocfYears >= 1 ? 3 : 0, isNaN(ocfYears) ? '' : ocfYears < 0 ? 'negative' : Math.min(Math.round(ocfYears), 10) + 'y positive');
  add(5, 1, 'Funding source', 7, isNaN(internal) ? null :
    internal > 70 ? 7 : internal >= 40 ? 5 : internal >= 20 ? 3 : 0, isNaN(internal) ? '' : internal.toFixed(0) + '% internal', fundEst);
  // T2 (25)
  const utilTele6 = num(r['Util Effective % (est)']);
  const utilF6 = !isNaN(util) && !utilV.est ? util : !isNaN(utilTele6) ? utilTele6 : util;
  add(6, 2, 'Capacity utilization', 6, isNaN(utilF6) ? null :
    utilF6 > 90 ? 6 : utilF6 >= 85 ? 5 : utilF6 >= 75 ? 3 : utilF6 >= 60 ? 1 : 0, isNaN(utilF6) ? '' : utilF6.toFixed(0) + '%', utilV.est || isNaN(util));
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
  // F9 (v5.4) — sector-aware capex sweet spot
  const __sectorTxt = ((industry || '') + ' ' + (sector || '')).toLowerCase();
  let __capexBand: [number, number, number, number, number] = [30, 60, 15, 90, 120];
  if (/util|\bpower\b|transformer|t&d|substation|smart meter|grid/.test(__sectorTxt)) __capexBand = [100, 300, 50, 400, 500];
  else if (/solar|wind|renewable|green energy/.test(__sectorTxt)) __capexBand = [80, 200, 40, 300, 350];
  else if (/pharma|cdmo|cro\b|biolog|special(i?ty)? ?chem/.test(__sectorTxt)) __capexBand = [40, 80, 20, 120, 150];
  else if (/cement|mining|\bsteel\b|metal/.test(__sectorTxt)) __capexBand = [20, 50, 10, 70, 100];
  else if (/\bems\b|electronics manufacturing|asset.?light|saas|cloud/.test(__sectorTxt)) __capexBand = [5, 25, 3, 40, 60];
  const [__bMin, __bMax, __oMin, __oMax, __oHard] = __capexBand;
  const __capexPts = isNaN(capexPct) ? null :
    (capexPct >= __bMin && capexPct <= __bMax) ? 4 :
    (capexPct >= __oMin && capexPct < __bMin) || (capexPct > __bMax && capexPct <= __oMax) ? 2 :
    capexPct > __oHard ? 0 : 1;
  add(9, 2, 'Capex size sweet spot', 4, __capexPts,
    isNaN(capexPct) ? '' : capexPct.toFixed(0) + '% of gross block \u00B7 band ' + __bMin + '-' + __bMax + '%');
  add(10, 2, 'Cost-overrun record', 4, !overrunRaw ? null :
    /^(n|no|none|zero|0)/.test(overrunRaw) ? 4 : /minor|<10/.test(overrunRaw) ? 2 : 0, overrunV.v, overrunV.est);
  // T3 (15)
  add(11, 3, 'Cycle timing', 4, !cycleRaw ? null :
    cycleRaw.startsWith('M') ? 4 : cycleRaw.startsWith('E') ? 2 : 0,
    cycleRaw.startsWith('M') ? 'mid-cycle' : cycleRaw.startsWith('E') ? 'early' : cycleRaw ? 'peak' : '', cycleV.est);
  add(12, 3, 'Working-capital trend', 3, !wcRaw ? null :
    /stable|improv|s\b|i\b/.test(wcRaw) ? 3 : 0, g('wc') || '');
  add(13, 3, 'Revenue CAGR 3-yr', 3, isNaN(revCagr) ? null :
    revCagr >= 12 && revCagr <= 25 ? 3 : revCagr > 25 && revCagr <= 40 ? 2 : (revCagr >= 5 && revCagr < 12) || revCagr > 40 ? 1 : 0,
    isNaN(revCagr) ? '' : revCagr.toFixed(0) + '%' + (revCagr > 40 ? ' (hot)' : ''));
  add(14, 3, 'Brownfield vs greenfield', 3, !brownRaw ? null :
    /brown|^y/.test(brownRaw) ? 3 : /hybrid|mix/.test(brownRaw) ? 1 : 0, brownV.v, brownV.est);
  add(15, 3, 'Policy support', 2, !(g('policy') || '').trim() ? null :
    /pli|ira|chips|mandate|^y/i.test(g('policy')!) ? 2 : /indirect|partial/i.test(g('policy')!) ? 1 : 0, (g('policy') || '').slice(0, 24));
  // T4 (10)
  add(16, 4, 'Industry growth', 2, isNaN(indGrowth) ? null : indGrowth > 2 ? 2 : indGrowth >= 1 ? 1 : 0,
    isNaN(indGrowth) ? '' : indGrowth.toFixed(1) + 'x GDP');
  add(17, 4, 'Import substitution', 2, yes(g('importSub')) === null ? null : yes(g('importSub')) ? 2 : 0, '');
  add(18, 4, 'Export opportunity', 1, yes(g('exportOpp')) === null ? null : yes(g('exportOpp')) ? 1 : 0, '');
  // F19 (v5.4) — valuation × growth (was PE-vs-mean only). Max bumped 2→4. revCagr is PERCENT.
  const __peSig = isNaN(peVsMean) ? null : peVsMean < 0.8 ? 2 : peVsMean < 1 ? 1.5 : peVsMean <= 1.5 ? 0.5 : 0;
  const __growthSig = isNaN(revCagr) ? null : revCagr >= 20 ? 1.5 : revCagr >= 12 ? 1 : revCagr >= 5 ? 0.5 : 0;
  const __valQualBonus = !isNaN(roce) && roce > 20 ? 0.5 : 0;
  const __valPts = (__peSig === null && __growthSig === null) ? null :
    Math.min(4, (__peSig || 0) + (__growthSig || 0) + __valQualBonus);
  const __valNote = (__peSig === null && __growthSig === null) ? '' :
    (isNaN(peVsMean) ? 'pe?' : peVsMean.toFixed(2) + 'x mean') +
    ' · rev ' + (isNaN(revCagr) ? '?' : revCagr.toFixed(0) + '%') +
    (__valQualBonus ? ' · qual+' : '');
  add(19, 4, 'Valuation × growth', 4, __valPts, __valNote);
  add(20, 4, 'Competitive moat', 2, yes(g('moat')) === null ? null : yes(g('moat')) ? 2 : 0, '');
  const priorYes = yes(priorV.v);
  add(21, 4, 'Prior capex success', 1, priorYes === null ? null : priorYes ? 1 : 0, '', priorV.est);

  // F22 (v5.4) — Promoter Quality composite (capital-allocation discipline)
  const pqRoceOk = !isNaN(roce) && roce > 18 ? 1 : 0;
  const pqOcfOk = !isNaN(ocfYears) && ocfYears >= 5 ? 1 : 0;
  const pqDeOk = !isNaN(de) && de < 0.3 ? 1 : 0;
  const pqPledgeOk = !isNaN(pledge) && pledge === 0 ? 1 : 0;
  const pqInternalOk = !isNaN(internal) && internal >= 50 ? 1 : 0;
  const pqPts = pqRoceOk + pqOcfOk + pqDeOk + pqPledgeOk + pqInternalOk;
  const pqMeasured = [roce, ocfYears, de, pledge, internal].filter(x => !isNaN(x)).length;
  add(22, 4, 'Promoter quality', 5,
    pqMeasured === 0 ? null : pqPts,
    pqMeasured === 0 ? '' : pqPts + '/5 (ROCE' + (pqRoceOk?'\u2713':'\u00B7') + ' OCF' + (pqOcfOk?'\u2713':'\u00B7') + ' D/E' + (pqDeOk?'\u2713':'\u00B7') + ' pledge' + (pqPledgeOk?'\u2713':'\u00B7') + ' int-fund' + (pqInternalOk?'\u2713':'\u00B7') + ')');

  // F23 (v5.4) — Score confidence: % of total weight where data was Verified vs Estimated vs Unknown
  const __totalMax = factors.reduce((s, f) => s + f.max, 0);
  const __unknownMax = factors.reduce((s, f) => s + (f.note === 'no data' ? f.max : 0), 0);
  const __estimatedMax = factors.reduce((s, f) => s + (typeof f.note === 'string' && f.note.endsWith(' (est)') ? f.max : 0), 0);
  const __verifiedMax = Math.max(0, __totalMax - __unknownMax - __estimatedMax);
  const __verifiedPct = __totalMax > 0 ? Math.round(__verifiedMax / __totalMax * 100) : 0;
  const __estPct = __totalMax > 0 ? Math.round(__estimatedMax / __totalMax * 100) : 0;
  const __unkPct = Math.max(0, 100 - __verifiedPct - __estPct);
  const __confPts = Math.round(3 * __verifiedPct / 100);
  add(23, 4, 'Score confidence', 3, __confPts,
    'Verified ' + __verifiedPct + '% · Est ' + __estPct + '% · Unknown ' + __unkPct + '%');

  // F24 (v5.4.1) — EPS Inflection setup. Fixes (Yasho audit):
  // 1) use utilF6 (telemetry-fallback) instead of raw util so F6 and F24 agree when manual is (est)
  // 2) capex partial credit from any positive capexPct (not just >15)
  // 3) rev partial credit from any positive revCagr (not just >8%)
  const __f24Util = (!isNaN(utilF6) && utilF6 > 0) ? utilF6 : (!isNaN(util) ? util : NaN);
  const __utilTight = !isNaN(__f24Util) && __f24Util > 0 && __f24Util < 75 ? (75 - __f24Util) / 75 : 0;
  const __capexAlive = !isNaN(capexPct) && capexPct > 0 ? Math.min(1, capexPct / 30) : 0;
  const __revAlive = !isNaN(revCagr) && revCagr > 0 ? Math.min(1, revCagr / 20) : 0;
  const __infScore = __utilTight * 0.40 + __capexAlive * 0.30 + __revAlive * 0.30;
  const __infPts = __infScore > 0.55 ? 4 : __infScore > 0.35 ? 2 : __infScore > 0.15 ? 1 : 0;
  const __infMeasured = !isNaN(__f24Util) || !isNaN(capexPct) || !isNaN(revCagr);
  add(24, 4, 'EPS inflection setup', 4, __infMeasured ? __infPts : null,
    !__infMeasured ? '' : 'util-room ' + (__utilTight * 100).toFixed(0) + '% · capex ' + (__capexAlive * 100).toFixed(0) + '% · rev ' + (__revAlive * 100).toFixed(0) + '%');

  // F25 (v5.4) — Probability composite (heuristic blend of available factors). revCagr is PERCENT.
  const __pUp = (!isNaN(roce) ? Math.min(1, roce / 25) : 0) * 0.20 +
    (!isNaN(revCagr) ? Math.min(1, revCagr / 25) : 0) * 0.25 +
    (!isNaN(peVsMean) ? Math.max(0, 1 - peVsMean) : 0) * 0.15 +
    (!isNaN(ocfYears) ? Math.min(1, ocfYears / 7) : 0) * 0.20 +
    __infScore * 0.20;
  const __pFail = (!isNaN(de) ? Math.min(1, de / 1.5) : 0.5) * 0.35 +
    (!isNaN(ocfYears) && ocfYears <= 0 ? 1 : 0) * 0.25 +
    (!isNaN(pledge) ? Math.min(1, pledge / 30) : 0) * 0.25 +
    (!isNaN(anchor) && anchor < 25 ? 1 : 0) * 0.15;
  const __probRaw = Math.round(3 * (__pUp - __pFail / 2 + 0.5));
  const __probMeasured = !isNaN(roce) || !isNaN(de) || !isNaN(revCagr);
  add(25, 4, 'Probability composite', 3,
    __probMeasured ? Math.max(0, Math.min(3, __probRaw)) : null,
    __probMeasured ? ('P-up ' + Math.round(__pUp * 100) + '% · P-fail ' + Math.round(__pFail * 100) + '%') : '');

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
  // v5.3 — score over the MEASURED weight (like the MB lens). Raw points on a
  // 100-pt scale made ANCHOR/CORE mathematically unreachable: ~25-27 pts
  // (anchor, promoter, policy, moat, industry…) are never in a Screener
  // workbook, so the best possible raw score was ~73. Confidence caps and
  // NEEDS DATA still gate thin evidence; manual fills raise the denominator.
  const availMaxEarly = factors.reduce((s, f) => s + (f.note === 'no data' ? 0 : f.max), 0);
  let final = Math.round((availMaxEarly >= 50 ? (base / availMaxEarly) * 100 : base) * mult);
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
  let nbSeries: { y: string; v: number }[] = [];
  try { const cs = JSON.parse(r['NB Series'] || '[]'); if (Array.isArray(cs)) nbSeries = cs; } catch {}
  let cwipSeries: { y: string; v: number }[] = [];
  try { const cs = JSON.parse(r['CWIP Series'] || '[]'); if (Array.isArray(cs)) cwipSeries = cs; } catch {}
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
  // v5.4.2 — commissioning detection broadened (Yasho audit):
  // Catch POST-commissioning state too: CWIP drained from a peak + prior cycle detected.
  // Previous logic (nbGrowth > 25) only flagged the YEAR of jump, missed the +1y ramp window.
  const cwipDrainedPostCycle = !isNaN(cwipRatio) && cwipRatio < 8 && cycleNote && cycleNote.length > 0 && capexAccel < 1.5;
  const commissioned = nbGrowth > 25 || cwipDrainedPostCycle; // block jumped recently OR CWIP just drained from a real cycle
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
  // v5.4.8 — debt trajectory awareness: rising to 3x is bearish, falling to 3x is recovery
  const ndTrendV = num(g('ndTrend'));
  const trendStr = isFinite(ndTrendV) && Math.abs(ndTrendV) > 0.1
    ? (ndTrendV > 0 ? ' · trending UP +' + ndTrendV.toFixed(2) + 'x YoY (bearish)' : ' · trending DOWN ' + ndTrendV.toFixed(2) + 'x YoY (deleveraging ✓)')
    : '';
  if (netDebtEbitda > 3) {
    if (isFinite(ndTrendV) && ndTrendV < -0.3) {
      watch.push('Net Debt/EBITDA ' + netDebtEbitda.toFixed(1) + 'x > 3x BUT actively deleveraging (' + ndTrendV.toFixed(2) + 'x YoY) — recovery path; re-evaluate next 2 quarters');
    } else {
      watch.push('Net Debt/EBITDA ' + netDebtEbitda.toFixed(1) + 'x > 3x' + trendStr + ' — MECHANICAL REJECT rule (Framework M6) if it persists 2 quarters');
    }
  } else if (netDebtEbitda > 2) {
    watch.push('Net Debt/EBITDA ' + netDebtEbitda.toFixed(1) + 'x' + trendStr + ' — above the 2x clean-sheet line at peak capex');
  }
  // v5.4.8 — wealth destruction trigger: ROCE < 10% (≈WACC) for 2 consecutive years
  const wd = g('wealthDestroying');
  if (wd === 'Y') watch.push('ROCE < cost of capital (~10% WACC proxy) for 2 consecutive years — wealth destruction in progress');
  if (capexPreRev > 100) watch.push('Cycle capex ≈' + capexPreRev.toFixed(0) + '% of pre-capex revenue — far above the 30-60% sweet spot (bet-the-company territory)');
  const sells: string[] = [];
  // v5.4.7 — sell signals 1 & 2 are POST-CYCLE distribution signals (Stage E/F only).
  // For Stage A (new build) or B/C/D (ramp), high util + new capex = demand-pull growth, not exhaustion.
  const postCyclePeak = stage === 'E' || stage === 'F';
  if (!isNaN(uEff) && uEff > 90 && postCyclePeak) sells.push('Utilization >90% — operating leverage exhausted (sell signal 1)');
  if (!isNaN(uEff) && uEff > 85 && capexAccel > 1.5 && postCyclePeak) sells.push('High util + NEW larger capex cycle announced — T5 distribution zone (sell signal 2)');
  if (peVsMean > 1.5) sells.push('Multiple above prior-cycle peak (PE ' + peVsMean.toFixed(1) + 'x own mean) — sell signal 5');
  if (!isNaN(roce) && roce > 35) sells.push('ROCE ' + roce.toFixed(0) + '% prints above the 35-40% mean-reversion band — sell signal 4');

  // ── ENTRY VERDICT = quality band ∩ stage ──────────────────────────────────
  const quality = needsData ? 'NEEDS' : final >= 85 ? 'ANCHOR' : final >= 70 ? 'CORE' : final >= 55 ? 'SAT' : final >= 40 ? 'WATCH' : 'BAD';
  const proven = priorYes === true;
  let entry = '', entryColor = C.dim, entryShort = '';
  if (quality === 'BAD') {
    // v5.4.4 — distinguish leverage-driven AVOID (potentially recoverable) from deep capital-impairment (chronic)
    const leverageDriven = isFinite(netDebtEbitda) && netDebtEbitda > 3 && dbCount <= 2 && (roce > 5);
    const labelTag = leverageDriven
      ? 'leverage-driven AVOID — re-evaluate when Net Debt/EBITDA drops below 2.5x AND ROCE recovers above 12%'
      : 'capital-impairment cohort';
    entry = '⛔ NO ENTRY at current risk profile — quality band ' + decision + ' (' + (dbCount ? dbCount + ' deal-breakers; ' : '') + labelTag + '). Stage window may be open but quality is below the safety floor.';
    entryColor = C.red; entryShort = leverageDriven ? 'NO ENTRY · LEVERAGE' : 'NO ENTRY';
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
    stage, stageLabel, entry, entryColor, entryShort, capexSeries, nbSeries, cwipSeries, cycleNote,
    watch, sells, measuredPct, availMax, tiers,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// v5 INTELLIGENCE LAYER — pure functions over the persisted rows.
// All series math is null-gap tolerant (Screener exports miss early years);
// a metric whose inputs are missing is EXCLUDED and its weight removed from
// the available maximum — same "measured %" philosophy as the 21-factor engine.
// ════════════════════════════════════════════════════════════════════════════

type Fin = {
  years: string[]; sales: (number | null)[]; np: (number | null)[]; pbt: (number | null)[];
  tax: (number | null)[]; oi: (number | null)[]; dep: (number | null)[]; intr: (number | null)[];
  div: (number | null)[]; eq: (number | null)[]; res: (number | null)[]; bor: (number | null)[];
  nb: (number | null)[]; cwip: (number | null)[]; cash: (number | null)[]; recv: (number | null)[];
  inv: (number | null)[]; rm: (number | null)[]; chgInv: (number | null)[]; ocf: (number | null)[]; cfi: (number | null)[]; cff: (number | null)[];
  shares: (number | null)[]; price: (number | null)[]; mcap: number | null; capex: (number | null)[];
};
type MBComp = { id: string; label: string; w: number; pts: number | null; detail: string };
type MBResult = { score: number; grade: string; color: string; available: number; components: MBComp[]; pe: number; peg: number };
type FXCheck = { id: string; label: string; w: number; pts: number | null; detail: string; flag?: string };
type FXResult = { score: number; grade: string; color: string; flags: string[]; critical: boolean; checks: FXCheck[]; workbook: { row: number; label: string; answer: string }[] };
type ConcallExtract = {
  utilization: number | null; utilArr: number[]; orderBook: number | null; capexGuidance: number | null;
  timeline: string[]; anchorPct: number | null;
  growthNote: string | null; marginNote: string | null; demandNote: string | null; __v?: number;
  optimism: number; caution: number; tone: number | null;
  quotes: { field: string; match: string; snippet: string }[];
  customerCount: number | null; exportPct: number | null; pliMentioned: boolean;
};
type ConcallEntry = { id: string; label: string; addedAt: string; chars: number; text: string; extract: ConcallExtract };
type CCState = { freshness: 'FRESH' | 'STALE' | 'NONE'; tone: number | null; utilization: number | null };
type Verdict = { call: string; color: string; why: string; composite: number; note: string; veto: boolean };

const MB_GRADE_COLOR: Record<string, string> = {
  'A+': '#10b981', A: '#34d399', 'B+': '#f59e0b', B: '#f97316', C: '#fb923c', D: '#ef4444', NR: '#5B6A82',
};
const FX_GRADE_COLOR: Record<string, string> = { CLEAN: C.green, WATCH: C.amber, FLAGS: C.orange, AVOID: C.red, NR: C.muted };
const MB_GRADE_ORDER = ['A+', 'A', 'B+', 'B', 'C', 'D'];

function parseFin(r: Row): Fin | null {
  try {
    const f = JSON.parse(r['Fin Series'] || '');
    if (f && Array.isArray(f.years) && Array.isArray(f.sales)) return f as Fin;
    return null;
  } catch { return null; }
}

// null-safe series helpers (v4.3 conventions)
const lastNN = (a: (number | null)[]): number => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && a[i] !== undefined) return i; return -1; };
const firstNN = (a: (number | null)[]): number => { for (let i = 0; i < a.length; i++) if (a[i] !== null && a[i] !== undefined) return i; return -1; };
const av = (a: (number | null)[] | undefined, i: number): number => (a && i >= 0 && i < a.length && a[i] !== null && a[i] !== undefined ? (a[i] as number) : NaN);
const lin01 = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
const cagrPct = (a: number, b: number, n: number): number => (isFinite(a) && isFinite(b) && a > 0 && b > 0 && n > 0 ? (Math.pow(a / b, 1 / n) - 1) * 100 : NaN);
const sumLast = (a: (number | null)[], k: number, end?: number): number => {
  const e = end ?? lastNN(a); let s = 0; let any = false;
  for (let i = Math.max(0, e - k + 1); i <= e; i++) { const v = av(a, i); if (isFinite(v)) { s += v; any = true; } }
  return any ? s : NaN;
};

// ── 🚀 MULTIBAGGER — 12 components, weights sum 100 ─────────────────────────
function computeMultibagger(fin: Fin | null, s: Scored, r: Row, fxGrade: string): MBResult {
  const comps: MBComp[] = [];
  const add = (id: string, label: string, w: number, pts: number | null, detail: string) =>
    comps.push({ id, label, w, pts: pts === null ? null : Math.max(0, Math.min(w, pts)), detail });
  const h = resolveHeaders(Object.keys(r));
  const fxN = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : '—');
  let pe = NaN, peg = NaN;

  if (fin) {
    const sales = fin.sales, np = fin.np;
    const c = lastNN(sales), cn = lastNN(np);
    // 1 · earnings-growth consistency
    {
      let wins = 0, valid = 0;
      for (let i = Math.max(1, cn - 9); i <= cn; i++) {
        const a = av(np, i), b = av(np, i - 1);
        if (!isFinite(a) || !isFinite(b)) continue;
        valid++;
        if (a > 0 && b > 0 && a / b - 1 > 0.15) wins++;
      }
      add('pat_consist', 'Earnings-growth consistency', 10, valid >= 4 ? Math.min(1, wins / 7) * 10 : null, valid >= 4 ? wins + ' of ' + valid + ' yrs PAT YoY >15%' : 'insufficient PAT history');
    }
    // 2 · sales CAGR + acceleration — BLENDED horizons (v5.2 recalibration).
    // A single soft 3y print must not zero a 20%+ long-horizon grower:
    // g = max(cagr3, 0.8×cagr5, 0.7×cagr10) → 8 pts linear from 5% (0) to 25% (full);
    // +2 acceleration bonus when cagr3>cagr5>cagr10 (capped at weight);
    // hard 3y deceleration (cagr3 < cagr5 − 8pp) caps the component at 60%.
    const c3 = cagrPct(av(sales, c), av(sales, c - 3), 3);
    const c5 = cagrPct(av(sales, c), av(sales, c - 5), 5);
    const fi = firstNN(sales);
    const c10 = fi >= 0 && c - fi >= 6 ? cagrPct(av(sales, c), av(sales, fi), c - fi) : NaN;
    const gBlend = Math.max(isFinite(c3) ? c3 : -Infinity, isFinite(c5) ? 0.8 * c5 : -Infinity, isFinite(c10) ? 0.7 * c10 : -Infinity);
    if (isFinite(gBlend) && gBlend > -Infinity) {
      let gp = 8 * lin01(gBlend, 5, 25);
      const accel = isFinite(c3) && isFinite(c5) && isFinite(c10) && c3 > c5 && c5 > c10;
      const accelHalf = !accel && isFinite(c3) && isFinite(c10) && c3 > c10; // 3y still above the 10y trend
      const decel = isFinite(c3) && isFinite(c5) && c3 < c5 - 8;
      if (accel) gp = Math.min(10, gp + 2);
      else if (accelHalf) gp = Math.min(10, gp + 1);
      if (decel) gp = Math.min(gp, 0.6 * 10);
      add('sales_cagr', 'Sales CAGR + acceleration', 10, gp,
        '3y ' + fxN(c3) + '% · 5y ' + fxN(c5) + '% · 10y ' + fxN(c10) + '% → blended ' + fxN(gBlend) + '%' + (accel ? ' — ACCELERATING' : decel ? ' — 3y decelerating (capped)' : ''));
    } else add('sales_cagr', 'Sales CAGR + acceleration', 10, null, 'no sales history');
    // 3 · ROCE level + trajectory
    const roceSer: (number | null)[] = fin.eq.map((_, i) => {
      const ce = av(fin.eq, i) + av(fin.res, i) + (isFinite(av(fin.bor, i)) ? av(fin.bor, i) : 0);
      const ebit = av(fin.pbt, i) + (isFinite(av(fin.intr, i)) ? av(fin.intr, i) : 0);
      return isFinite(ce) && ce > 0 && isFinite(ebit) ? (ebit / ce) * 100 : null;
    });
    {
      const rl = lastNN(roceSer);
      const r3 = roceSer.slice(Math.max(0, rl - 2), rl + 1).filter((v): v is number => v !== null);
      const rall = roceSer.filter((v): v is number => v !== null);
      if (r3.length >= 2) {
        const a3 = r3.reduce((x, y) => x + y, 0) / r3.length;
        const a10 = rall.reduce((x, y) => x + y, 0) / rall.length;
        let pts = 7 * (a3 >= 25 ? 1 : lin01(a3, 10, 25)) + (a3 - a10 >= 3 ? 3 : a3 - a10 >= 0 ? 1.5 : 0);
        let moatNote = '';
        try {
          const mt = JSON.parse(r['Moat Tab'] || '');
          if (mt && mt.avgRoce >= 15 && mt.avgRoic >= 15 && pts < 5) { pts = 5; moatNote = ' · floored 5 (Moat sheet)'; }
        } catch {}
        add('roce_traj', 'ROCE level + trajectory', 10, pts, 'avg3 ' + fxN(a3) + '% vs avg10 ' + fxN(a10) + '%' + moatNote);
      } else add('roce_traj', 'ROCE level + trajectory', 10, null, 'no ROCE history');
    }
    // 4 · margin expansion / operating leverage
    const margSer: (number | null)[] = sales.map((_, i) => {
      const sl = av(sales, i);
      const m = (av(fin.pbt, i) + (isFinite(av(fin.intr, i)) ? av(fin.intr, i) : 0) + (isFinite(av(fin.dep, i)) ? av(fin.dep, i) : 0) - (isFinite(av(fin.oi, i)) ? av(fin.oi, i) : 0));
      return isFinite(m) && isFinite(sl) && sl > 0 ? (m / sl) * 100 : null;
    });
    const pc3 = cagrPct(av(np, cn), av(np, cn - 3), 3);
    {
      const ml = lastNN(margSer);
      const m3 = margSer.slice(Math.max(0, ml - 2), ml + 1).filter((v): v is number => v !== null);
      const mall = margSer.filter((v): v is number => v !== null);
      if (m3.length >= 2 || (isFinite(pc3) && isFinite(c3))) {
        let pts = 0; const dd: string[] = [];
        if (m3.length >= 2) {
          const dm = m3.reduce((x, y) => x + y, 0) / m3.length - mall.reduce((x, y) => x + y, 0) / mall.length;
          pts += dm >= 3 ? 4 : dm >= 0 ? 2 : 0;
          dd.push('Δmargin ' + (dm >= 0 ? '+' : '') + fxN(dm) + 'pp');
        }
        if (isFinite(pc3) && isFinite(c3) && pc3 > 0 && c3 > 0) {
          const rr = pc3 / c3;
          pts += rr >= 1.3 ? 4 : rr >= 1.0 ? 2 : 0;
          dd.push('PAT/Sales CAGR3 ' + fxN(rr, 2) + 'x');
        }
        add('margin_oplev', 'Margin expansion / op leverage', 8, pts, dd.join(' · '));
      } else add('margin_oplev', 'Margin expansion / op leverage', 8, null, 'no margin history');
    }
    // 5 · reinvestment with self-funding
    {
      const cl = lastNN(fin.capex), ol = lastNN(fin.ocf);
      const cap3 = sumLast(fin.capex, 3, cl), ocf3 = sumLast(fin.ocf, 3, ol);
      if (isFinite(cap3) && cap3 > 0 && isFinite(ocf3)) {
        const ratio = ocf3 > 0 ? cap3 / ocf3 : NaN;
        const sf = num(r['OCF/Capex 3y %']);
        const sfOk = isFinite(sf) ? sf >= 40 : ocf3 > 0 && cap3 / ocf3 <= 2.5;
        const pts = isFinite(ratio) && ratio >= 0.4 && ratio <= 1.2 ? 8 : isFinite(ratio) && ratio > 1.2 && ratio <= 2 && sfOk ? 4 : 0;
        add('reinvest', 'Reinvestment, self-funded', 8, pts, 'capex3 ' + fxN(cap3, 0) + ' / ocf3 ' + fxN(ocf3, 0) + ' = ' + fxN(ratio, 2));
      } else add('reinvest', 'Reinvestment, self-funded', 8, null, 'no capex/OCF series');
    }
    // 6 · share-count discipline (10y)
    {
      const sl = lastNN(fin.shares), sf = firstNN(fin.shares);
      if (sl > sf && sf >= 0) {
        const dch = (av(fin.shares, sl) / av(fin.shares, sf) - 1) * 100;
        add('dilution', 'Share-count discipline', 6, dch <= 5 ? 6 : dch <= 20 ? 3 : dch <= 50 ? 1 : 2, 'shares ' + fxN(av(fin.shares, sf), 2) + '→' + fxN(av(fin.shares, sl), 2) + ' Cr (' + (dch >= 0 ? '+' : '') + fxN(dch, 0) + '%' + (dch > 50 ? ' · likely bonus/IPO — partial credit' : '') + ')');
      } else add('dilution', 'Share-count discipline', 6, null, 'no share-count series');
    }
    // 7 · debt trajectory
    {
      const bl = lastNN(fin.eq);
      const deNow = av(fin.eq, bl) + av(fin.res, bl) > 0 ? (isFinite(av(fin.bor, bl)) ? av(fin.bor, bl) : 0) / (av(fin.eq, bl) + av(fin.res, bl)) : NaN;
      const de3 = av(fin.eq, bl - 3) + av(fin.res, bl - 3) > 0 ? (isFinite(av(fin.bor, bl - 3)) ? av(fin.bor, bl - 3) : 0) / (av(fin.eq, bl - 3) + av(fin.res, bl - 3)) : NaN;
      if (isFinite(deNow)) {
        const pts = deNow <= 0.3 && (!isFinite(de3) || deNow <= de3) ? 6 : deNow <= 0.7 && (!isFinite(de3) || deNow - de3 <= 0.2) ? 3 : 0;
        add('debt_traj', 'Debt trajectory', 6, pts, 'D/E ' + fxN(deNow, 2) + ' vs 3y-ago ' + fxN(de3, 2));
      } else add('debt_traj', 'Debt trajectory', 6, null, 'no balance-sheet series');
    }
    // 8 · FCF generation years
    {
      let fy = 0, fv = 0;
      const n = fin.years.length;
      for (let i = Math.max(1, n - 10); i < n; i++) {
        const o = av(fin.ocf, i), cx = av(fin.capex, i);
        if (!isFinite(o) || !isFinite(cx)) continue;
        fv++;
        if (o - cx > 0) fy++;
      }
      add('fcf_years', 'FCF-positive years', 6, fv >= 4 ? Math.min(1, fy / 6) * 6 : null, fv >= 4 ? fy + '/' + fv + ' yrs OCF > capex' : 'insufficient series');
    }
    // 9 · CFO→PAT convergence
    {
      const cumC = fin.ocf.reduce((a: number, v) => a + (v ?? 0), 0);
      const cumP = np.reduce((a: number, v) => a + (v ?? 0), 0);
      if (cumP > 0 && fin.ocf.some((v) => v !== null)) {
        const rt = cumC / cumP;
        add('cfo_conv', 'CFO→PAT convergence', 5, rt >= 0.8 ? 5 : rt >= 0.6 ? 2.5 : 0, 'cum-10y CFO/PAT ' + fxN(rt, 2));
      } else add('cfo_conv', 'CFO→PAT convergence', 5, null, 'no CFO series');
    }
    // 10 · size runway
    {
      const mc = fin.mcap ?? NaN;
      if (isFinite(mc) && mc > 0) {
        const fr = mc >= 500 && mc <= 5000 ? 1 : (mc >= 200 && mc < 500) || (mc > 5000 && mc <= 20000) ? 0.625 : mc < 200 ? 0.5 : mc <= 50000 ? 0.25 : 0;
        add('runway', 'Size runway', 8, fr * 8, 'mcap ' + fxN(mc, 0) + ' Cr');
      } else add('runway', 'Size runway', 8, null, 'no market cap');
    }
    // 11 · valuation vs growth — PEG on the BLENDED growth rate (v5.2):
    // g = blended PAT CAGR (max of 3y, 0.8×5y, 0.7×10y) where available, else the
    // blended sales g. If g < 5% PEG is not meaningful → 'n/m', score the PE band only.
    {
      const mc = fin.mcap ?? NaN, npL = av(np, cn);
      pe = isFinite(mc) && npL > 0 ? mc / npL : NaN;
      const pc5 = cagrPct(av(np, cn), av(np, cn - 5), 5);
      const fnp = firstNN(np);
      const pc10 = fnp >= 0 && cn - fnp >= 6 ? cagrPct(av(np, cn), av(np, fnp), cn - fnp) : NaN;
      const gPat = Math.max(isFinite(pc3) ? pc3 : -Infinity, isFinite(pc5) ? 0.8 * pc5 : -Infinity, isFinite(pc10) ? 0.7 * pc10 : -Infinity);
      const gEff = isFinite(gPat) && gPat > -Infinity ? gPat : (isFinite(gBlend) && gBlend > -Infinity ? gBlend : NaN);
      peg = isFinite(pe) && isFinite(gEff) && gEff >= 5 ? pe / gEff : NaN;
      if (isFinite(pe)) {
        const p3 = pe >= 18 && pe <= 40 ? 3 : pe < 18 ? 2 : pe <= 50 ? 1 : 0;
        if (isFinite(peg)) {
          const p5 = 5 * (peg < 1 ? 1 : lin01(2.5 - peg, 0, 1.5));
          add('val_growth', 'Valuation vs growth', 8, p5 + p3, 'PE ' + fxN(pe, 1) + ' · PEG ' + fxN(peg, 2) + ' (g ' + fxN(gEff) + '%)');
        } else {
          // growth too weak/absent for a meaningful PEG — judge the PE band alone
          add('val_growth', 'Valuation vs growth', 3, p3, 'PE ' + fxN(pe, 1) + ' · PEG n/m (g ' + (isFinite(gEff) ? fxN(gEff) + '% <5' : '—') + ') — PE band only');
        }
      } else add('val_growth', 'Valuation vs growth', 8, null, 'no PE (loss-making or no mcap)');
    }
  } else {
    (['pat_consist', 'sales_cagr', 'roce_traj', 'margin_oplev', 'reinvest', 'dilution', 'debt_traj', 'fcf_years', 'cfo_conv', 'runway', 'val_growth'] as const)
      .forEach((id, i) => add(id, ['Earnings-growth consistency', 'Sales CAGR + acceleration', 'ROCE level + trajectory', 'Margin expansion / op leverage', 'Reinvestment, self-funded', 'Share-count discipline', 'Debt trajectory', 'FCF-positive years', 'CFO→PAT convergence', 'Size runway', 'Valuation vs growth'][i], [10, 10, 10, 8, 8, 6, 6, 6, 5, 8, 8][i], null, 'needs Screener workbook'));
  }
  // 12 · promoter & moat (manual + workbook) — sub-weights only when measured
  {
    const promoter = num(String(r['Promoter Holding %'] ?? r[h['promoter']] ?? ''));
    const pledge = s.pledge;
    const moatV = yes(String(r['Competitive Moat'] ?? r[h['moat']] ?? '') || undefined);
    const polRaw = String(r['Policy Support'] ?? r[h['policy']] ?? '').trim();
    let subW = 0, pts = 0; const dd: string[] = [];
    if (isFinite(promoter)) {
      subW += 4;
      let pp = promoter >= 55 ? 4 : promoter >= 40 ? 2 : 0;
      if (isFinite(pledge) && pledge > 5) pp = 0;
      pts += pp;
      dd.push('promoter ' + promoter.toFixed(0) + '%' + (isFinite(pledge) && pledge > 5 ? ' · pledge ' + pledge.toFixed(0) + '% ⇒ 0' : ''));
    }
    if (moatV !== null) { subW += 2; pts += moatV ? 2 : 0; dd.push('moat ' + (moatV ? 'Y' : 'N')); }
    if (polRaw) { subW += 1; pts += /none|^n$|^no$/i.test(polRaw) ? 0 : 1; dd.push('policy ' + polRaw.slice(0, 14)); }
    if (subW > 0) add('promoter_moat', 'Promoter & moat (manual)', subW, pts, dd.join(' · '));
    else add('promoter_moat', 'Promoter & moat (manual)', 7, null, 'fill promoter/pledge/moat inline');
  }

  const available = comps.reduce((a, cmp) => a + (cmp.pts === null ? 0 : cmp.w), 0);
  const total = comps.reduce((a, cmp) => a + (cmp.pts ?? 0), 0);
  const score = available >= 40 ? Math.round((total / available) * 100) : 0;
  let grade = available < 40 ? 'NR' : score >= 80 ? 'A+' : score >= 70 ? 'A' : score >= 60 ? 'B+' : score >= 50 ? 'B' : score >= 38 ? 'C' : 'D';
  // consistency gates (mirrors the /multibagger portal)
  if (grade !== 'NR') {
    const cap = (g: string) => { if (MB_GRADE_ORDER.indexOf(grade) < MB_GRADE_ORDER.indexOf(g)) grade = g; };
    if (fxGrade === 'FLAGS' || fxGrade === 'AVOID') cap('B+');
    if ((isFinite(s.pledge) && s.pledge > 15) || (isFinite(s.de) && s.de > 1.5)) cap('B');
  }
  return { score, grade, color: MB_GRADE_COLOR[grade] || C.muted, available, components: comps, pe, peg };
}

// ── 🔬 FORENSICS — 12 checks, higher = cleaner ──────────────────────────────
function computeForensic(fin: Fin | null, r: Row): FXResult {
  const checks: FXCheck[] = [];
  const flags: string[] = [];
  let critical = false;
  const add = (id: string, label: string, w: number, pts: number | null, detail: string, flag?: string, crit?: boolean) => {
    checks.push({ id, label, w, pts, detail, flag });
    if (flag) flags.push(flag);
    if (crit) critical = true;
  };
  const fxN = (n: number, d = 0) => (isFinite(n) ? n.toFixed(d) : '—');

  if (fin) {
    const sales = fin.sales, np = fin.np;
    const c = lastNN(sales), cn = lastNN(np), bl = lastNN(fin.eq);
    // 1 cfo_pat
    {
      const cumC = fin.ocf.reduce((a: number, v) => a + (v ?? 0), 0);
      const cumP = np.reduce((a: number, v) => a + (v ?? 0), 0);
      if (cumP > 0 && fin.ocf.some((v) => v !== null)) {
        const rt = cumC / cumP;
        if (rt >= 0.9) add('cfo_pat', 'Cum 10y CFO/PAT', 14, 14, fxN(rt, 2));
        else if (rt >= 0.7) add('cfo_pat', 'Cum 10y CFO/PAT', 14, 7, fxN(rt, 2));
        else add('cfo_pat', 'Cum 10y CFO/PAT', 14, 0, fxN(rt, 2), 'Cum CFO/PAT ' + fxN(rt, 2) + ' — accruals not converting to cash', rt < 0.5);
      } else add('cfo_pat', 'Cum 10y CFO/PAT', 14, null, 'n/a');
    }
    // 2 cfo_ebitda (3y sums)
    {
      const ocf3 = sumLast(fin.ocf, 3, c);
      let eb3 = 0, ebn = 0;
      for (let i = Math.max(0, c - 2); i <= c; i++) {
        const p = av(fin.pbt, i);
        if (!isFinite(p)) continue;
        eb3 += p + (isFinite(av(fin.intr, i)) ? av(fin.intr, i) : 0) + (isFinite(av(fin.dep, i)) ? av(fin.dep, i) : 0) - (isFinite(av(fin.oi, i)) ? av(fin.oi, i) : 0);
        ebn++;
      }
      if (ebn > 0 && eb3 > 0 && isFinite(ocf3)) {
        const rt = ocf3 / eb3;
        if (rt >= 0.5) add('cfo_ebitda', 'CFO/EBITDA 3y', 8, 8, fxN(rt, 2));
        else if (rt >= 0.3) add('cfo_ebitda', 'CFO/EBITDA 3y', 8, 4, fxN(rt, 2));
        else add('cfo_ebitda', 'CFO/EBITDA 3y', 8, 0, fxN(rt, 2), 'CFO/EBITDA ' + fxN(rt, 2) + ' — paper EBITDA');
      } else add('cfo_ebitda', 'CFO/EBITDA 3y', 8, null, 'n/a');
    }
    // 3+4 receivable / inventory days trend
    const days = (arr: (number | null)[], i: number) => { const a = av(arr, i), sl = av(sales, i); return isFinite(a) && sl > 0 ? (a / sl) * 365 : NaN; };
    {
      const e = firstNN(fin.recv); const dn = days(fin.recv, c), d3 = days(fin.recv, e);
      if (isFinite(dn) && isFinite(d3) && d3 > 0) {
        const dch = (dn / d3 - 1) * 100;
        const rg = av(fin.recv, c) / av(fin.recv, e), sg = av(sales, c) / av(sales, e);
        if (dch <= 10) add('recv_days', 'Receivable days trend', 10, 10, fxN(d3) + '→' + fxN(dn) + 'd');
        else if (dch <= 30) add('recv_days', 'Receivable days trend', 10, 5, fxN(d3) + '→' + fxN(dn) + 'd');
        else if (rg > sg) add('recv_days', 'Receivable days trend', 10, 0, fxN(d3) + '→' + fxN(dn) + 'd', 'Receivable days ' + fxN(d3) + '→' + fxN(dn) + ' — channel stuffing risk');
        else add('recv_days', 'Receivable days trend', 10, 5, fxN(d3) + '→' + fxN(dn) + 'd (recv ≤ sales growth)');
      } else add('recv_days', 'Receivable days trend', 10, null, 'n/a');
    }
    {
      const e = firstNN(fin.inv); const dn = days(fin.inv, c), d3 = days(fin.inv, e);
      if (isFinite(dn) && isFinite(d3) && d3 > 0) {
        const dch = (dn / d3 - 1) * 100;
        if (dch <= 15) add('inv_days', 'Inventory days trend', 6, 6, fxN(d3) + '→' + fxN(dn) + 'd');
        else if (dch <= 40) add('inv_days', 'Inventory days trend', 6, 3, fxN(d3) + '→' + fxN(dn) + 'd');
        else add('inv_days', 'Inventory days trend', 6, 0, fxN(d3) + '→' + fxN(dn) + 'd', 'Inventory days ballooning ' + fxN(d3) + '→' + fxN(dn));
      } else add('inv_days', 'Inventory days trend', 6, null, 'n/a');
    }
    // 5 other income / PBT
    {
      const oiL = av(fin.oi, c), pbtL = av(fin.pbt, c);
      if (isFinite(pbtL) && pbtL > 0 && isFinite(oiL)) {
        const rt = (oiL / pbtL) * 100;
        if (rt < 10) add('other_inc', 'Other income / PBT', 8, 8, fxN(rt) + '%');
        else if (rt <= 25) add('other_inc', 'Other income / PBT', 8, 4, fxN(rt) + '%');
        else add('other_inc', 'Other income / PBT', 8, 0, fxN(rt) + '%', 'Other income is ' + fxN(rt) + '% of PBT — core P&L weaker than it looks');
      } else add('other_inc', 'Other income / PBT', 8, null, 'n/a');
    }
    // 6 tax rate
    {
      const rates: number[] = [];
      for (let i = Math.max(0, c - 2); i <= c; i++) {
        const t = av(fin.tax, i), p = av(fin.pbt, i);
        if (isFinite(t) && p > 0) rates.push((t / p) * 100);
      }
      if (rates.length) {
        const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
        const low = rates.filter((x) => x < 15).length;
        if (low >= 2) add('tax_rate', 'Tax / PBT 3y', 8, 0, 'avg ' + fxN(avg) + '%', 'Tax rate ' + fxN(avg) + '% vs ~25% statutory — earnings quality suspect');
        else if (avg >= 22 && avg <= 35) add('tax_rate', 'Tax / PBT 3y', 8, 8, 'avg ' + fxN(avg) + '%');
        else add('tax_rate', 'Tax / PBT 3y', 8, 4, 'avg ' + fxN(avg) + '%');
      } else add('tax_rate', 'Tax / PBT 3y', 8, null, 'n/a');
    }
    // 7 cash ↑ with borrowings ↑
    {
      const ca = av(fin.cash, bl), cb = av(fin.cash, bl - 3), ba = av(fin.bor, bl), bb = av(fin.bor, bl - 3);
      const it = av(fin.intr, c);
      if (isFinite(ca) && cb > 0 && isFinite(ba) && bb > 0) {
        const cgr = (ca / cb - 1) * 100, bgr = (ba / bb - 1) * 100;
        const ir = isFinite(it) && ba + bb > 0 ? (it / ((ba + bb) / 2)) * 100 : NaN;
        if (cgr > 25 && bgr > 25 && ir > 9) add('cash_borrow', 'Cash ↑ with borrowings ↑', 8, 0, 'cash +' + fxN(cgr) + '% · bor +' + fxN(bgr) + '% · int ' + fxN(ir) + '%', 'Cash and debt rising together — cash may not be real');
        else add('cash_borrow', 'Cash ↑ with borrowings ↑', 8, 8, 'cash ' + (cgr >= 0 ? '+' : '') + fxN(cgr) + '% · bor ' + (bgr >= 0 ? '+' : '') + fxN(bgr) + '%');
      } else add('cash_borrow', 'Cash ↑ with borrowings ↑', 8, null, 'n/a');
    }
    // 8 perpetual CWIP
    {
      const nl = lastNN(fin.nb);
      if (nl >= 0) {
        let run = 0;
        for (let i = nl; i >= 0; i--) {
          const nb = av(fin.nb, i), cw = av(fin.cwip, i);
          if (!isFinite(nb) || nb <= 0 || !isFinite(cw)) break;
          if (cw / nb > 0.2) run++; else break;
        }
        const pct = isFinite(av(fin.cwip, nl)) && av(fin.nb, nl) > 0 ? (av(fin.cwip, nl) / av(fin.nb, nl)) * 100 : 0;
        if (run >= 3) add('cwip_stuck', 'Perpetual CWIP', 8, 0, run + 'y >20%', 'CWIP parked ' + fxN(pct) + '% of net block for 3y+ — capitalised costs?');
        else if (run === 2) add('cwip_stuck', 'Perpetual CWIP', 8, 4, '2y >20%');
        else add('cwip_stuck', 'Perpetual CWIP', 8, 8, fxN(pct) + '% of NB now');
      } else add('cwip_stuck', 'Perpetual CWIP', 8, null, 'n/a');
    }
    // 9 dilution 5y
    {
      const sl = lastNN(fin.shares);
      let i5 = -1;
      for (let i = sl - 1; i >= Math.max(0, sl - 5); i--) if (fin.shares[i] !== null) i5 = i;
      if (sl >= 0 && i5 >= 0) {
        const dch = (av(fin.shares, sl) / av(fin.shares, i5) - 1) * 100;
        if (dch <= 5) add('dilution5', 'Dilution 5y', 8, 8, (dch >= 0 ? '+' : '') + fxN(dch) + '%');
        else if (dch <= 20) add('dilution5', 'Dilution 5y', 8, 4, '+' + fxN(dch) + '%');
        else add('dilution5', 'Dilution 5y', 8, 0, '+' + fxN(dch) + '%', 'Share count +' + fxN(dch) + '% in 5y — serial diluter', dch > 40);
      } else add('dilution5', 'Dilution 5y', 8, null, 'n/a');
    }
    // 10 dividend sanity (skip if div row empty)
    {
      const hasDiv = fin.div.some((v) => v !== null);
      if (!hasDiv) add('div_sanity', 'Dividend vs OCF', 8, null, 'no dividend row — N/A');
      else {
        const ocf3 = sumLast(fin.ocf, 3, c);
        const div3 = sumLast(fin.div, 3, cn), pat3 = sumLast(np, 3, cn);
        const rs: number[] = [];
        for (let i = Math.max(0, bl - 2); i <= bl; i++) {
          const ce = av(fin.eq, i) + av(fin.res, i) + (isFinite(av(fin.bor, i)) ? av(fin.bor, i) : 0);
          const ebit = av(fin.pbt, i) + (isFinite(av(fin.intr, i)) ? av(fin.intr, i) : 0);
          if (isFinite(ce) && ce > 0 && isFinite(ebit)) rs.push((ebit / ce) * 100);
        }
        const roce3 = rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : NaN;
        const payout = pat3 > 0 && isFinite(div3) ? (div3 / pat3) * 100 : NaN;
        if (div3 > 0 && ocf3 < 0) add('div_sanity', 'Dividend vs OCF', 8, 0, 'payout ' + fxN(payout) + '%', 'Dividend paid out of borrowings');
        else if (div3 > 0 && payout >= 10 && payout <= 60 && ocf3 > 0) add('div_sanity', 'Dividend vs OCF', 8, 8, 'payout ' + fxN(payout) + '% of PAT');
        else if (!(div3 > 0) && roce3 >= 15) add('div_sanity', 'Dividend vs OCF', 8, 8, 'no dividend · ROCE3 ' + fxN(roce3) + '%');
        else if (!(div3 > 0)) add('div_sanity', 'Dividend vs OCF', 8, 4, 'no dividend · ROCE3 ' + fxN(roce3) + '%');
        else add('div_sanity', 'Dividend vs OCF', 8, 4, 'payout ' + fxN(payout) + '% (outside 10-60)');
      }
    }
    // 11 CFO-positive years
    {
      let pos = 0, tot = 0;
      fin.ocf.forEach((v) => { if (v !== null) { tot++; if (v > 0) pos++; } });
      if (tot >= 5) {
        if (pos >= 7) add('cfo_years', 'CFO-positive years', 8, 8, pos + '/' + tot);
        else if (pos >= 5) add('cfo_years', 'CFO-positive years', 8, 4, pos + '/' + tot);
        else add('cfo_years', 'CFO-positive years', 8, 0, pos + '/' + tot, 'Only ' + pos + '/10 years of positive CFO');
      } else add('cfo_years', 'CFO-positive years', 8, null, 'n/a');
    }
    // 12 depreciation-rate volatility
    {
      const drs: number[] = [];
      fin.dep.forEach((_, i) => { const dp = av(fin.dep, i), nb = av(fin.nb, i); if (isFinite(dp) && nb > 0) drs.push((dp / nb) * 100); });
      if (drs.length >= 4) {
        const rng = Math.max(...drs) - Math.min(...drs);
        if (rng <= 4) add('dep_vol', 'Depreciation-rate volatility', 6, 6, 'range ' + fxN(rng, 1) + 'pp');
        else if (rng <= 6) add('dep_vol', 'Depreciation-rate volatility', 6, 3, 'range ' + fxN(rng, 1) + 'pp');
        else add('dep_vol', 'Depreciation-rate volatility', 6, 0, 'range ' + fxN(rng, 1) + 'pp', 'Depreciation rate swings ' + fxN(Math.min(...drs)) + '–' + fxN(Math.max(...drs)) + '% — asset-life games');
      } else add('dep_vol', 'Depreciation-rate volatility', 6, null, 'n/a');
    }
  } else {
    ([['cfo_pat', 'Cum 10y CFO/PAT', 14], ['cfo_ebitda', 'CFO/EBITDA 3y', 8], ['recv_days', 'Receivable days trend', 10], ['inv_days', 'Inventory days trend', 6], ['other_inc', 'Other income / PBT', 8], ['tax_rate', 'Tax / PBT 3y', 8], ['cash_borrow', 'Cash ↑ with borrowings ↑', 8], ['cwip_stuck', 'Perpetual CWIP', 8], ['dilution5', 'Dilution 5y', 8], ['div_sanity', 'Dividend vs OCF', 8], ['cfo_years', 'CFO-positive years', 8], ['dep_vol', 'Depreciation-rate volatility', 6]] as [string, string, number][])
      .forEach(([id, label, w]) => add(id, label, w, null, 'needs Screener workbook'));
  }

  // workbook overlay (user's Fraud checklist answers)
  let workbook: { row: number; label: string; answer: string }[] = [];
  try { const ft = JSON.parse(r['Fraud Tab'] || ''); if (Array.isArray(ft)) workbook = ft; } catch {}
  const adverse = workbook.filter((x) => x.answer === 'adverse').length;
  const overlayPenalty = Math.min(15, adverse * 3);

  const available = checks.reduce((a, ch) => a + (ch.pts === null ? 0 : ch.w), 0);
  const total = checks.reduce((a, ch) => a + (ch.pts ?? 0), 0);
  const raw = available >= 60 ? (total / available) * 100 - overlayPenalty : 0;
  const score = available >= 60 ? Math.max(0, Math.min(100, Math.round(raw))) : 0;
  let grade = 'NR';
  if (available >= 60) {
    const ORDER = ['CLEAN', 'WATCH', 'FLAGS', 'AVOID'];
    const sg = score >= 80 ? 'CLEAN' : score >= 60 ? 'WATCH' : score >= 40 ? 'FLAGS' : 'AVOID';
    const fg = critical || flags.length >= 4 ? 'AVOID' : flags.length >= 2 ? 'FLAGS' : flags.length === 1 ? 'WATCH' : 'CLEAN';
    grade = ORDER[Math.max(ORDER.indexOf(sg), ORDER.indexOf(fg))];
  }
  return { score, grade, color: FX_GRADE_COLOR[grade] || C.muted, flags, critical, checks, workbook };
}

// ── 🎙 CONCALL — heuristic transcript extraction (pure, SENTENCE-scoped) ────
// v5.2 hardening: every signal is read from a single qualifying SENTENCE, never
// from a raw character window. Agenda headers ("OPERATIONAL HIGHLIGHTS …"),
// table-of-contents lines and shouty fragments are filtered out up front:
// a sentence qualifies only if it has ≥4 words, ≤60% uppercase letters and
// (for numeric signals) is shorter than 300 chars and carries keyword + number.
const upperFrac = (s: string): number => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters.length) return 1;
  return letters.replace(/[^A-Z]/g, '').length / letters.length;
};
// "Rs. 312 crores", "Mr. Sharma", initials etc. must not split a sentence
const ABBR_END = /(?:\b(?:rs|mr|mrs|ms|dr|no|nos|vs|st|jr|sr|inc|ltd|pvt|approx)\.|\b[A-Za-z]\.)$/i;
function transcriptSentences(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/[\r\n]+/)) {
    const parts = line.replace(/([.!?])\s+/g, '$1\u0001').split('\u0001');
    const merged: string[] = [];
    for (const p of parts) {
      if (merged.length && ABBR_END.test(merged[merged.length - 1].trim())) merged[merged.length - 1] += ' ' + p;
      else merged.push(p);
    }
    for (const part of merged) {
      const sn = part.replace(/\s+/g, ' ').trim();
      if (!sn) continue;
      if (sn.split(' ').length < 4) continue; // fragments / page numbers / headers
      if (upperFrac(sn) > 0.6) continue; // ALL-CAPS agenda lines are never signals
      out.push(sn);
    }
  }
  return out;
}
function extractConcall(text: string): ConcallExtract {
  const sents = transcriptSentences(text);
  const quotes: { field: string; match: string; snippet: string }[] = [];
  // v5.3 — value and quote ALWAYS come from the SAME chosen sentence.
  // Preference: management statements about the CURRENT state beat analyst
  // questions and forward projections; "from X% to Y%" reads the DESTINATION.
  const isQuestion = (s: string) => /\?\s*$/.test(s);
  const FUTURE = /\bexpect|target|aim|going forward|next (year|fiscal)|by fy|in fy ?'?\d|should (be|reach|go)|can go|where can|will (be|reach|go)\b/i;
  const CURRENT = /\bcurrent|currently|today|as of now|at present|right now|we are (at|around|running)|stands? at|stand tall|exceeding|of over|enter(ing)? fy ?'?\d+ with\b/i;
  const PCT_SRC = "(\\d{1,3}(?:\\.\\d+)?)\\s*(?:%|per\\s*cent|percent)";
  const CR_SRC = "(?:rs\\.?|inr|₹)?\\s*([\\d,]+(?:\\.\\d+)?)\\s*(?:crores?|cr\\b)";
  type Cand = { n: number; s: string; sc: number };
  const pick = (
    field: string, kw: RegExp, numSrc: string, lo: number, hi: number,
    opts: { lastNum?: boolean; preferMax?: boolean } = {},
  ): number | null => {
    const cands: Cand[] = [];
    for (const s of sents) {
      if (s.length > 300 || !kw.test(s)) continue;
      const re = new RegExp(numSrc, 'gi');
      const all: number[] = [];
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(s))) {
        const n = parseFloat(String(mm[1]).replace(/,/g, ''));
        if (isFinite(n) && n >= lo && n <= hi) all.push(n);
      }
      if (!all.length) continue;
      const n = opts.lastNum ? all[all.length - 1] : all[0];
      let sc = 0;
      if (CURRENT.test(s)) sc += 2;
      if (FUTURE.test(s)) sc -= 2;
      if (isQuestion(s)) sc -= 3;
      cands.push({ n, s, sc });
      if (cands.length >= 12) break;
    }
    if (!cands.length) return null;
    cands.sort((a, b) => b.sc - a.sc || (opts.preferMax ? b.n - a.n : 0));
    const best = cands[0];
    quotes.push({ field, match: String(best.n), snippet: best.s });
    return best.n;
  };
  // util (v5.4-deep) — proximity regex: % must be within 60 chars of "utilization". Median for robustness.
  let utilization: number | null = null;
  const utilArr: number[] = [];
  for (const sm of text.matchAll(/utili[sz]ation[^.?!\n]{0,60}?(\d{1,2}(?:\.\d+)?)\s*%/gi)) {
    const v = parseFloat(sm[1]);
    if (v > 0 && v <= 100) utilArr.push(v);
  }
  if (utilArr.length) {
    const sorted = [...utilArr].sort((a, b) => a - b);
    utilization = sorted[Math.floor(sorted.length / 2)];
  }
  // exportPct (v5.4-deep) — proximity regex for export % of revenue/sales
  let exportPct: number | null = null;
  {
    const cands: number[] = [];
    for (const sm of text.matchAll(/export[^.?!\n]{0,40}?(\d{1,3}(?:\.\d+)?)\s*%/gi)) {
      const v = parseFloat(sm[1]);
      if (v > 0 && v <= 100) cands.push(v);
    }
    if (cands.length) { cands.sort((a, b) => a - b); exportPct = cands[Math.floor(cands.length / 2)]; }
  }
  // customerCount (v5.4-deep) — total customer / OEM / Tier-1 count
  let customerCount: number | null = null;
  {
    const m = text.match(/(\d{2,4})\s*\+?\s*(?:OEMs?|Tier[\-\s]?1s?|marquee\s+customers?|customers?|clients?)\b/i);
    if (m) customerCount = parseInt(m[1], 10);
  }
  // pliMentioned (v5.4-deep)
  const pliMentioned = /\bPLI\b|production[\s-]linked\s+incentive/i.test(text);
  const orderBook = pick('orderBook', /order\s*book|order\s*inflow|open orders/i, CR_SRC, 1, 10000000, { preferMax: true });
  const capexGuidance = pick('capexGuidance', /\bcapex\b|capital\s+expenditure|capital\s+outlay|capex\s+(?:of|guidance|plan|spend|outlay|programme)|\bspend(?:ing)?\s+(?:on\s+)?capex|\bcapex\s+spend/i, CR_SRC, 1, 10000000, { preferMax: true });
  const anchorPct = pick('anchorPct', /\b(booked|committed|tied[- ]?up|visibility|contracted|covered\s+by\s+orders|order\s+book|backlog)\b|export\s+(share|mix|revenue|sales)/i, PCT_SRC, 1, 100);
  // qualitative notes — one best sentence each (growth / margin / demand)
  const pickNote = (field: string, kw: RegExp): string | null => {
    let best: { s: string; sc: number } | null = null;
    for (const s of sents) {
      if (s.length > 300 || !kw.test(s)) continue;
      let sc = 0;
      if (isQuestion(s)) sc -= 3;
      if (CURRENT.test(s)) sc += 1;
      if (/\d/.test(s)) sc += 1;
      if (!best || sc > best.sc) best = { s, sc };
    }
    if (!best) return null;
    quotes.push({ field, match: '', snippet: best.s });
    return best.s.length > 190 ? best.s.slice(0, 187) + '…' : best.s;
  };
  const growthNote = pickNote('growth', /\b(revenue|sales|top ?line|volume) growth\b|\bgrow (at|by|of)\b|growth (guidance|target|of \d)|\bcagr of\b/i);
  const marginNote = pickNote('margin', /^(?!.*\b(currency|forex|FX|one[-\s]?off|other income|exceptional|hedg|translation)\b).*\b(ebitda|gross|operating|pat) margins?\b/i);
  const demandNote = pickNote('demand', /\bdemand\s+(for|in|environment|outlook|scenario|remains|continues|is|has|will|stays|looks|seems|picking|increased|grew|grow|growing|softening|weakening|recover|recovering)\b|\b(higher|strong|robust|weak|soft|tight|sluggish|healthy|steady) demand\b|\bdemand growth\b|\border inflows?\b|\benquir|inquir|\bpipeline (remains|is|of)\b/i);
  // timeline: real commissioning verbs + a dated period; deck headers filtered
  const timeline: string[] = [];
  {
    const verb = /commission\w*|ramp[- ]?up|ramping|comes? on stream|go[- ]?live|stabili[sz]\w+|start (of )?production|commercial production|commence operations?/i;
    const when = /Q[1-4]\s*(?:of\s*)?FY\s*'?\d{2,4}|H[12]\s*FY\s*'?\d{2,4}|FY\s*'?\d{2,4}|\b(january|february|march|april|may|june|july|august|september|october|november|december)\b[\s,]*\d{4}|quarter ended/i;
    for (const s of sents) {
      if (s.length > 300 || !verb.test(s) || !when.test(s)) continue;
      if (/highlights|agenda|disclaimer|safe harbou?r/i.test(s)) continue;
      const letters = s.replace(/[^a-zA-Z]/g, '');
      if (letters && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.45) continue;
      timeline.push(s.length > 220 ? s.slice(0, 217) + '…' : s);
      quotes.push({ field: 'timeline', match: (s.match(when) || [s.slice(0, 40)])[0], snippet: s });
      if (timeline.length >= 3) break;
    }
  }
  // tone — widened lexicons (v5.3): a full concall scoring 0 positives was a
  // lexicon gap, not management gloom.
  const OPT = /strong demand|robust|healthy|record (quarter|revenue|order|year|high|performance)|all[- ]?time high|confident|optimis|encourag|upgrade|ahead of schedule|ramping well|sold out|capacity booked|strong traction|order wins|better than expected|momentum|improv(ed|ing|ement)|highest[- ]ever|doubled|very (good|strong)|strong (growth|quarter|year|performance)/i;
  const CAU = /headwind|challenge|delay|deferred|deferment|pricing pressure|slowdown|muted|below expectation|postponed|underutili|cost overrun|demand (is |remains )?weak|weak demand|cautious|softness|subdued|uncertain|degrowth|de-?stocking|margin pressure|pressure on (margin|price)/i;
  let optimism = 0, caution = 0;
  for (const s of sents) {
    if (OPT.test(s)) optimism++;
    if (CAU.test(s)) caution++;
  }
  return {
    utilization,
    utilArr,
    orderBook,
    capexGuidance,
    timeline,
    anchorPct,
    growthNote, marginNote, demandNote, __v: 4,
    optimism, caution,
    tone: optimism + caution > 0 ? optimism / (optimism + caution) : null,
    quotes,
      customerCount,
    exportPct,
    pliMentioned,
  };
}

// ── 🧭 VERDICT — the 11-rule fused call ─────────────────────────────────────
const VERDICT_COLOR: Record<string, string> = {
  '☠ DO NOT TOUCH': C.red, '🧩 NEEDS DATA': C.violet, '🔍 FORENSIC REVIEW FIRST': C.orange,
  '🎯 PRIME': C.gold, '⏳ PRIME SETUP': C.teal, '🌱 COMPOUNDER': C.green, '🏗 CAPEX PLAY': C.cyan,
  '⚙ CYCLE ONLY': C.blue, '💎 QUALITY HOLD': C.violet, '🗑 DROP': C.dim, '👀 MONITOR': C.amber,
};
function computeVerdict(s: Scored, mb: MBResult, fx: FXResult, cc: CCState | null): Verdict {
  const capexBuy = s.decision === 'ANCHOR BUY' || s.decision === 'CORE BUY';
  // 'EARLY OK (PROVEN)' is a legitimate open window — the Stage-A proven-executor exception.
  const buyWindow = capexBuy && (s.entryShort.startsWith('BUY') || s.entryShort.startsWith('EARLY OK'));
  const mbOk = mb.grade !== 'NR', fxOk = fx.grade !== 'NR';
  // composite (renormalized over available parts)
  const parts: [number, number][] = [[0.40, s.final]];
  if (mbOk) parts.push([0.35, mb.score]);
  if (fxOk) parts.push([0.25, fx.score]);
  let composite = parts.reduce((a, [w, v]) => a + w * v, 0) / parts.reduce((a, [w]) => a + w, 0);
  if (fx.grade === 'FLAGS') composite -= 15;
  composite = Math.round(composite * 10) / 10;

  let call = '', why = '';
  const mbTag = mbOk ? 'MB ' + mb.score + ' (' + mb.grade + ')' : 'MB NR';
  const fxTag = fxOk ? 'forensic ' + fx.score + ' ' + fx.grade : 'forensic NR';
  if (fx.grade === 'AVOID' || fx.critical) {
    call = '☠ DO NOT TOUCH';
    why = fxTag + (fx.flags.length ? ' — ' + fx.flags[0] : '') + '. Forensic veto — nothing else matters until this clears.';
  } else if (!fxOk && !mbOk && !parseFin(s.raw)) {
    call = '🧩 NEEDS DATA';
    why = 'Capex ' + s.final + ' ' + s.decision + ' — upload the Screener workbook to unlock the multibagger + forensic lenses.';
  } else if (fx.grade === 'FLAGS') {
    call = '🔍 FORENSIC REVIEW FIRST';
    why = fx.flags.slice(0, 2).join(' · ') + ' — resolve these before sizing anything.';
  } else if (mbOk && mb.score >= 70 && buyWindow) {
    call = '🎯 PRIME';
    why = 'Capex inflection with multibagger DNA: ' + s.decision + ' ∩ ' + s.entryShort + ' + ' + mbTag + ' · ' + fxTag + '. Full stage-size entry.';
  } else if (mbOk && mb.score >= 70 && capexBuy && s.stage === '—') {
    call = '🌱 COMPOUNDER';
    why = mbTag + ' + quality ' + s.decision + ' but no capex cycle to time — compounder position; track for a T0 announcement.';
  } else if (mbOk && mb.score >= 70 && capexBuy && s.stage === 'F') {
    call = '💎 QUALITY HOLD';
    why = mbTag + ' + quality ' + s.decision + ' but Stage F — the inflection has printed; never chase. Re-engage at the next T0.';
  } else if (mbOk && mb.score >= 70 && capexBuy) {
    call = '⏳ PRIME SETUP';
    why = mbTag + ' + quality ' + s.decision + ', but entry says ' + s.entryShort + ' — set the alert, enter when the window opens.';
  } else if (mbOk && mb.score >= 70 && (s.decision === 'SATELLITE' || s.decision === 'WATCHLIST')) {
    call = '🌱 COMPOUNDER';
    why = mbTag + ' but capex band only ' + s.decision + ' — accumulate slowly; the capex story is not ripe.';
  } else if (mbOk && mb.score >= 50 && mb.score < 70 && buyWindow) {
    call = '🏗 CAPEX PLAY';
    why = 'Buy window open (' + s.entryShort + ') with mid ' + mbTag + ' — cycle bet at HALF size, exit on the staircase.';
  } else if (mbOk && mb.score < 50 && buyWindow) {
    call = '⚙ CYCLE ONLY';
    why = 'Window open but ' + mbTag + ' — trade the T2→T4 ramp only, hard stops, no marriage.';
  } else if (mbOk && mb.score >= 70 && fx.grade === 'CLEAN') {
    call = '💎 QUALITY HOLD';
    why = mbTag + ' + forensic CLEAN, no capex cycle to time — own it as a compounder.';
  } else if ((s.decision === 'AVOID' || s.decision === 'REJECT') && (!mbOk || mb.score < 50)) {
    call = '🗑 DROP';
    why = 'Capex ' + s.decision + ' (' + s.final + ') + ' + mbTag + ' — free the capital.';
  } else {
    call = '👀 MONITOR';
    why = mbTag + ' · ' + fxTag + ' · capex ' + s.final + ' ' + s.decision + (s.stage === '—' ? ' (no cycle)' : s.stage ? ' (Stage ' + s.stage + ')' : '') + ' — no actionable edge yet.';
  }
  // concall modifiers
  let note = '';
  if (cc && cc.freshness === 'FRESH' && cc.tone !== null && cc.tone < 0.4) {
    const DEMOTE: Record<string, string> = {
      '🎯 PRIME': '⏳ PRIME SETUP', '⏳ PRIME SETUP': '🌱 COMPOUNDER', '🌱 COMPOUNDER': '👀 MONITOR',
      '🏗 CAPEX PLAY': '👀 MONITOR', '⚙ CYCLE ONLY': '👀 MONITOR', '💎 QUALITY HOLD': '👀 MONITOR',
    };
    if (DEMOTE[call]) { call = DEMOTE[call]; note = '· mgmt cautious on last call'; }
    else note = '· mgmt cautious on last call';
  } else if (cc && cc.freshness === 'FRESH' && cc.tone !== null && cc.tone >= 0.65 && (cc.utilization ?? 0) >= 75) {
    note = '· 🔥 ramp confirmed on concall';
  } else if (!cc || cc.freshness === 'NONE') {
    note = '· no transcript';
  }
  const veto = call === '☠ DO NOT TOUCH';
  return { call, color: VERDICT_COLOR[call] || C.dim, why, composite, note, veto };
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

// ── v5.1: transcript file ingestion (PDF / PPTX / TXT, all in-browser) ─────
function loadPdfJs(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.pdfjsLib) return resolve(w.pdfjsLib);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => {
      try { w.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; } catch {}
      resolve(w.pdfjsLib);
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadJSZip(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.JSZip) return resolve(w.JSZip);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(w.JSZip); s.onerror = reject;
    document.head.appendChild(s);
  });
}

const TRANSCRIPT_CAP = 300000; // same 300k-char cap as the paste path
const capTranscript = (raw: string): string =>
  raw.length > TRANSCRIPT_CAP ? raw.slice(0, TRANSCRIPT_CAP - 60) + '\n\n[… truncated at the 300k-char transcript cap]' : raw;

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    out += (tc.items || []).map((it: any) => (it && typeof it.str === 'string' ? it.str : '')).join(' ') + '\n';
    if (out.length > TRANSCRIPT_CAP * 2) break; // far past the cap — stop reading pages
  }
  try { doc.destroy(); } catch {}
  return out;
}

async function extractPptxText(buf: ArrayBuffer): Promise<string> {
  const JSZip = await loadJSZip();
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.replace(/\D+/g, ''), 10) - parseInt(b.replace(/\D+/g, ''), 10));
  if (!slides.length) throw new Error('no slides found inside the file — is it a valid .pptx?');
  const unesc = (s: string) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
  const parts: string[] = [];
  for (const nm of slides) {
    const xml: string = await zip.files[nm].async('string');
    const texts: string[] = [];
    const re = /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml))) texts.push(unesc(m[1]));
    if (texts.length) parts.push(texts.join(' '));
  }
  return parts.join('\n');
}

// period detection: quarter/FY tokens from filename AND the first 3KB of text.
// Handles "Q4 & FY26", "Q2FY25", "Q1 and FY 2026", "quarter ended March 2026".
function findPeriod(s: string): string | null {
  const head = s.slice(0, 3072);
  const q = head.match(/Q([1-4])\s*(?:and|&)?[\s_\-]*(?:FY)?[\s_\-'&]*((?:20)?\d{2})\b/i);
  if (q) return 'Q' + q[1] + (/(and|&)/i.test(q[0].slice(2)) ? ' & ' : ' ') + 'FY' + (q[2].length === 4 ? q[2].slice(2) : q[2]);
  const qe = head.match(/quarter\s+(?:and\s+\w+\s+)?ended\s+([A-Za-z]+)[\s,]+(\d{4})/i);
  if (qe) {
    const map: Record<string, [string, number]> = { jun: ['Q1', 1], sep: ['Q2', 1], dec: ['Q3', 1], mar: ['Q4', 0] };
    const hit = map[qe[1].toLowerCase().slice(0, 3)];
    if (hit) return hit[0] + ' FY' + String((parseInt(qe[2], 10) + hit[1]) % 100).padStart(2, '0');
    return 'Quarter ended ' + qe[1] + ' ' + qe[2];
  }
  const fy = head.match(/FY[\s_\-']*((?:20)?\d{2})\b/i);
  if (fy) return 'FY' + (fy[1].length === 4 ? fy[1].slice(2) : fy[1]);
  return null;
}
// label: period derived from filename tokens AND the text head — never "untitled"
function transcriptLabel(fname: string, textHead: string): string {
  const base = fname.replace(/\.(pdf|pptx?|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
  const d = findPeriod(base) || findPeriod(textHead);
  return d ? d + ' · ' + base : base + ' · ' + new Date().toLocaleDateString();
}

// auto-attach: match stored company names token-wise against filename + transcript head
const CO_STOP = new Set(['ltd', 'limited', 'india', 'indian', 'industries', 'industry', 'technologies', 'technology', 'tech', 'company', 'corporation', 'corp', 'private', 'pvt', 'the', 'and', 'group', 'enterprises', 'international', 'solutions', 'systems', 'products', 'services', 'inc', 'plc']);
function matchCompanies(names: string[], fname: string, textHead: string): string[] {
  const norm = (s: string) => ' ' + s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  const hay = norm(fname) + norm(textHead);
  const out: string[] = [];
  for (const name of names) {
    const all = norm(name).trim().split(' ').filter(Boolean);
    const sig = all.filter((tk) => tk.length >= 3 && !CO_STOP.has(tk) && !/^\d+$/.test(tk));
    const probe = (sig.length ? sig : all)[0];
    if (probe && hay.indexOf(' ' + probe + ' ') >= 0) out.push(name);
  }
  return out;
}

const uid = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7);

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
    const rm = rowVals(/^RAW MATERIAL/, iPL, iQ);
    const chgInv = rowVals(/^CHANGE IN/, iPL, iQ);
    const taxRow = rowVals(/^TAX$/, iPL, iQ);
    const divRow = rowVals(/^DIVIDEND AMOUNT/, iPL, iQ);
    const ocf = rowVals(/^CASH FROM OPER/, iCF, iPrice > 0 ? iPrice : aoa.length);
    const cfi = rowVals(/^CASH FROM INVEST/, iCF, iPrice > 0 ? iPrice : aoa.length);
    const cff = rowVals(/^CASH FROM FINANC/, iCF, iPrice > 0 ? iPrice : aoa.length);
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
    // v5.4.8 — trajectory: prior-year ND/EBITDA so we know if it's rising or falling
    const ebitdaPrev = at(pbt, bc - 1) + (at(intr, bc - 1) || 0) + (at(dep, bc - 1) || 0);
    const netDebtPrev = at(bor, bc - 1) - (at(cashBank, bc - 1) || 0);
    const ndEbitdaPrev = isFinite(netDebtPrev) && ebitdaPrev > 0 ? netDebtPrev / ebitdaPrev : NaN;
    const ndTrend = isFinite(ndEbitda) && isFinite(ndEbitdaPrev) ? ndEbitda - ndEbitdaPrev : NaN;
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
    // v5.4.8 — ROIC vs WACC: India mid-cap WACC ~10-12%. Flag persistent ROCE < 10% as wealth destruction.
    const roceLast = roceSeries[bc] ?? NaN;
    const rocePrev = roceSeries[bc - 1] ?? NaN;
    const wealthDestroying = isFinite(roceLast) && isFinite(rocePrev) && roceLast < 10 && rocePrev < 10;
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
          priorEst = delivered ? 'Y' : borderline ? 'Borderline' : 'N';
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
    // v5.4.3 — also stash Net Block + CWIP series so the detail panel can show commissioning visually
    const nbSeriesJson = JSON.stringify(Array.from({ length: bc + 1 }, (_, i) => ({ y: yr(i), v: isFinite(at(nb, i)) ? Math.round(at(nb, i)) : 0 })));
    const cwipSeriesJson = JSON.stringify(Array.from({ length: bc + 1 }, (_, i) => ({ y: yr(i), v: isFinite(at(cwip, i) || 0) ? Math.round(at(cwip, i) || 0) : 0 })));

    const fx = (n: number, d = 1) => (isFinite(n) ? n.toFixed(d) : '');
    const out: Row = {
      'Company Name': name, Country: 'IN',
      'Capex Phase': phase, 'Capex/Sales %': fx(capexToSales), 'CWIP/NetBlock %': fx(cwipRatio),
      'Capex Accel x': fx(capexAccel, 2), 'D/E change 2y': fx(deChange, 2), 'OCF/Capex 3y %': fx(selfFund, 0),
      'Net Debt/EBITDA': fx(ndEbitda, 2),
      'ND/EBITDA Trend': isFinite(ndTrend) ? fx(ndTrend, 2) : '',
      'Wealth Destroying': wealthDestroying ? 'Y' : 'N', 'Capex/PreRev %': fx(capexPreRev, 0),
      'Util Effective % (est)': fx(utilEff, 0), 'NB Growth %': fx(nbGrowth, 0), 'Rev YoY %': fx(revYoY, 0),
      'Capex Series': seriesJson, 'NB Series': nbSeriesJson, 'CWIP Series': cwipSeriesJson, 'Prior Cycle Note': lastCycleNote,
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
    // ── v5: Fin Series — full 10y statement series for MB/forensic lenses ────
    try {
      const finN = Math.max(c, bc, oc) + 1;
      const r2 = (v: number | null | undefined) => (v === null || v === undefined || !isFinite(v) ? null : Math.round(v * 100) / 100);
      const padTo = (a: (number | null)[]) => Array.from({ length: finN }, (_, i) => r2(i < a.length ? a[i] : null));
      // capexSeries[k] is the spend in year index k+1 → align to the year axis
      const capexAligned = Array.from({ length: finN }, (_, i) => (i >= 1 && isFinite(capexSeries[i - 1]) ? Math.round(capexSeries[i - 1] * 100) / 100 : null));
      const finYears = Array.from({ length: finN }, (_, i) => yr(i));
      out['Fin Series'] = JSON.stringify({
        years: finYears, sales: padTo(sales), np: padTo(np), pbt: padTo(pbt), tax: padTo(taxRow),
        oi: padTo(oi), dep: padTo(dep), intr: padTo(intr), div: padTo(divRow),
        eq: padTo(eq), res: padTo(res), bor: padTo(bor), nb: padTo(nb), cwip: padTo(cwip),
        cash: padTo(cashBank), recv: padTo(recv), inv: padTo(inv), rm: padTo(rm), chgInv: padTo(chgInv),
        ocf: padTo(ocf), cfi: padTo(cfi), cff: padTo(cff),
        shares: padTo(shares), price: padTo(priceRow), mcap: isFinite(mcap) ? mcap : null, capex: capexAligned,
      });
    } catch {}
    // ── v5: optional workbook overlays (user's analysis template sheets) ─────
    try {
      const fws = wb.Sheets['Fraud checklist'];
      if (fws) {
        const items: { row: number; label: string; answer: string }[] = [];
        for (let rI = 8; rI <= 37; rI++) {
          const labC = fws['B' + rI];
          const labV = labC && labC.v != null ? String(labC.v).trim() : '';
          if (!labV) continue;
          for (const colL of ['C', 'D', 'E', 'F', 'G', 'H', 'I']) {
            const cell = fws[colL + rI];
            const ansV = cell && cell.v != null ? String(cell.v).trim() : '';
            if (!ansV) continue;
            if (/^(y|yes|true|fail|red|bad|⚠|x)$/i.test(ansV)) items.push({ row: rI, label: labV, answer: 'adverse' });
            else if (/^(n|no|ok|pass|clean|green|✓)$/i.test(ansV)) items.push({ row: rI, label: labV, answer: 'clean' });
            break; // only the first non-empty answer cell counts
          }
        }
        if (items.length) out['Fraud Tab'] = JSON.stringify(items);
      }
      const mws = wb.Sheets['Moat Assessment Sheet'];
      if (mws) {
        const mv = (a: string) => { const cell = mws[a]; return cell && typeof cell.v === 'number' && isFinite(cell.v) ? cell.v : null; };
        const avgRoe = mv('M9'), avgRoic = mv('M10'), avgRoce = mv('M11');
        if (avgRoe !== null && avgRoic !== null && avgRoce !== null) out['Moat Tab'] = JSON.stringify({ avgRoe, avgRoic, avgRoce });
      }
    } catch {}
    return out;
  } catch { return null; }
}

const KD = 'mc:capex-tracker:data:v1'; const KN = 'mc:capex-tracker:files:v1';
const KC = 'mc:capex-tracker:concalls:v1'; // transcripts — survive 'Clear all'
const KU = '__unassigned__'; // bucket key inside KC for uploads that matched 0 or 2+ companies

// ── small visual atoms ──────────────────────────────────────────────────────
const TierBars = ({ s, w = 30 }: { s: Scored; w?: number }) => (
  <div style={{ display: 'flex', gap: 3, alignItems: 'center' }} title={s.tiers.map((t) => t.label + ' ' + t.pts + '/' + t.max).join(' · ')}>
    {s.tiers.map((t) => {
      const pct = t.max ? t.pts / t.max : 0;
      const col = pct >= 0.7 ? C.green : pct >= 0.4 ? C.amber : C.red;
      return (
        <div key={t.label} style={{ width: w }}>
          <div style={{ fontSize: 9, color: C.dim, textAlign: 'center', lineHeight: '10px' }}>{t.label}</div>
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

// T0→T5 horizontal stepper — fixed-height nodes (dot + stage + lag), connector
// lines between them, nowrap + horizontal scroll on overflow. Never collapses
// into a vertical run. Current position gets a ring in the band color.
const Timeline = ({ s }: { s: Scored }) => {
  const noCycle = s.stage === '—';
  const m = s.stage && !noCycle ? STAGE_META[s.stage] : null;
  const T = [
    ['T0', 'Announced'], ['T1', 'Commissioned'], ['T2', 'Util rising'],
    ['T3', 'Earnings inflect'], ['T4', 'Recognition'], ['T5', 'Peak / new capex'],
  ];
  const lags = ['12-24m', '6-12m', '6-12m', '6-12m', '12-24m'];
  const pos = m ? m.pos : -1; // fractional 0..5
  const curIdx = m ? Math.min(5, Math.floor(pos)) : -1;
  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 10, padding: '14px 16px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2, opacity: noCycle ? 0.55 : 1 }}>
        {T.map(([t, lbl], i) => {
          const done = m !== null && i <= pos;
          const isCur = i === curIdx;
          const dotCol = isCur ? m!.color : done ? m!.color + 'AA' : C.line;
          return (
            <Fragment key={t}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 92, flexShrink: 0 }}>
                <div style={{
                  width: 14, height: 14, borderRadius: '50%', marginTop: 4, boxSizing: 'border-box',
                  background: done || isCur ? dotCol : C.panel2,
                  border: '2px solid ' + (done || isCur ? dotCol : C.dim),
                  boxShadow: isCur ? '0 0 0 4px ' + m!.color + '33, 0 0 10px ' + m!.color + '88' : 'none',
                }} />
                <div style={{ fontSize: F.xs, fontWeight: 800, marginTop: 7, whiteSpace: 'nowrap', color: isCur ? m!.color : done ? C.txt : C.dim }}>
                  {t} <span style={{ fontWeight: isCur ? 800 : 600 }}>{lbl}</span>
                </div>
                {isCur && <div style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.8, color: m!.color, marginTop: 2 }}>● STAGE {s.stage}</div>}
              </div>
              {i < 5 && (
                <div style={{ flex: 1, minWidth: 36, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 10 }}>
                  <div style={{ height: 2, width: '100%', borderRadius: 1, background: m && i < pos ? m.color + '88' : C.line }} />
                  <div style={{ fontSize: 10, color: C.dim, marginTop: 5, whiteSpace: 'nowrap' }}>{lags[i]}</div>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {m && (() => {
        const qualityBad = s.final < 40;
        const qualityWatch = s.final >= 40 && s.final < 55;
        const stageOpen = s.stage === 'B' || s.stage === 'C' || s.stage === 'D';
        const showConditional = stageOpen && (qualityBad || qualityWatch);
        return (
          <>
            {showConditional && (
              <div style={{ marginTop: 10, fontSize: F.sm, lineHeight: 1.55, borderLeft: '3px solid ' + C.amber, background: C.amber + '0D', borderRadius: '0 8px 8px 0', padding: '8px 12px' }}>
                <b style={{ color: C.amber }}>⚠ Stage {s.stage} window IS open</b> <span style={{ color: C.body }}>— but quality score {s.final} is below the safety floor. The alpha window is conditional: realizes <b>only if</b> utilization ramps successfully AND leverage normalizes AND ROCE recovers. Treat as <b>high-risk speculative</b> rather than core buy.</span>
              </div>
            )}
            <div style={{ marginTop: 10, fontSize: F.sm, lineHeight: 1.55, borderLeft: '3px solid ' + m.color, background: m.color + '0D', borderRadius: '0 8px 8px 0', padding: '8px 12px' }}>
              <b style={{ color: m.color }}>Stage {s.stage} — {m.label}</b>{' '}
              <span style={{ color: C.body }}>{m.note}</span>{' '}
              <span style={{ color: C.body }}>· framework size {m.size}</span>
            </div>
          </>
        );
      })()}
      {!m && (
        <div style={{ marginTop: 10, fontSize: F.sm, lineHeight: 1.55, borderLeft: '3px solid ' + C.blue, background: C.blue + '0D', borderRadius: '0 8px 8px 0', padding: '8px 12px', color: C.body }}>
          {noCycle
            ? <><b style={{ color: C.blue }}>NO MAJOR CYCLE</b> — capex is running at routine, serial-brownfield scale, so the T0→T5 multibagger arc does not apply to this name. Judge it as a steady compounder and re-arm the timeline on a real capex announcement.</>
            : <><b style={{ color: C.blue }}>NO ACTIVE CYCLE IN TELEMETRY</b> — nothing to place on the arc yet; the stepper arms when commissioning telemetry appears.</>}
        </div>
      )}
    </div>
  );
};

// year-by-year capex strip — aligned mini-bars: value on top, bar sized by
// value, year label underneath. Fixed lane heights keep the row perfectly level.
const CapexStrip = ({ s }: { s: Scored }) => {
  const ser = s.capexSeries.filter((d) => d.y);
  if (!ser.length) return null;
  const mx = Math.max(...ser.map((d) => d.v), 1);
  return (
    <div style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 10, padding: '10px 14px 12px' }}>
      <SectionHead label="Capex by year" color={C.orange} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>Cr · ΔNB + ΔCWIP + Dep</span>} />
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
        {ser.map((d, i) => {
          const lastN = i >= ser.length - 1;
          return (
            <div key={d.y + i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }} title={d.y + ': ' + d.v + ' Cr'}>
              <div style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: lastN ? C.orange : C.body, fontWeight: lastN ? 800 : 600, marginBottom: 3 }}>{d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v}</div>
              <div style={{ width: '72%', maxWidth: 30, height: Math.max(3, Math.round((d.v / mx) * 52)), background: lastN ? C.orange : C.blue + '77', borderRadius: '3px 3px 0 0' }} />
              <div style={{ width: '100%', borderTop: '1px solid ' + C.line, marginTop: 0 }} />
              <div style={{ fontSize: 10, color: lastN ? C.dim : C.muted, fontWeight: lastN ? 700 : 400, marginTop: 3 }}>{d.y}</div>
            </div>
          );
        })}
      </div>
      {(() => {
        const nbS = (s.nbSeries || []).filter((d) => d.y);
        if (!nbS.length) return null;
        const nbMx = Math.max(...nbS.map((d) => d.v), 1);
        return (
          <div style={{ marginTop: 12 }}>
            <SectionHead label="Fixed Assets (Net Block) by year" color={C.teal} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>Cr · gross blocks commissioned</span>} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {nbS.map((d, i) => {
                const lastN = i >= nbS.length - 1;
                return (
                  <div key={d.y + i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }} title={d.y + ': ' + d.v + ' Cr'}>
                    <div style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: lastN ? C.teal : C.body, fontWeight: lastN ? 800 : 600, marginBottom: 3 }}>{d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v}</div>
                    <div style={{ width: '72%', maxWidth: 30, height: Math.max(3, Math.round((d.v / nbMx) * 52)), background: lastN ? C.teal : C.teal + '55', borderRadius: '3px 3px 0 0' }} />
                    <div style={{ width: '100%', borderTop: '1px solid ' + C.line, marginTop: 0 }} />
                    <div style={{ fontSize: 10, color: lastN ? C.dim : C.muted, fontWeight: lastN ? 700 : 400, marginTop: 3 }}>{d.y}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {(() => {
        const cwS = (s.cwipSeries || []).filter((d) => d.y);
        if (!cwS.length) return null;
        const cwMx = Math.max(...cwS.map((d) => d.v), 1);
        return (
          <div style={{ marginTop: 12 }}>
            <SectionHead label="CWIP by year" color={C.amber} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>Cr · projects under construction (build → drain = commissioning)</span>} />
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              {cwS.map((d, i) => {
                const lastN = i >= cwS.length - 1;
                return (
                  <div key={d.y + i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }} title={d.y + ': ' + d.v + ' Cr'}>
                    <div style={{ fontSize: 10.5, fontVariantNumeric: 'tabular-nums', color: lastN ? C.amber : C.body, fontWeight: lastN ? 800 : 600, marginBottom: 3 }}>{d.v >= 1000 ? (d.v / 1000).toFixed(1) + 'k' : d.v}</div>
                    <div style={{ width: '72%', maxWidth: 30, height: Math.max(3, Math.round((d.v / cwMx) * 52)), background: lastN ? C.amber : C.amber + '55', borderRadius: '3px 3px 0 0' }} />
                    <div style={{ width: '100%', borderTop: '1px solid ' + C.line, marginTop: 0 }} />
                    <div style={{ fontSize: 10, color: lastN ? C.dim : C.muted, fontWeight: lastN ? 700 : 400, marginTop: 3 }}>{d.y}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}
      {s.cycleNote && <div style={{ marginTop: 8, fontSize: F.sm, color: s.cycleNote.includes('DELIVERED ✓') ? C.green : s.cycleNote.includes('BORDERLINE') ? C.amber : C.red }}>🕰 {s.cycleNote}</div>}
    </div>
  );
};

// ════════════════════════════════════════════════════════════════════════════
export default function CapexTrackerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [tab, setTab] = useState<'board' | 'analytics' | 'multibagger' | 'forensics' | 'concall' | 'verdict' | 'model'>('board');
  // PATCH — hydrate tab from the tab URL param (home 🧭 Verdict chip deep link).
  // Mount-effect (not useState initializer) to avoid SSR hydration mismatch.
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('tab');
      if (p && ['board','analytics','multibagger','forensics','concall','verdict','model'].includes(p)) setTab(p as any);
    } catch { /* noop */ }
  }, []);
  const [q, setQ] = useState('');
  const [band, setBand] = useState('ALL');
  const [minScore, setMinScore] = useState(0);
  const [sortKey, setSortKey] = useState('final');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  // v5 state
  const [concalls, setConcalls] = useState<Record<string, ConcallEntry[]>>({});
  const [openMB, setOpenMB] = useState<string | null>(null);
  const [openFX, setOpenFX] = useState<string | null>(null);
  const [ccCompany, setCcCompany] = useState('');
  const [ccLabel, setCcLabel] = useState('');
  const [ccText, setCcText] = useState('');
  const [ccView, setCcView] = useState<string | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [assignSel, setAssignSel] = useState<Record<string, string>>({});
  const ccFileRef = useRef<HTMLInputElement>(null);

  // refs mirror rows/files so multi-file uploads (an awaited loop) never merge
  // against a stale closure — file 2 must see file 1's rows, not the initial state
  const rowsRef = useRef<Row[]>([]);
  const filesRef = useRef<string[]>([]);
  const concallsRef = useRef<Record<string, ConcallEntry[]>>({}); // same staleness guard for transcript batches

  useEffect(() => {
    try {
      const d = localStorage.getItem(KD); const n = localStorage.getItem(KN);
      if (d) { const pr = JSON.parse(d); rowsRef.current = pr; setRows(pr); }
      if (n) { const pf = JSON.parse(n); filesRef.current = pf; setFiles(pf); }
      const cc = localStorage.getItem(KC); if (cc) {
        const pc = JSON.parse(cc);
        // v5.3 — re-extract stored transcripts when the extractor version bumps
        // (old extracts carried bugs like 'from 30% to 65%' reading 30).
        try {
          let changed = false;
          for (const compKey of Object.keys(pc)) {
            const arr = pc[compKey];
            if (!Array.isArray(arr)) continue;
            for (const e of arr) {
              if (e && e.text && (!e.extract || e.extract.__v !== 3)) { e.extract = extractConcall(e.text); changed = true; }
            }
          }
          if (changed) localStorage.setItem(KC, JSON.stringify(pc));
        } catch {}
        concallsRef.current = pc; setConcalls(pc);
      }
    } catch {}
  }, []);

  const persist = (r: Row[], f: string[]) => {
    rowsRef.current = r; filesRef.current = f;
    setRows(r); setFiles(f);
    try { localStorage.setItem(KD, JSON.stringify(r)); localStorage.setItem(KN, JSON.stringify(f)); } catch {}
  };

  const mergeRows = (incoming: Row[], fname: string) => {
    if (!incoming.length) { setMsg('No data rows found in ' + fname); return; }
    const h = resolveHeaders(Object.keys(incoming[0]));
    if (!h['name']) { setMsg('Could not read ' + fname + ': plain tables need a Company Name column (Screener.in Excel exports are auto-detected). Download the template for the flat format.'); return; }
    const key = (r: Row, hh: Record<string, string>) => (r[hh['name']] || '').trim().toLowerCase();
    const merged = [...rowsRef.current];
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
    persist(merged, [...filesRef.current.filter((f) => f !== fname), fname]);
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
        } else if (/\.(pdf|pptx|ppt|txt)$/i.test(f.name)) {
          await onTranscriptFile(f); // concall pipeline — mixed picks (xlsx + pdf) both route correctly
        } else {
          mergeRows(parseCSV(await f.text()), f.name);
        }
      } catch (e: any) { setMsg('Failed to read ' + f.name + ': ' + (e?.message || e)); }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  // ── v5.1: transcript file → extract text → auto-attach to a company ───────
  const attachMsg = (company: string, en: ConcallEntry): string => {
    const ex = en.extract; const sig: string[] = [];
    if (ex.utilization !== null) sig.push('utilization ' + ex.utilization + '% detected');
    if (ex.orderBook !== null) sig.push('order book ' + ex.orderBook.toLocaleString() + ' Cr');
    if (ex.capexGuidance !== null) sig.push('capex guide ' + ex.capexGuidance.toLocaleString() + ' Cr');
    if (ex.tone !== null) sig.push('tone ' + Math.round(ex.tone * 100) + '% positive');
    return '🎙 Transcript attached to ' + company + ' ("' + en.label + '")' +
      (sig.length ? ' · ' + sig.join(' · ') + ' — Apply chips ready on the 🎙 Concall tab.' : ' · no numeric signals found — open the 🎙 Concall tab to review.');
  };
  const onTranscriptFile = async (f: File) => {
    if (/\.ppt$/i.test(f.name)) {
      setMsg('⚠ ' + f.name + ' is a legacy binary .ppt that browsers cannot parse — export it as PDF (or .pptx) and re-upload. The rest of the batch continues.');
      return;
    }
    const raw = (/\.pdf$/i.test(f.name) ? await extractPdfText(await f.arrayBuffer())
      : /\.pptx$/i.test(f.name) ? await extractPptxText(await f.arrayBuffer())
      : await f.text()).trim();
    if (!raw) { setMsg('⚠ No text found in ' + f.name + (/\.pdf$/i.test(f.name) ? ' — likely a scanned/image-only PDF. ' : ' — ') + 'paste the text on the 🎙 Concall tab instead.'); return; }
    const body = capTranscript(raw);
    const names = rowsRef.current.map((r) => { const h = resolveHeaders(Object.keys(r)); return (r[h['name']] || '').trim(); }).filter(Boolean);
    const matches = matchCompanies(names, f.name, body.slice(0, 2048));
    const entry: ConcallEntry = {
      id: uid(), label: transcriptLabel(f.name, body), addedAt: new Date().toISOString(),
      chars: body.length, text: body, extract: extractConcall(body),
    };
    if (matches.length === 1) {
      const k = ckey(matches[0]);
      const list = concallsRef.current[k] ?? [];
      if (list.length >= 8) { setMsg('⚠ ' + matches[0] + ' already has 8 transcripts (the cap) — delete one on the 🎙 Concall tab, then re-upload ' + f.name + '.'); return; }
      if (persistConcalls({ ...concallsRef.current, [k]: [...list.filter((e) => e.chars !== entry.chars || e.text.slice(0, 200) !== entry.text.slice(0, 200)), entry] })) setMsg(attachMsg(matches[0], entry));
    } else {
      const pool = concallsRef.current[KU] ?? [];
      if (pool.length >= 12) { setMsg('⚠ 12 transcripts already parked in UNASSIGNED — assign or delete some on the 🎙 Concall tab first.'); return; }
      if (persistConcalls({ ...concallsRef.current, [KU]: [...pool, entry] })) {
        setMsg('🎙 ' + f.name + ' parsed (' + body.length.toLocaleString() + ' chars) but ' +
          (matches.length === 0 ? 'no stored company matched' : matches.length + ' companies matched (' + matches.slice(0, 3).join(', ') + (matches.length > 3 ? '…' : '') + ')') +
          ' — parked in UNASSIGNED on the 🎙 Concall tab; pick the company there.');
      }
    }
  };
  const assignUnassigned = (id: string, company: string) => {
    if (!company) { setMsg('Pick a company to assign this transcript to.'); return; }
    const pool = concallsRef.current[KU] ?? [];
    const en = pool.find((e) => e.id === id); if (!en) return;
    const k = ckey(company);
    const list = concallsRef.current[k] ?? [];
    if (list.length >= 8) { setMsg('⚠ ' + company + ' already has 8 transcripts (the cap) — delete one first.'); return; }
    const next = { ...concallsRef.current, [k]: [...list, en] };
    const rest = pool.filter((e) => e.id !== id);
    if (rest.length) next[KU] = rest; else delete next[KU];
    if (persistConcalls(next)) setMsg(attachMsg(company, en));
  };

  const clearAll = () => {
    if (!confirm('Clear ALL saved capex data AND transcripts? This cannot be undone.')) return;
    persist([], []);
    try { localStorage.removeItem(KC); } catch {}
    concallsRef.current = {};
    setConcalls({});
    setMsg('All data and transcripts cleared.');
  };

  const scored = useMemo(() => {
    if (!rows.length) return [] as Scored[];
    return rows.map((r) => { const cc = concalls[r.name]?.slice(-1)[0]?.extract; const extras = cc ? { orderBookCr: cc.orderBook, customerCount: cc.customerCount, exportPct: cc.exportPct, utilization: cc.utilization } : undefined; return scoreRow(r, resolveHeaders(Object.keys(r)), extras); }).sort((a, b) => b.final - a.final);
  }, [rows, concalls]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { 'ANCHOR BUY': 0, 'CORE BUY': 0, SATELLITE: 0, 'NEEDS DATA': 0, WATCHLIST: 0, AVOID: 0, REJECT: 0 };
    scored.forEach((s) => { c[s.decision] = (c[s.decision] || 0) + 1; });
    return c;
  }, [scored]);

  // ── v5: concall store (separate key — survives 'Clear all') ────────────────
  const ckey = (name: string) => name.trim().toLowerCase();
  const persistConcalls = (next: Record<string, ConcallEntry[]>): boolean => {
    const json = JSON.stringify(next);
    if (json.length > 2_500_000) { setMsg('⚠ Transcript store would exceed 2.5MB — delete old transcripts first. NOT saved.'); return false; }
    try { localStorage.setItem(KC, json); } catch { setMsg('⚠ Browser storage quota exceeded — transcript NOT saved.'); return false; }
    concallsRef.current = next;
    setConcalls(next);
    return true;
  };
  const addTranscript = (company: string, label: string, text: string) => {
    if (!company) { setMsg('Pick a company for the transcript.'); return; }
    const body = text.trim();
    if (!body) { setMsg('Paste the transcript text first.'); return; }
    if (body.length > 300000) { setMsg('⚠ Transcript too large — trim to the management+Q&A section (max 300k chars).'); return; }
    const k = ckey(company);
    let list = [...(concallsRef.current[k] ?? [])];
    if (list.length >= 8) {
      if (!confirm('This company already has 8 transcripts (the cap). Delete the oldest to make room?')) return;
      list = list.slice(1);
    }
    // never "untitled": derive period from the text head, else "{Company short} · {date}"
    const coShort = company.split(/\s+/).slice(0, 2).join(' ');
    const period = findPeriod(body);
    const autoLabel = (period ? period + ' · ' : '') + coShort + (period ? '' : ' · ' + new Date().toLocaleDateString());
    const entry: ConcallEntry = {
      id: uid(), label: label.trim() || autoLabel, addedAt: new Date().toISOString(),
      chars: body.length, text: body, extract: extractConcall(body),
    };
    if (persistConcalls({ ...concallsRef.current, [k]: [...list.filter((e) => e.chars !== entry.chars || e.text.slice(0, 200) !== entry.text.slice(0, 200)), entry] })) {
      setMsg('🎙 Saved transcript for ' + company + ' — ' + body.length.toLocaleString() + ' chars, extraction below.');
      setCcLabel(''); setCcText('');
    }
  };
  const deleteTranscript = (k: string, id: string) => {
    if (!confirm('Delete this transcript?')) return;
    const list = (concallsRef.current[k] ?? []).filter((e) => e.id !== id);
    const next = { ...concallsRef.current };
    if (list.length) next[k] = list; else delete next[k];
    persistConcalls(next);
  };
  const clearTranscripts = () => {
    if (!confirm('Clear ALL saved concall transcripts? (Company data is untouched.)')) return;
    try { localStorage.removeItem(KC); } catch {}
    concallsRef.current = {};
    setConcalls({}); setMsg('All transcripts cleared.');
  };
  const ccStateFor = (name: string): CCState & { latest: ConcallEntry | null } => {
    const list = concalls[ckey(name)] ?? [];
    if (!list.length) return { freshness: 'NONE', tone: null, utilization: null, latest: null };
    const latest = list[list.length - 1];
    const ageDays = (Date.now() - +new Date(latest.addedAt)) / 86400000;
    return {
      freshness: ageDays < 120 ? 'FRESH' : ageDays <= 365 ? 'STALE' : 'NONE',
      tone: latest.extract.tone, utilization: latest.extract.utilization, latest,
    };
  };

  // ── v5: per-company intelligence (derived, never persisted) ────────────────
  const intel = useMemo(() => scored.map((s) => {
    const fin = parseFin(s.raw);
    const fx = computeForensic(fin, s.raw);
    const mb = computeMultibagger(fin, s, s.raw, fx.grade);
    const cc = ccStateFor(s.name);
    const verdict = computeVerdict(s, mb, fx, cc);
    return { s, fin, mb, fx, cc, verdict };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [scored, concalls]);
  const intelByName = useMemo(() => { const m: Record<string, (typeof intel)[number]> = {}; intel.forEach((it) => { m[ckey(it.s.name)] = it; }); return m; }, [intel]);

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
  const card: any = { background: C.panel, border: '1px solid ' + C.line, borderRadius: 12, padding: 16 };
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

  // v5: one-click apply of concall-extracted numbers → clean canonical headers
  // (writes "82 (concall)" — num() reads 82, provenance stays visible, manual-
  // equivalent so it survives re-uploads exactly like an inline edit)
  const ConcallChips = ({ s }: { s: Scored }) => {
    const st = ccStateFor(s.name);
    if (!st.latest) return null;
    const ex = st.latest.extract;
    const sug: { label: string; canonical: string; value: number; quote: string }[] = [];
    const curUtil = num(String(s.raw['Capacity Utilization %'] ?? ''));
    if (ex.utilization !== null && (!isFinite(curUtil) || Math.abs(curUtil - ex.utilization) >= 1)) {
      const q = ex.quotes.find((x) => x.field === 'utilization');
      sug.push({ label: '🎙 util ' + ex.utilization + '% (concall)', canonical: 'Capacity Utilization %', value: ex.utilization, quote: q ? q.snippet : '' });
    }
    const curAnchor = num(String(s.raw['Anchor Demand %'] ?? ''));
    let anchorSug: number | null = ex.anchorPct;
    let anchorQ = ex.quotes.find((x) => x.field === 'anchorPct');
    if (anchorSug === null && ex.orderBook !== null) {
      const rev = num(String(s.raw['Annual Revenue'] ?? ''));
      if (isFinite(rev) && rev > 0) { anchorSug = Math.min(100, Math.round((ex.orderBook / rev) * 100)); anchorQ = ex.quotes.find((x) => x.field === 'orderBook'); }
    }
    if (anchorSug !== null && (!isFinite(curAnchor) || Math.abs(curAnchor - anchorSug) >= 1)) {
      sug.push({ label: '🎙 anchor ~' + anchorSug + '% ' + (ex.anchorPct !== null ? '(concall)' : '(order book ÷ revenue)'), canonical: 'Anchor Demand %', value: anchorSug, quote: anchorQ ? anchorQ.snippet : '' });
    }
    if (!sug.length) return null;
    return (
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0' }}>
        <span style={{ fontSize: F.xs, color: C.gold, fontWeight: 800 }}>🎙 from "{st.latest.label}":</span>
        {sug.map((g) => (
          <span key={g.canonical} title={g.quote ? '…' + g.quote + '…' : ''} style={{ fontSize: F.xs, padding: '3px 8px', borderRadius: 8, background: C.gold + '14', border: '1px solid ' + C.gold + '55', color: C.gold, fontWeight: 700 }}>
            {g.label}{' '}
            <button onClick={(e) => { e.stopPropagation(); updateRow(s.name, g.canonical, g.value + ' (concall)'); setMsg('Applied ' + g.canonical + ' = ' + g.value + ' from the concall — rescored.'); }}
              style={{ fontSize: 10, fontWeight: 900, padding: '1px 7px', borderRadius: 6, cursor: 'pointer', background: C.gold + '33', border: '1px solid ' + C.gold, color: C.txt }}>Apply</button>
          </span>
        ))}
      </div>
    );
  };

  // current value precedence mirrors the engine: clean → resolver → (est).
  // Inputs are grouped under DEMAND / OWNERSHIP / PROJECT / CONTEXT mini-headers
  // with one uniform 28px control height and ≥11px labels.
  const EDIT_GROUPS: [string, string[]][] = [
    ['Demand', ['Capacity Utilization %', 'Anchor Demand %']],
    ['Ownership', ['Promoter Holding %', 'Promoter Pledge %']],
    ['Project', ['Internal funding %', 'Brownfield', 'Cycle Position', 'Cost Overrun History', 'Working Capital Trend', 'Prior Capex Success']],
    ['Context', ['Policy Support', 'PE vs 5-yr Mean', 'Import Substitution', 'Export Opportunity', 'Competitive Moat', 'Industry']],
  ];
  const Editor = ({ s }: { s: Scored }) => {
    const h = resolveHeaders(Object.keys(s.raw));
    const inputStyle: any = { background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '0 8px', fontSize: F.xs, width: '100%', height: 28, boxSizing: 'border-box' };
    const renderField = (canonical: string) => {
      const tuple = EDIT_FIELDS.find(([cn]) => cn === canonical);
      if (!tuple) return null;
      const [, hkey, kind] = tuple;
      const clean = String(s.raw[canonical] ?? '').trim();
      const col = h[hkey];
      const resolved = col && col !== canonical + ' (est)' ? String(s.raw[col] ?? '').trim() : '';
      const est = String(s.raw[canonical + ' (est)'] ?? '').trim();
      const cur = clean || resolved || est;
      const isEst = !clean && !resolved && !!est;
      return (
        <label key={canonical} style={{ fontSize: 11, fontWeight: 600, color: isEst ? C.amber : C.body, display: 'grid', gap: 3 }}>
          <span>{canonical}{isEst ? ' · est' : ''}</span>
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
    };
    return (
      <div style={{ marginTop: 2, borderTop: '1px dashed ' + C.line, paddingTop: 10 }}>
        <SectionHead label="✍️ Editor" color={C.violet} extra={<span style={{ fontSize: 10, color: C.dim, whiteSpace: 'nowrap' }}>auto-saves · rescores instantly · manual beats (est)</span>} />
        <ConcallChips s={s} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14, alignItems: 'start' }}>
          {EDIT_GROUPS.map(([g, fields]) => (
            <div key={g}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.4, color: C.dim, textTransform: 'uppercase' as const, borderBottom: '1px solid ' + C.line, paddingBottom: 3, marginBottom: 7 }}>{g}</div>
              <div style={{ display: 'grid', gap: 7 }}>{fields.map(renderField)}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  // ── expanded detail: VERDICT → TIMELINE → TELEMETRY → CAPEX BY YEAR →
  //    21-FACTOR BREAKDOWN → TRIGGERS → EDITOR, one section-header style ──────
  const Detail = ({ s }: { s: Scored }) => {
    const chip = (txt: string, col: string): any => ({
      fontSize: F.xs, padding: '4px 10px', borderRadius: 8, fontWeight: 700, lineHeight: 1.45,
      background: col + '14', border: '1px solid ' + col + '44', color: col,
    });
    const tile = (label: string, val: string, col: string) => (
      <div key={label} style={{ background: C.bg, border: '1px solid ' + C.line, borderRadius: 8, padding: '8px 10px 7px', display: 'grid', gap: 3, alignContent: 'start' }}>
        <div style={{ fontSize: 10, color: C.dim, fontWeight: 700, letterSpacing: 0.7, lineHeight: 1.3 }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 900, color: col, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{val}</div>
      </div>
    );
    return (
      <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 16, margin: '6px 0 10px', display: 'grid', gap: 14 }}>
        {/* ── VERDICT ── */}
        <div>
          <SectionHead label="Verdict" color={s.entryColor} />
          <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', background: s.entryColor + '10', border: '1px solid ' + s.entryColor + '55', borderRadius: 10, padding: '12px 16px' }}>
            <div style={{ fontSize: 34, fontWeight: 900, color: s.decisionColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.final}</div>
            <div style={{ display: 'grid', gap: 4, flex: 1, minWidth: 260 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55' }}>{s.decision}</span>
                <StageChip stage={s.stage} />
                <span style={{ fontSize: F.xs, fontWeight: 700, color: C.dim, letterSpacing: 0.5 }}>{s.stageLabel}</span>
              </div>
              <div style={{ fontSize: F.sm, color: s.entryColor, fontWeight: 700, lineHeight: 1.5 }}>{s.entry}</div>
            </div>
          </div>
        </div>
        {/* ── TIMELINE ── */}
        <div>
          <SectionHead label="Timeline — T0→T5 arc" color={C.violet} />
          <Timeline s={s} />
        </div>
        {/* ── TELEMETRY ── */}
        <div>
          <SectionHead label="Telemetry" color={C.cyan} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))', gap: 8 }}>
            {s.phase ? tile('PHASE', s.phase, s.phase === 'BUILDING' ? C.orange : s.phase === 'RAMPING' ? C.green : C.txt) : null}
            {!isNaN(s.capexToSales) && tile('CAPEX / SALES', s.capexToSales.toFixed(1) + '%', C.txt)}
            {!isNaN(s.cwipRatio) && tile('CWIP / BLOCK', s.cwipRatio.toFixed(0) + '%', s.cwipRatio > 30 ? C.amber : C.txt)}
            {!isNaN(s.capexAccel) && tile('SPEND ACCEL', s.capexAccel.toFixed(1) + 'x', s.capexAccel > 1.6 ? C.orange : C.txt)}
            {!isNaN(s.netDebtEbitda) && tile('NET DEBT / EBITDA', s.netDebtEbitda < 0 ? 'net cash' : s.netDebtEbitda.toFixed(2) + 'x', s.netDebtEbitda > 2 ? C.red : C.green)}
            {!isNaN(s.capexPreRev) && tile('CYCLE CAPEX / PRE-REV', s.capexPreRev.toFixed(0) + '%', s.capexPreRev >= 30 && s.capexPreRev <= 60 ? C.green : s.capexPreRev > 100 ? C.red : C.amber)}
            {!isNaN(s.utilEff) && tile('EFF. UTIL (EST)', s.utilEff.toFixed(0) + '%', s.utilEff > 90 ? C.red : s.utilEff >= 30 && s.utilEff < 70 ? C.gold : C.txt)}
            {!isNaN(s.selfFund) && tile('OCF / CAPEX 3Y', s.selfFund.toFixed(0) + '%', s.selfFund >= 70 ? C.green : s.selfFund >= 40 ? C.amber : C.red)}
            {!isNaN(s.deChange) && tile('Δ D/E 2Y', (s.deChange >= 0 ? '+' : '') + s.deChange.toFixed(2), s.deChange > 0.3 ? C.red : C.txt)}
          </div>
          {!isNaN(s.capexPreRev) && (
            <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.6, marginTop: 8 }}>
              Framework sweet spot: cycle capex 30-60% of pre-capex revenue.{' '}
              <b style={{ color: s.capexPreRev >= 30 && s.capexPreRev <= 60 ? C.green : s.capexPreRev > 100 ? C.red : C.amber }}>
                {s.capexPreRev < 30 ? 'Below 30% — lever too small for multibagger math.' : s.capexPreRev <= 60 ? 'IN the sweet spot.' : s.capexPreRev <= 100 ? 'Above 60% — execution + leverage risk rising.' : 'Way above — bet-the-company build.'}
              </b>{' '}Net Debt/EBITDA rule: &lt;2x clean at peak capex; &gt;3x for 2 quarters = mechanical reject.
            </div>
          )}
        </div>
        {/* ── CAPEX BY YEAR ── */}
        <CapexStrip s={s} />
        {/* ── 21-FACTOR BREAKDOWN ── */}
        <div>
          <SectionHead label="21-factor quality breakdown" color={C.cyan}
            extra={<span style={{ fontSize: F.xs, color: C.dim, whiteSpace: 'nowrap' }}>measured {s.base}/{s.availMax} ({s.measuredPct}%) × industry {s.mult.toFixed(2)}{s.dbCount >= 3 ? ' → capped 30' : ''} = <b style={{ color: s.decisionColor, fontSize: F.sm }}>{s.final}</b> · conf {s.confidence}{s.gaps ? ' · ' + s.gaps + ' gaps' : ''}{s.estUsed ? ' · ' + s.estUsed + ' est' : ''}</span>} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(330px, 1fr))', columnGap: 18, rowGap: 2 }}>
            {s.factors.map((f) => {
              const nd = f.note === 'no data';
              const pct = f.max ? f.pts / f.max : 0;
              const col = nd ? C.muted : pct >= 0.7 ? C.green : pct > 0 ? C.amber : C.red;
              return (
                <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', borderBottom: '1px solid ' + C.line, fontSize: F.xs, fontStyle: nd ? 'italic' : 'normal', opacity: nd ? 0.75 : 1 }}>
                  <span style={{ color: nd ? C.dim : C.txt, fontWeight: 600, whiteSpace: 'nowrap' }}><span style={{ color: C.muted, fontWeight: 700 }}>T{f.tier}·F{f.id}</span> {f.label}</span>
                  <span style={{ color: C.dim, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.note}>{!nd && f.note ? f.note : nd ? 'no data' : ''}</span>
                  <span style={{ width: 38, height: 4, borderRadius: 2, background: C.line, overflow: 'hidden', flexShrink: 0 }}>
                    <span style={{ display: 'block', width: Math.round(pct * 100) + '%', height: '100%', background: col }} />
                  </span>
                  <span style={{ fontWeight: 900, color: col, fontVariantNumeric: 'tabular-nums', width: 42, textAlign: 'right', flexShrink: 0 }}>{nd ? 'n/a' : f.pts + '/' + f.max}</span>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: F.sm, color: C.amber, lineHeight: 1.55, marginTop: 8 }}>{s.comment}</div>
        </div>
        {/* ── TRIGGERS ── */}
        {(s.watch.length > 0 || s.sells.length > 0) && (
          <div>
            <SectionHead label="Triggers" color={C.red} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {s.watch.map((w, i) => <span key={'w' + i} style={chip('🚨 ' + w, C.red)}>🚨 {w}</span>)}
              {s.sells.map((w, i) => <span key={'s' + i} style={chip('📤 ' + w, C.amber)}>📤 {w}</span>)}
            </div>
          </div>
        )}
        {/* ── EDITOR ── */}
        <Editor s={s} />
      </div>
    );
  };

  const BAND_ORDER = ['ALL', 'ANCHOR BUY', 'CORE BUY', 'SATELLITE', 'NEEDS DATA', 'WATCHLIST', 'AVOID', 'REJECT'];
  const bandColor = (b: string) => b === 'ANCHOR BUY' ? C.gold : b === 'CORE BUY' ? C.green : b === 'SATELLITE' ? C.cyan : b === 'NEEDS DATA' ? C.violet : b === 'WATCHLIST' ? C.amber : b === 'AVOID' ? C.orange : b === 'REJECT' ? C.red : C.blue;

  const buyNow = useMemo(() => scored.filter((s) => {
    if (!((s.decision === 'ANCHOR BUY' || s.decision === 'CORE BUY') && (s.stage === 'B' || s.stage === 'C' || s.stage === 'D'))) return false;
    // forensic veto reaches the decision board — a ☠ name is never a BUY NOW
    const it = intelByName[ckey(s.name)];
    return !(it && (it.fx.grade === 'AVOID' || it.fx.critical));
  }), [scored, intelByName]);
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
      <style>{'table.cxt { font-variant-numeric: tabular-nums; } '
        + 'table.cxt thead th { background: ' + C.panel2 + '; position: sticky; top: 0; z-index: 2; } '
        + 'table.cxt tbody tr.cxr:hover { background: #15213A; }'}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: C.dim, textDecoration: 'none', fontSize: F.sm }}>← Home</Link>
        <span style={{ fontSize: F.xl, fontWeight: 900, color: C.orange }}>🏗 CAPEX TRACKER <span style={{ fontSize: F.xs, color: C.dim, fontWeight: 700 }}>v5.4</span></span>
        <span style={{ fontSize: F.sm, color: C.body }}>four lenses, one dataset: capex quality × timing · 🚀 multibagger DNA · 🔬 forensics · 🎙 concall → 🧭 one fused verdict</span>
        <span style={{ fontSize: F.xs, color: C.dim }}>{files.length} file{files.length === 1 ? '' : 's'} · {scored.length} companies (saved locally)</span>
      </div>

      <div style={{ display: 'flex', gap: 8, margin: '12px 0', flexWrap: 'wrap', alignItems: 'center' }}>
        <span onClick={() => setTab('board')} style={pill(tab === 'board', C.cyan)}>☰ Scoreboard</span>
        <span onClick={() => setTab('analytics')} style={pill(tab === 'analytics', C.green)}>🎯 Decision Board</span>
        <span onClick={() => setTab('multibagger')} style={pill(tab === 'multibagger', C.violet)}>🚀 Multibagger</span>
        <span onClick={() => setTab('playbook')} style={pill(tab === 'playbook', C.violet)}>📚 Playbook</span>
        <span onClick={() => setTab('forensics')} style={pill(tab === 'forensics', C.red)}>🔬 Forensics</span>
        <span onClick={() => setTab('concall')} style={pill(tab === 'concall', C.gold)}>🎙 Concall</span>
        <span onClick={() => setTab('concallpro')} style={pill(tab === 'concallpro', C.gold)} title="Concall reading mastery">🎓 Concall Pro</span>
        <span onClick={() => setTab('verdict')} style={pill(tab === 'verdict', C.orange)}>🧭 Verdict</span>
        <span onClick={() => setTab('model')} style={pill(tab === 'model', C.blue)}>📐 The Model</span>
        <span style={{ flex: 1 }} />
        <span onClick={() => setAllOpen(o => !o)} style={pill(allOpen, C.amber)} title="Toggle expand all rows across every tab">⇕ {allOpen ? 'Collapse' : 'Expand'} all</span>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf,.pptx,.ppt,.txt" multiple onChange={(e) => onFiles(e.target.files)} style={{ fontSize: F.xs, color: C.dim }} />
        <button onClick={downloadTemplate} style={{ ...pill(false, C.blue), background: C.panel2 }}>⬇ Input template</button>
        {rows.length > 0 && <button onClick={clearAll} style={{ ...pill(false, C.red) }}>Clear all</button>}
      </div>
      {msg && <div style={{ fontSize: F.sm, color: C.teal, marginBottom: 8 }}>{msg}</div>}

      {!scored.length && (
        <div style={{ ...card, textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: F.lg, fontWeight: 800 }}>Upload your capex universe (Screener.in Excel/CSV) — concall PDFs/PPTX can ride in the same pick</div>
          <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.65, marginTop: 8, maxWidth: 780, margin: '8px auto' }}>
            Screener workbooks are mined automatically: quantitative factors, capex telemetry, prior-cycle history, stage classification — with (est) fills for what the statements imply.
            Concall transcripts (.pdf / .pptx / .txt) are parsed in this browser and auto-attached to the matching company; unmatched ones park in the 🎙 Concall tab for one-click assignment.
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
            <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                <TH k="name" label="COMPANY" />
                <TH k="final" label="SCORE" right /><TH k="decision" label="QUALITY" />
                <TH k="stage" label="STAGE" /><TH k="base" label="T1·T2·T3·T4" />
                <th style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}>🚀 MB · 🔬 FX</th>
                <TH k="entryShort" label="ENTRY VERDICT" />
                <TH k="confidence" label="CONF" /><TH k="dbCount" label="⛔" right />
                <TH k="roce" label="ROCE%" right /><TH k="de" label="D/E" right />
                <TH k="netDebtEbitda" label="ND/EBITDA" right /><TH k="util" label="UTIL%" right />
                <TH k="anchor" label="ANCHOR%" right />
              </tr></thead>
              <tbody>
                {visible.map((s) => {
                  const it = intelByName[ckey(s.name)];
                  const lens = it ? (
                    <span style={{ whiteSpace: 'nowrap' }}>
                      <span title={'Multibagger ' + (it.mb.grade === 'NR' ? 'not rated — upload Screener workbook' : it.mb.score + '/100')} style={{ fontSize: 10, fontWeight: 900, padding: '1px 6px', borderRadius: 7, background: it.mb.color + '22', color: it.mb.color, border: '1px solid ' + it.mb.color + '55' }}>{it.mb.grade}</span>{' '}
                      <span title={'Forensic ' + (it.fx.grade === 'NR' ? 'not rated' : it.fx.score + '/100 · ' + it.fx.flags.length + ' flags')} style={{ fontSize: 10, fontWeight: 900, padding: '1px 6px', borderRadius: 7, background: it.fx.color + '22', color: it.fx.color, border: '1px solid ' + it.fx.color + '55' }}>{it.fx.grade === 'NR' ? 'NR' : it.fx.score}</span>
                    </span>
                  ) : null;
                  return <ScoreRow key={s.name} s={s} open={open === s.name || allOpen} toggle={() => setOpen(open === s.name ? null : s.name)} fmt={fmt} Detail={Detail} lens={lens} veto={it ? it.fx.grade === 'AVOID' || it.fx.critical : false} />;
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
            Click any row: T0→T5 timeline, capex-by-year strip, 21-factor bars, telemetry, inline editor. Quality = masterclass score; Stage = where on the utilization arc; the entry verdict is the intersection. Not investment advice.
          </div>
        </>
      )}

      {/* ═══ DECISION BOARD ═══ */}
      {tab === 'analytics' && scored.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
          <div style={{ ...card, border: '1px solid ' + C.gold + '66' }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 4 }}>🎯 BUY NOW — quality ∩ stage · {buyNow.length}</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>ANCHOR/CORE quality AND Stage B/C/D — both models agree. Stage C is the modal winner entry (~55% of 250-case winners).</div>
            {buyNow.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                <span><b>{s.name}</b> <StageChip stage={s.stage} /> <span style={{ color: C.dim }}>{s.industry || s.sector}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision), whiteSpace: 'nowrap' }}>{s.final}{s.confidence === 'LOW' ? ' ⚠' : ''}</span>
              </div>
            ))}
            {!buyNow.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No name clears BOTH filters yet — that is the discipline working.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.blue, marginBottom: 4 }}>⏳ RIGHT QUALITY, WRONG STAGE · {wrongStage.length}</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>Masterclass quality clears but the timing window isn't open — too early (A), too late (E/F) or no cycle. Watch for Stage B/C.</div>
            {wrongStage.map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm, alignItems: 'center' }}>
                <span><b>{s.name}</b> <StageChip stage={s.stage} /> <span style={{ color: C.dim, fontSize: F.xs }}>{s.entryShort}</span></span>
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
              <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>
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
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>3+ deal-breakers ⇒ score capped at 30. Historically 80%+ default within 5-7 years.</div>
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
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>% = score on factors Screener can prove. Open the row, fill anchor/promoter/pledge for the real verdict.</div>
            {scored.filter((s) => s.decision === 'NEEDS DATA').sort((a, b) => b.measuredPct - a.measuredPct).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.dim }}>· {s.gaps} gaps{s.stage ? ' · Stage ' + s.stage : ''}</span></span>
                <span style={{ fontWeight: 900, color: s.measuredPct >= 70 ? C.green : s.measuredPct >= 50 ? C.amber : C.red }}>{s.measuredPct}% measured</span>
              </div>
            ))}
            {!(counts['NEEDS DATA'] || 0) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>All names carry enough evidence for a verdict.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 4 }}>📈 Upgrade watch — what would change the call</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>Watchlist/Satellite names and the exact factors holding them back.</div>
            {upgradeWatch.map(({ s, need }) => (
              <div key={s.name} style={{ padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <b>{s.name}</b> <span style={{ fontWeight: 900, color: C.amber }}>{s.final}</span>
                <span style={{ color: C.body }}> — needs: {need.length ? need.map((f) => f.label).join(' + ') : 'data gaps filled'}</span>
              </div>
            ))}
            {!upgradeWatch.length && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>Nothing on watch.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 4 }}>🔮 2026-2030 theme map (Masterclass Ch.11 Tier-1)</div>
            <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>Your names matched to the highest-probability forward themes.</div>
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

      {/* ═══ 📚 PLAYBOOK ═══ */}
      {tab === 'playbook' && <CapexPlaybook />}

      {/* ═══ 🚀 MULTIBAGGER ═══ */}
      {tab === 'multibagger' && scored.length > 0 && (
        <>
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                {['COMPANY', 'SCORE', 'GRADE', 'TOP DRIVERS', 'WEAKEST', 'MCAP Cr', 'PE', 'PEG'].map((hh, i) => (
                  <th key={hh} style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: i === 1 || i >= 5 ? 'right' : 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}>{hh}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...intel].sort((a, b) => (b.mb.grade === 'NR' ? -1 : b.mb.score) - (a.mb.grade === 'NR' ? -1 : a.mb.score)).map(({ s, fin, mb }) => {
                  const measured = mb.components.filter((cmp) => cmp.pts !== null);
                  const top3 = [...measured].sort((a, b) => (b.pts! / b.w) - (a.pts! / a.w)).slice(0, 3).filter((cmp) => cmp.pts! > 0);
                  const weak = [...measured].sort((a, b) => (a.pts! / a.w) - (b.pts! / b.w))[0];
                  const isOpen = openMB === s.name || allOpen;
                  return (
                    <Fragment key={s.name}>
                      <tr className="cxr" onClick={() => setOpenMB(isOpen ? null : s.name)} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: isOpen ? '#16233B' : undefined }}>
                        <td style={{ padding: '8px 8px', fontWeight: 800 }}>{s.name}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}</div></td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                          <span style={{ fontSize: 16, fontWeight: 900, color: mb.color, background: mb.color + '14', border: '1px solid ' + mb.color + '44', borderRadius: 9, padding: '3px 10px' }}>{mb.grade === 'NR' ? '—' : mb.score}</span>
                        </td>
                        <td style={{ padding: '8px 8px' }}><span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: mb.color + '22', color: mb.color, border: '1px solid ' + mb.color + '55' }}>{mb.grade}</span></td>
                        <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.green }}>{mb.grade === 'NR' ? <span style={{ color: C.dim }}>{fin ? 'insufficient series' : 'upload the Screener workbook to unlock multibagger/forensic scores'}</span> : top3.map((cmp) => cmp.label).join(' · ') || '—'}</td>
                        <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.red }}>{mb.grade !== 'NR' && weak ? weak.label : '—'}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fin && fin.mcap ? Math.round(fin.mcap).toLocaleString() : '—'}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(mb.pe, 1)}</td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', color: mb.peg < 1.2 ? C.green : mb.peg > 2 ? C.red : C.txt }}>{fmt(mb.peg, 2)}</td>
                      </tr>
                      {isOpen && (
                        <tr key={s.name + ':d'}><td colSpan={8} style={{ padding: '0 8px' }}>
                          <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 12, margin: '6px 0 10px', display: 'grid', gap: 8 }}>
                            <MultibaggerStrips fin={fin} name={s.name} mbScore={mb.score} mbGrade={mb.grade} />
                            <div style={{ fontSize: F.xs, fontWeight: 800, color: C.violet }}>
                              12-COMPONENT MULTIBAGGER BREAKDOWN — measured {mb.available}/100 weight → score <b style={{ color: mb.color }}>{mb.grade === 'NR' ? 'NR' : mb.score}</b>
                              {mb.grade === 'NR' && <span style={{ color: C.dim, fontWeight: 400 }}> · below the 40-weight floor — {fin ? 'series too thin' : 'upload the Screener workbook'}</span>}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 6 }}>
                              {mb.components.map((cmp) => {
                                const nd = cmp.pts === null;
                                const pct = nd ? 0 : cmp.pts! / cmp.w;
                                const col = nd ? C.muted : pct >= 0.7 ? C.green : pct > 0 ? C.amber : C.red;
                                return (
                                  <div key={cmp.id} style={{ background: nd ? C.panel : C.bg, border: '1px solid ' + C.line, borderRadius: 7, padding: '4px 8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.xs }}>
                                      <span style={{ color: C.body }}>{cmp.label}{cmp.detail ? ' · ' + cmp.detail : ''}</span>
                                      <span style={{ fontWeight: 900, color: col, whiteSpace: 'nowrap' }}>{nd ? 'n/a' : cmp.pts!.toFixed(1) + '/' + cmp.w}</span>
                                    </div>
                                    <div style={{ height: 3, borderRadius: 2, background: C.line, marginTop: 3, overflow: 'hidden' }}>
                                      <div style={{ width: Math.round(pct * 100) + '%', height: '100%', background: col }} />
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
            Recomputed from the 10-year workbook series (SQGLP-style: growth consistency · ROCE trajectory · operating leverage · self-funded reinvestment · dilution · runway · PEG · promoter). Growth and PEG use blended 3y/5y/10y horizons (v5.2). Absolute bands A+ ≥80 … D &lt;38; grade capped at B+ on forensic FLAGS and at B on pledge &gt;15% / D/E &gt;1.5. Click a row for the component bars.
          </div>
        </>
      )}

      {/* ═══ 🔬 FORENSICS ═══ */}
      {tab === 'forensics' && scored.length > 0 && (
        <>
          <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
            <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
              <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                {['COMPANY', 'SCORE', 'GRADE', '🚩 FLAGS', 'WORST FLAG'].map((hh, i) => (
                  <th key={hh} style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: i === 1 || i === 3 ? 'right' : 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}>{hh}</th>
                ))}
              </tr></thead>
              <tbody>
                {[...intel].sort((a, b) => (b.fx.grade === 'NR' ? -1 : b.fx.score) - (a.fx.grade === 'NR' ? -1 : a.fx.score)).map(({ s, fin, fx }) => {
                  const isOpen = openFX === s.name || allOpen;
                  return (
                    <Fragment key={s.name}>
                      <tr className="cxr" onClick={() => setOpenFX(isOpen ? null : s.name)} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: isOpen ? '#16233B' : undefined }}>
                        <td style={{ padding: '8px 8px', fontWeight: 800 }}>{s.name}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}</div></td>
                        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
                          <span style={{ fontSize: 16, fontWeight: 900, color: fx.color, background: fx.color + '14', border: '1px solid ' + fx.color + '44', borderRadius: 9, padding: '3px 10px' }}>{fx.grade === 'NR' ? '—' : fx.score}</span>
                        </td>
                        <td style={{ padding: '8px 8px' }}>
                          <span style={{ fontSize: F.xs, fontWeight: 900, padding: '2px 10px', borderRadius: 10, background: fx.color + '22', color: fx.color, border: '1px solid ' + fx.color + '55', whiteSpace: 'nowrap' }}>{fx.grade}{fx.critical ? ' ☠' : ''}</span>
                          {fx.grade === 'NR' && <span style={{ fontSize: F.xs, color: C.dim }}> upload the Screener workbook to unlock</span>}
                        </td>
                        <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 900, color: fx.flags.length >= 4 ? C.red : fx.flags.length ? C.amber : C.green }}>{fx.grade === 'NR' ? '—' : fx.flags.length}</td>
                        <td style={{ padding: '8px 8px', fontSize: F.xs, color: C.red }}>{fx.flags[0] || (fx.grade === 'NR' ? '' : '—')}</td>
                      </tr>
                      {isOpen && (
                        <tr key={s.name + ':d'}><td colSpan={5} style={{ padding: '0 8px' }}>
                          <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 12, margin: '6px 0 10px', display: 'grid', gap: 8 }}>
                            <div style={{ fontSize: F.xs, fontWeight: 800, color: C.red }}>
                              12 FORENSIC CHECKS (higher = cleaner) — grade is the WORST of score band vs flag count{fx.critical ? ' · ☠ CRITICAL flag present ⇒ AVOID' : ''}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 6 }}>
                              {fx.checks.map((ch) => {
                                const nd = ch.pts === null;
                                const col = nd ? C.muted : ch.pts === ch.w ? C.green : ch.pts! > 0 ? C.amber : C.red;
                                return (
                                  <div key={ch.id} style={{ background: nd ? C.panel : C.bg, border: '1px solid ' + C.line, borderRadius: 7, padding: '4px 8px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.xs }}>
                                      <span style={{ color: C.body }}><span style={{ color: col }}>●</span> {ch.label} · {ch.detail}</span>
                                      <span style={{ fontWeight: 900, color: col, whiteSpace: 'nowrap' }}>{nd ? 'n/a' : ch.pts + '/' + ch.w}</span>
                                    </div>
                                    {ch.flag && <div style={{ fontSize: F.xs, color: C.red, marginTop: 2 }}>🚩 {ch.flag}</div>}
                                  </div>
                                );
                              })}
                            </div>
                            {fx.workbook.length > 0 && (
                              <div style={{ borderTop: '1px dashed ' + C.line, paddingTop: 6 }}>
                                <div style={{ fontSize: F.xs, fontWeight: 800, color: C.amber }}>FRAUD-CHECKLIST ANSWERS (your workbook) — each adverse −3, cap −15</div>
                                {fx.workbook.map((wkb) => (
                                  <div key={wkb.row} style={{ fontSize: F.xs, color: wkb.answer === 'adverse' ? C.red : C.green }}>
                                    {wkb.answer === 'adverse' ? '⚠' : '✓'} {wkb.label} <span style={{ color: C.dim }}>(row {wkb.row})</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
            The fraud-checklist tab of your workbook, codified: cash conversion · receivable/inventory games · other-income crutch · tax sanity · phantom cash · stuck CWIP · dilution · dividend funding · depreciation games. CLEAN ≥80 · WATCH 60-79 · FLAGS 40-59 · AVOID &lt;40 — but flags override: 1 flag caps at WATCH, 2-3 at FLAGS, ≥4 or any CRITICAL ⇒ AVOID.
          </div>
        </>
      )}

      {/* ═══ 🎙 CONCALL ═══ */}
      {tab === 'concall' && scored.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 12, alignItems: 'start' }}>
          <div style={{ ...card, border: '1px solid ' + C.gold + '55' }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>➕ Add a transcript</div>
            <div style={{ display: 'grid', gap: 8 }}>
              <select value={ccCompany} onChange={(e) => setCcCompany(e.target.value)} style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '6px 8px', fontSize: F.sm }}>
                <option value="">— pick a company —</option>
                {scored.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
              <input placeholder='label, e.g. "Q2 FY26 — 12 Nov 2025"' value={ccLabel} onChange={(e) => setCcLabel(e.target.value)}
                style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '6px 8px', fontSize: F.sm }} />
              <textarea placeholder="paste the management commentary + Q&A here…" value={ccText} onChange={(e) => setCcText(e.target.value)} rows={9}
                style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '6px 8px', fontSize: F.xs, resize: 'vertical', fontFamily: 'inherit' }} />
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => addTranscript(ccCompany, ccLabel, ccText)} style={{ ...pill(true, C.gold), border: '1px solid ' + C.gold }}>💾 Save + extract</button>
                <input ref={ccFileRef} type="file" accept=".txt,.pdf,.pptx,.ppt" style={{ fontSize: F.xs, color: C.dim, maxWidth: 180 }}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) {
                      try {
                        if (/\.ppt$/i.test(f.name)) setMsg('⚠ Legacy binary .ppt cannot be parsed in the browser — export it as PDF (or .pptx) and upload that.');
                        else setCcText(capTranscript((/\.pdf$/i.test(f.name) ? await extractPdfText(await f.arrayBuffer()) : /\.pptx$/i.test(f.name) ? await extractPptxText(await f.arrayBuffer()) : await f.text()).trim()));
                      } catch (err: any) { setMsg('Failed to read ' + f.name + ': ' + (err?.message || err)); }
                    }
                    if (ccFileRef.current) ccFileRef.current.value = '';
                  }} />
              </div>
              <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.6 }}>
                .pdf / .pptx / .txt or paste (legacy .ppt → export as PDF first) · max 300k chars · 8 transcripts per company · stored ONLY in this browser (separate from company data — survives "Clear all").
                Extraction is sentence-scoped and heuristic: utilization %, order book (Cr), capex guidance, commissioning timeline, anchor/booked %, tone. Tip: drop PDFs straight on the main upload — they auto-attach by company name.
              </div>
              {Object.keys(concalls).length > 0 && <button onClick={clearTranscripts} style={{ ...pill(false, C.red), justifySelf: 'start' }}>Clear transcripts</button>}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {(concalls[KU] ?? []).length > 0 && (
              <div style={{ ...card, border: '1px solid ' + C.amber + '88' }}>
                <div style={{ fontSize: F.md, fontWeight: 800, color: C.amber, marginBottom: 4 }}>📎 UNASSIGNED uploads · {(concalls[KU] ?? []).length}</div>
                <div style={{ fontSize: F.sm, color: C.body, marginBottom: 6, lineHeight: 1.55 }}>These files matched zero (or several) stored companies. Pick the company and Assign — extraction is already done and applies instantly.</div>
                {(concalls[KU] ?? []).map((en) => (
                  <div key={en.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', borderTop: '1px solid ' + C.line, padding: '6px 0' }}>
                    <b style={{ fontSize: F.sm }}>{en.label}</b>
                    <span style={{ fontSize: F.xs, color: C.dim }}>{new Date(en.addedAt).toLocaleDateString()} · {(en.chars / 1000).toFixed(1)}k chars</span>
                    <span style={{ fontSize: F.xs, color: C.dim }}>
                      {en.extract.utilization !== null && <>util <b style={{ color: C.gold }}>{en.extract.utilization}%</b> · </>}
                      {en.extract.orderBook !== null && <>order book <b style={{ color: C.gold }}>{en.extract.orderBook.toLocaleString()} Cr</b></>}
                    </span>
                    <span style={{ flex: 1 }} />
                    <select value={assignSel[en.id] ?? ''} onChange={(e) => setAssignSel({ ...assignSel, [en.id]: e.target.value })}
                      style={{ background: C.bg, border: '1px solid ' + C.line, color: C.txt, borderRadius: 6, padding: '4px 6px', fontSize: F.xs, maxWidth: 220 }}>
                      <option value="">— pick company —</option>
                      {scored.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                    <button onClick={() => assignUnassigned(en.id, assignSel[en.id] ?? '')} style={{ ...pill(true, C.amber), border: '1px solid ' + C.amber }}>Assign</button>
                    <button onClick={() => deleteTranscript(KU, en.id)} style={{ ...pill(false, C.red), padding: '2px 8px' }}>✕</button>
                  </div>
                ))}
              </div>
            )}
            {intel.filter(({ s }) => (concalls[ckey(s.name)] ?? []).length > 0).map(({ s, cc }) => (
              <div key={s.name} style={card}>
                <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: F.md, fontWeight: 800 }}>{s.name}</span>
                  <span style={{ fontSize: F.xs, fontWeight: 800, color: cc.freshness === 'FRESH' ? C.green : cc.freshness === 'STALE' ? C.amber : C.muted }}>
                    {cc.freshness === 'FRESH' ? '🟢 FRESH' : cc.freshness === 'STALE' ? '🟡 STALE' : '⚪ OLD'}
                  </span>
                  {cc.tone !== null && <span style={{ fontSize: F.xs, color: cc.tone >= 0.65 ? C.green : cc.tone < 0.4 ? C.red : C.amber }}>tone {(cc.tone * 100).toFixed(0)}% positive</span>}
                </div>
                <ConcallChips s={s} />
                {(concalls[ckey(s.name)] ?? []).map((en) => {
                  const isOpen = ccView === en.id;
                  const ex = en.extract;
                  return (
                    <div key={en.id} style={{ borderTop: '1px solid ' + C.line, padding: '6px 0' }}>
                      <div onClick={() => setCcView(isOpen ? null : en.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer', flexWrap: 'wrap' }}>
                        <b style={{ fontSize: F.sm }}>{en.label}</b>
                        <span style={{ fontSize: F.xs, color: C.dim }}>{new Date(en.addedAt).toLocaleDateString()} · {(en.chars / 1000).toFixed(1)}k chars</span>
                        {ex.tone !== null && (
                          <span style={{ width: 70, height: 5, borderRadius: 3, background: C.red + '55', overflow: 'hidden', display: 'inline-block' }} title={ex.optimism + ' positive / ' + ex.caution + ' cautious sentences'}>
                            <span style={{ display: 'block', width: (ex.tone * 100) + '%', height: '100%', background: C.green }} />
                          </span>
                        )}
                        {ex.anchorPct !== null && <span style={{ fontSize: F.xs, color: C.dim }}>booked <b style={{ color: C.gold }}>{ex.anchorPct}%</b></span>}
                        <span style={{ fontSize: F.xs, fontWeight: 700, color: C.dim }}>{isOpen ? '▲ close transcript' : '▼ read transcript'}</span>
                        <span style={{ flex: 1 }} />
                        <button onClick={(e) => { e.stopPropagation(); deleteTranscript(ckey(s.name), en.id); }} style={{ ...pill(false, C.red), padding: '2px 8px' }}>✕</button>
                      </div>
                      <HandbookChip text={en.text} />
                      <SignalCards ex={ex} />
                      {ex.timeline.length > 1 && (
                        <div style={{ fontSize: F.xs, color: C.teal, lineHeight: 1.6, marginTop: 2 }}>
                          {ex.timeline.slice(1).map((tl, ti) => <div key={ti}>📅 <i style={{ color: C.body }}>“{tl}”</i></div>)}
                        </div>
                      )}
                      {isOpen && (
                        <pre style={{ maxHeight: 420, overflowY: 'auto', fontSize: F.sm, lineHeight: 1.6, whiteSpace: 'pre-wrap', background: C.bg, border: '1px solid ' + C.line, borderRadius: 8, padding: 12, marginTop: 6, color: C.body, fontFamily: 'inherit' }}>
                          {markText(en.text, ex.quotes)}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {!intel.some(({ s }) => (concalls[ckey(s.name)] ?? []).length > 0) && !(concalls[KU] ?? []).length && (
              <div style={{ ...card, textAlign: 'center', padding: 30, color: C.body, fontSize: F.sm, lineHeight: 1.65 }}>
                No transcripts yet. Upload the concall PDF/PPTX on the main file picker (it auto-attaches by company name) or paste it on the left — the page extracts utilization, order book, capex guidance and tone, and suggests one-click updates to the capex engine (provenance preserved as "(concall)").
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ 🧭 VERDICT ═══ */}
      {tab === 'concallpro' && <ConcallPro C={C} />}
      {tab === 'verdict' && scored.length > 0 && (() => {
        const ranked = [...intel].sort((a, b) => (a.verdict.veto === b.verdict.veto ? b.verdict.composite - a.verdict.composite : a.verdict.veto ? 1 : -1));
        const vCounts: Record<string, number> = {};
        ranked.forEach(({ verdict }) => { vCounts[verdict.call] = (vCounts[verdict.call] || 0) + 1; });
        const top5 = ranked.filter(({ verdict }) => !verdict.veto && verdict.call !== '🧩 NEEDS DATA' && verdict.call !== '🔍 FORENSIC REVIEW FIRST').slice(0, 5);
        return (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr minmax(300px, 380px)', gap: 12, marginBottom: 12, alignItems: 'stretch' }}>
              <div style={card}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.4, color: C.orange, textTransform: 'uppercase' as const, marginBottom: 8 }}>Call distribution</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignContent: 'flex-start' }}>
                  {Object.entries(vCounts).map(([call, n]) => (
                    <span key={call} style={{ fontSize: F.xs, padding: '4px 10px', borderRadius: 14, fontWeight: 800, background: (VERDICT_COLOR[call] || C.dim) + '1A', border: '1px solid ' + (VERDICT_COLOR[call] || C.dim) + '66', color: VERDICT_COLOR[call] || C.dim }}>
                      {call} · {n}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: F.sm, color: C.body, lineHeight: 1.6, marginTop: 10 }}>
                  One fused call per name: capex quality × timing, multibagger DNA and forensics, with the forensic veto on top. Composite ranks the table; the WHY column is the action line.
                </div>
              </div>
              <div style={{ ...card, border: '1px solid ' + C.gold + '66' }}>
                <div style={{ fontSize: F.sm, fontWeight: 800, color: C.gold, marginBottom: 4 }}>🏆 TOP 5 — highest composite, no vetoes</div>
                {top5.map(({ s, verdict }, i) => (
                  <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.sm, padding: '3px 0', borderTop: i ? '1px solid ' + C.line : 'none' }}>
                    <span><b style={{ color: C.muted }}>{i + 1}.</b> <b>{s.name}</b> <span style={{ fontSize: F.xs, color: verdict.color }}>{verdict.call}</span></span>
                    <b style={{ color: C.gold }}>{verdict.composite.toFixed(0)}</b>
                  </div>
                ))}
                {!top5.length && <div style={{ fontSize: F.xs, color: C.dim }}>Nothing clears the vetoes yet.</div>}
              </div>
            </div>
            <div style={{ ...card, padding: 0, overflowX: 'auto' }}>
              <table className="cxt" style={{ borderCollapse: 'collapse', width: '100%', fontSize: F.sm }}>
                <thead><tr style={{ borderBottom: '1px solid ' + C.line }}>
                  {['COMPANY', 'COMPOSITE', 'CAPEX', 'STAGE / ENTRY', '🚀 MB', '🔬 FORENSIC', '🎙 CONCALL', 'VERDICT', 'WHY / ACTION'].map((hh, i) => (
                    <th key={hh} style={{ padding: '7px 8px', whiteSpace: 'nowrap', textAlign: i === 1 ? 'right' : 'left', color: C.dim, fontSize: F.xs, fontWeight: 800 }}>{hh}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {ranked.map(({ s, mb, fx, cc, verdict }) => (
                    <tr className="cxr" key={s.name} style={{ borderBottom: '1px solid ' + C.line, opacity: verdict.veto ? 0.75 : 1 }}>
                      <td style={{ padding: '8px 8px', fontWeight: 800 }}>{s.name}<div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}</div></td>
                      <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 900, fontSize: 19, fontVariantNumeric: 'tabular-nums', color: verdict.veto ? C.muted : C.txt }}>{verdict.composite.toFixed(0)}</td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55' }}>{s.decision} {s.final}</span>
                      </td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}><StageChip stage={s.stage} /> <span style={{ fontSize: 10, color: s.entryColor, fontWeight: 700 }}>{s.entryShort}</span></td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: mb.color + '22', color: mb.color, border: '1px solid ' + mb.color + '55' }}>{mb.grade === 'NR' ? 'NR' : mb.score + ' ' + mb.grade}</span>
                      </td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: fx.color + '22', color: fx.color, border: '1px solid ' + fx.color + '55' }}>{fx.grade === 'NR' ? 'NR' : fx.score + ' ' + fx.grade}</span>
                        {fx.flags.length > 0 && <span style={{ fontSize: 10, color: C.red }}> {fx.flags.length}🚩</span>}
                      </td>
                      <td style={{ padding: '8px 8px', fontSize: F.xs, whiteSpace: 'nowrap', color: cc.freshness === 'FRESH' ? C.green : cc.freshness === 'STALE' ? C.amber : C.muted }}>
                        {cc.freshness === 'NONE' && !cc.latest ? '—' : (cc.freshness === 'FRESH' ? '🟢' : cc.freshness === 'STALE' ? '🟡' : '⚪') + (cc.tone !== null ? ' ' + (cc.tone! * 100).toFixed(0) + '%+' : '')}
                      </td>
                      <td style={{ padding: '8px 8px', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: F.xs, fontWeight: 900, padding: '3px 10px', borderRadius: 10, background: verdict.color + '1E', color: verdict.color, border: '1px solid ' + verdict.color + '66' }}>{verdict.call}</span>
                      </td>
                      <td style={{ padding: '8px 8px', fontSize: F.sm, color: C.body, lineHeight: 1.55, minWidth: 300 }}>{verdict.why} <span style={{ color: C.body }}>{verdict.note}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: F.sm, color: C.body, marginTop: 8, lineHeight: 1.6 }}>
              Composite = 0.40×capex + 0.35×multibagger + 0.25×forensic (renormalized when a lens is NR) − 15 on forensic FLAGS; forensic AVOID/critical vetoes everything and pins to the bottom. Fresh cautious concalls demote one rung; fresh bullish calls with util ≥75% get the 🔥 tag. Not investment advice.
            </div>
          </>
        );
      })()}

      {/* ═══ MODEL ═══ */}
      {tab === 'model' && <ModelTab card={card} />}
    </div>
  );
}

// 🎙 uniform signal cards — one per extraction channel; value big, source
// sentence quoted in italic body text; channels with no finding stay visible
// as a dim "not mentioned" so the reader knows the extractor looked.
function HandbookChip({ text }: { text: string }) {
  const [r, setR] = useState<any>(null);
  useEffect(() => {
    let cancel = false;
    try {
      const result = classifyTranscriptV2(text);
      if (!cancel) setR(result);
    } catch (e) { /* ignore */ }
    return () => { cancel = true; };
  }, [text]);
  if (!r) return null;
  const bandColors: Record<string, string> = {
    'ANCHOR BUY': '#00E68A', 'CORE BUY': '#22D3EE', 'SATELLITE': '#A78BFA',
    'WATCHLIST': '#FFB347', 'AVOID': '#FF4D6A', 'REJECT': '#FF4D6A',
  };
  const col = bandColors[r.band] || '#AEBBD0';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '4px 0', padding: '4px 0', borderTop: '1px dashed #2A3654', borderBottom: '1px dashed #2A3654', fontSize: 11 }}>
      <span style={{ fontWeight: 800, color: '#FFD700' }}>📘 Handbook</span>
      <span style={{ fontWeight: 900, color: col, padding: '2px 8px', borderRadius: 8, background: col + '1A', border: '1px solid ' + col + '55' }}>{r.scorecardTotal}/100 {r.band}</span>
      {r.sectorGuess && <span style={{ color: '#AEBBD0' }}>sector: <b style={{ color: '#22D3EE' }}>{r.sectorGuess}</b> <span style={{ color: '#8B98AC' }}>({String(r.sectorConfidence).toLowerCase()})</span></span>}
      <span style={{ color: '#00E68A' }}>+{r.toneScore.positive}</span>
      <span style={{ color: '#FFB347' }}>⚠{r.toneScore.cautious}</span>
      <span style={{ color: '#FF4D6A' }}>🚩{r.toneScore.redFlag}</span>
      <span style={{ color: '#8B98AC' }}>{r.totalSentences} sent</span>
    </div>
  );
}

function SignalCards({ ex }: { ex: ConcallExtract }) {
  const qFor = (f: string) => ex.quotes.find((q) => q.field === f)?.snippet || '';
  const clip = (s: string) => (s.length > 190 ? s.slice(0, 187) + '…' : s);
  const cards: { icon: string; label: string; value: string | null; quote: string; plain?: boolean }[] = [
    { icon: '🏭', label: 'UTILIZATION', value: ex.utilization !== null ? ex.utilization + '%' : null, quote: qFor('utilization') },
    { icon: '📦', label: 'ORDER BOOK', value: ex.orderBook !== null ? ex.orderBook.toLocaleString() + ' Cr' : null, quote: qFor('orderBook') },
    { icon: '💰', label: 'CAPEX GUIDANCE', value: ex.capexGuidance !== null ? ex.capexGuidance.toLocaleString() + ' Cr' : null, quote: qFor('capexGuidance') },
    { icon: '📅', label: 'TIMELINE', value: ex.timeline.length ? ex.timeline.length + ' dated commitment' + (ex.timeline.length > 1 ? 's' : '') : null, quote: ex.timeline[0] || '' },
    { icon: '📈', label: 'GROWTH', value: ex.growthNote ? ((ex.growthNote.match(/\d+(?:\.\d+)?\s*%/) || ['noted'])[0]) : null, quote: ex.growthNote || '' },
    { icon: '📊', label: 'MARGINS', value: ex.marginNote ? ((ex.marginNote.match(/\d+(?:\.\d+)?\s*(?:%|bps|basis points)/i) || ['noted'])[0]) : null, quote: ex.marginNote || '' },
    { icon: '🛒', label: 'DEMAND', value: ex.demandNote ? 'noted' : null, quote: ex.demandNote || '' },
    { icon: '🎭', label: 'TONE', value: ex.tone !== null ? Math.round(ex.tone * 100) + '% positive' : null, quote: ex.tone !== null ? ex.optimism + ' positive · ' + ex.caution + ' cautious phrases' : '', plain: true },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, margin: '8px 0 4px' }}>
      {cards.map((cd) => (
        <div key={cd.label} style={{ background: C.bg, border: '1px solid ' + (cd.value ? C.gold + '40' : C.line), borderRadius: 8, padding: '9px 11px', display: 'grid', gap: 5, alignContent: 'start' }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.1, color: cd.value ? C.gold : C.dim }}>{cd.icon} {cd.label}</div>
          {cd.value ? (
            <>
              <div style={{ fontSize: 17, fontWeight: 900, color: C.txt, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>{cd.value}</div>
              {cd.quote && (
                <div style={{ fontSize: F.xs, fontStyle: 'italic', color: C.body, lineHeight: 1.55 }}>
                  {cd.plain ? cd.quote : '“' + clip(cd.quote) + '”'}
                </div>
              )}
            </>
          ) : (
            <div style={{ fontSize: F.xs, color: C.muted, fontStyle: 'italic' }}>not mentioned</div>
          )}
        </div>
      ))}
    </div>
  );
}

// highlight extracted numbers inside the transcript viewer
function markText(text: string, quotes: { field: string; match: string; snippet: string }[]): any {
  const marks = Array.from(new Set(quotes.map((q) => q.match))).filter(Boolean).sort((a, b) => b.length - a.length).slice(0, 30);
  if (!marks.length) return text;
  try {
    const re = new RegExp(marks.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')).join('|'), 'g');
    const parts: any[] = [];
    let lastI = 0; let m: RegExpExecArray | null; let k = 0;
    while ((m = re.exec(text)) && k < 200) {
      parts.push(text.slice(lastI, m.index));
      parts.push(<mark key={'m' + k++} style={{ background: C.gold + '33', color: C.txt, borderRadius: 3 }}>{m[0]}</mark>);
      lastI = m.index + m[0].length;
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    parts.push(text.slice(lastI));
    return parts;
  } catch { return text; }
}

// scoreboard row + expandable detail
function ScoreRow({ s, open, toggle, fmt, Detail, lens, veto }: { s: Scored; open: boolean; toggle: () => void; fmt: (n: number, d?: number) => string; Detail: (p: { s: Scored }) => any; lens?: any; veto?: boolean }) {
  return (
    <>
      <tr className="cxr" onClick={toggle} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: open ? '#16233B' : undefined }}>
        <td style={{ padding: '8px 8px', fontWeight: 800 }}>
          {s.name} <span style={{ fontSize: 10, color: C.muted }}>{s.country === 'US' ? '🇺🇸' : '🇮🇳'}</span>
          <div style={{ fontSize: 10.5, color: C.dim, fontWeight: 400 }}>{s.industry || s.sector}{s.theme ? ' · ' + s.theme : ''}</div>
        </td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>
          <span style={{ fontSize: 16, fontWeight: 900, color: s.decisionColor, background: s.decisionColor + '14', border: '1px solid ' + s.decisionColor + '44', borderRadius: 9, padding: '3px 10px' }}>{s.final}</span>
        </td>
        <td style={{ padding: '8px 8px' }}><span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55', whiteSpace: 'nowrap' }}>{s.decision}</span></td>
        <td style={{ padding: '8px 8px' }}><StageChip stage={s.stage} />{s.watch.length > 0 && <span title={s.watch.join(' | ')}> 🚨</span>}{s.sells.length > 0 && <span title={s.sells.join(' | ')}> 📤</span>}</td>
        <td style={{ padding: '8px 8px' }}><TierBars s={s} /></td>
        <td style={{ padding: '8px 8px' }}>{lens ?? <span style={{ color: C.muted, fontSize: F.xs }}>—</span>}</td>
        <td style={{ padding: '8px 8px', fontSize: F.xs, fontWeight: 800, color: veto ? C.red : s.entryColor, whiteSpace: 'nowrap' }} title={veto ? 'Forensic AVOID/critical — entry blocked regardless of capex quality' : undefined}>{veto ? '☠ FORENSIC VETO' : s.entryShort}</td>
        <td style={{ padding: '8px 8px', fontSize: F.xs, color: s.confidence === 'HIGH' ? C.green : s.confidence === 'MEDIUM' ? C.amber : C.red }}>{s.confidence}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 900, color: s.dbCount >= 3 ? C.red : s.dbCount ? C.amber : C.muted }}>{s.dbCount || '—'}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.roce)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.de, 2)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right', color: s.netDebtEbitda > 2 ? C.red : s.netDebtEbitda < 0 ? C.green : C.txt }}>{s.netDebtEbitda < 0 ? 'net cash' : fmt(s.netDebtEbitda, 2)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.util, 0)}</td>
        <td style={{ padding: '8px 8px', textAlign: 'right' }}>{fmt(s.anchor, 0)}</td>
      </tr>
      {open && <tr><td colSpan={14} style={{ padding: '0 8px' }}><Detail s={s} /></td></tr>}
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
          <span style={{ color: C.body }}>× industry multiplier: Defence 1.10 · SpecChem 1.08 · CDMO 1.06 · Consumer 1.05 · Cement/PEB 1.03 · Renewables 1.02 · Semis/EMS 1.00 · Banks 0.95 · RE 0.85 · Telecom 0.75 · Airlines 0.70 · Merchant power/Steel 0.65</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>2 · DEAL BREAKERS (any 3 ⇒ score capped at 30)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          DB1 D/E &gt;1.5x · DB2 OCF negative/below maintenance · DB3 pledge &gt;30% / material RPT · DB4 debt-funding &gt;70% · DB5 anchor &lt;25% of new capacity · DB6 ROCE below cost of debt.<br />
          <span style={{ color: C.body }}>In 38 of 40 India failures, ≥4 of 8 red flags were visible in audited financials TWO YEARS before the announcement. The information was never the problem — discipline was.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>3 · QUALITY BANDS (Ch.12.4) + confidence (§12.5)</div>
        <div style={{ fontSize: F.sm, lineHeight: 1.9 }}>
          <span style={{ color: C.gold }}>85-100 ANCHOR BUY</span> · 4-6% · 88% hit rate<br />
          <span style={{ color: C.green }}>70-84 CORE BUY</span> · 3-4% · 72%<br />
          <span style={{ color: C.cyan }}>55-69 SATELLITE</span> · 1.5-2.5% · 55% · Q1 confirmation first<br />
          <span style={{ color: C.amber }}>40-54 WATCHLIST</span> · <span style={{ color: C.orange }}>25-39 AVOID</span> · <span style={{ color: C.red }}>0-24 REJECT</span><br />
          <span style={{ color: C.body }}>Score = measured points ÷ measured weight × 100 (v5.4) — unmeasurable factors reduce confidence instead of silently zeroing the score. LOW confidence ⇒ halve the position. Any (est)-filled factor caps confidence at MEDIUM. ≥10 unmeasured factors ⇒ NEEDS DATA, not a fake AVOID.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 6 }}>4 · TIMING — the T0→T5 arc (Framework, ~250 cases)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          T0 announce → <b>12-24m</b> → T1 commission → <b>6-12m</b> → T2 util rises → <b>6-12m</b> → T3 GAAP earnings inflect → <b>6-12m</b> → T4 street recognition → <b>12-24m</b> → T5 peak (new mega-capex announced).<br />
          <span style={{ color: C.body }}>The institutional alpha window is the 6-18 months BEFORE T3 — execution visible, inflection not yet printed. Entries after T4 are systematically penalized.</span>
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
                <span style={{ color: C.txt }}><b style={{ color: m.color }}>{m.label}</b> · size {m.size} <span style={{ color: C.body }}>— {m.note}</span></span>
              </div>
            );
          })}
          <div style={{ color: C.body, marginTop: 4 }}>Optimal-entry distribution across winners: C ≈55% · B ≈20% · D ≈20% · A only for proven executors · F net-negative.</div>
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
          <span style={{ color: C.body }}>Asymmetries: brownfield 72% vs greenfield 51% · internal-funded 76% vs debt-funded 41% · &gt;85% util 74% vs &lt;70% 43% · domestic 68% vs cross-border M&A 37%.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 6 }}>10 · How this page computes it</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Screener workbooks → quantitative factors + telemetry (phase, capex/sales, CWIP ratio, spend accel, ΔD/E, OCF self-funding, Net Debt/EBITDA, cycle-capex/pre-revenue, prior-cycle delivery, utilization proxies — all marked (est) where inferred).<br />
          Stage = commissioning telemetry × effective utilization × inflection status. <b>Entry verdict = quality band ∩ stage</b>, with the Stage-F never-chase override and the proven-executor exception for Stage A. Manual inline edits always overwrite estimates and rescore instantly.
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: '#A78BFA', marginBottom: 6 }}>11 · 🚀 MULTIBAGGER SCORE — 12 components, 100 pts (v5)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Recomputed from the 10y workbook series (SQGLP checklist + multibagger-checklist thresholds): earnings consistency 10 (PAT YoY &gt;15% in 7+ yrs) · <b>sales CAGR + acceleration 10 — blended horizons: g = max(cagr3, 0.8×cagr5, 0.7×cagr10), full at ≥25% scaling to 0 at ≤5%; +2 bonus when cagr3&gt;cagr5&gt;cagr10; a 3y print &gt;8pp below the 5y caps the component at 60% (one soft year cannot zero a long-horizon grower)</b> · ROCE level+trajectory 10 (avg3 ≥25, rising vs 10y) · margin/op-leverage 8 · self-funded reinvestment 8 (capex/OCF 0.4-1.2x) · dilution 6 (≤+5% 10y) · debt trajectory 6 (D/E ≤0.3 and falling) · FCF years 6 · CFO→PAT 5 (cum ≥0.8) · size runway 8 (500-5,000 Cr sweet spot) · <b>PEG/PE 8 — PEG uses the blended PAT growth (max of 3y, 0.8×5y, 0.7×10y; sales-blend fallback); PEG &lt;1 full, PE 18-40 entry band; growth &lt;5% ⇒ PEG shown n/m and only the PE band (weight 3) is scored</b> · promoter≥55%/pledge≤5%/moat 7.<br />
          <span style={{ color: C.body }}>Score = pts ÷ measured weight × 100 (NR below 40 weight). Absolute bands: A+ ≥80 · A 70 · B+ 60 · B 50 · C 38 · D. Consistency gates: forensic FLAGS caps at B+; pledge &gt;15% or D/E &gt;1.5 caps at B.</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>12 · 🔬 FORENSIC SCORE — 12 checks, higher = cleaner (v5)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          Cum CFO/PAT 14 (≥0.9 clean; &lt;0.5 CRITICAL) · CFO/EBITDA 8 · receivable-days trend 10 (channel stuffing) · inventory days 6 · other-income/PBT 8 (&gt;25% = crutch) · tax rate 8 (chronic &lt;15% = suspect) · cash↑+debt↑ 8 (phantom cash) · perpetual CWIP 8 (&gt;20% of NB 3y+) · dilution 5y 8 (&gt;40% CRITICAL) · dividend vs OCF 8 · CFO-positive years 8 · depreciation-rate volatility 6. Workbook fraud-checklist answers overlay −3 each (cap −15).<br />
          <span style={{ color: C.body }}>Grade = WORST of score band (CLEAN ≥80 · WATCH 60 · FLAGS 40 · AVOID) vs flag count (1 flag ≤WATCH · 2-3 ≤FLAGS · ≥4 or CRITICAL ⇒ AVOID).</span>
        </div>
      </div>
      <div style={card}>
        <div style={{ fontSize: F.md, fontWeight: 800, color: C.orange, marginBottom: 6 }}>13 · 🧭 VERDICT — the fusion matrix (v5)</div>
        <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
          First match wins: ① forensic AVOID/critical ⇒ <b style={{ color: C.red }}>☠ DO NOT TOUCH</b> (vetoes everything) · ② no data ⇒ 🧩 NEEDS DATA · ③ forensic FLAGS ⇒ 🔍 REVIEW FIRST · ④ MB ≥70 ∩ buy window ⇒ <b style={{ color: C.gold }}>🎯 PRIME</b> · ⑤ MB ≥70 ∩ capex-buy band, window shut ⇒ ⏳ PRIME SETUP · ⑥ MB ≥70, capex not ripe ⇒ 🌱 COMPOUNDER · ⑦ MB 50-69 ∩ window ⇒ 🏗 CAPEX PLAY (half size) · ⑧ MB &lt;50 ∩ window ⇒ ⚙ CYCLE ONLY · ⑨ MB ≥70 + CLEAN, no cycle ⇒ 💎 QUALITY HOLD · ⑩ capex AVOID/REJECT + MB &lt;50 ⇒ 🗑 DROP · ⑪ else 👀 MONITOR.<br />
          <span style={{ color: C.body }}>Composite rank = 0.40 capex + 0.35 MB + 0.25 forensic (renormalized; −15 on FLAGS). Concall modifiers: fresh cautious call demotes one rung; fresh bullish + util ≥75% tags 🔥 ramp confirmed.</span>
        </div>
      </div>
    </div>
  );
}




