// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { TELEMETRY_COLS, HEADERS, IND_MULT, C, STAGE_META, THEMES, MB_GRADE_ORDER, MB_GRADE_COLOR } from './constants';
import { type Row, type Scored, type Factor, type Fin, type MBResult, type MBComp } from './types';

// non-'(est)' columns win the header race; est columns only match as fallback
export function resolveHeaders(cols: string[]): Record<string, string> {
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
export const num = (v: string | undefined): number => {
  if (v === undefined || v === null) return NaN;
  const n = parseFloat(String(v).replace(/[%,₹$ ]|cr/gi, ''));
  return isFinite(n) ? n : NaN;
};
export const yes = (v: string | undefined): boolean | null => {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(s)) return true;
  if (['n', 'no', 'false', '0'].includes(s)) return false;
  return null;
};
// ── THE SCORING ENGINE — quality (Ch.12) + timing (Stage A-F) ───────────────
export function scoreRow(r: Row, h: Record<string, string>, extras?: Record<string, any>): Scored {
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
export function parseFin(r: Row): Fin | null {
  try {
    const f = JSON.parse(r['Fin Series'] || '');
    if (f && Array.isArray(f.years) && Array.isArray(f.sales)) return f as Fin;
    return null;
  } catch { return null; }
}
// null-safe series helpers (v4.3 conventions)
export const lastNN = (a: (number | null)[]): number => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null && a[i] !== undefined) return i; return -1; };
export const firstNN = (a: (number | null)[]): number => { for (let i = 0; i < a.length; i++) if (a[i] !== null && a[i] !== undefined) return i; return -1; };
export const av = (a: (number | null)[] | undefined, i: number): number => (a && i >= 0 && i < a.length && a[i] !== null && a[i] !== undefined ? (a[i] as number) : NaN);
export const lin01 = (x: number, lo: number, hi: number) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
export const cagrPct = (a: number, b: number, n: number): number => (isFinite(a) && isFinite(b) && a > 0 && b > 0 && n > 0 ? (Math.pow(a / b, 1 / n) - 1) * 100 : NaN);
export const sumLast = (a: (number | null)[], k: number, end?: number): number => {
  const e = end ?? lastNN(a); let s = 0; let any = false;
  for (let i = Math.max(0, e - k + 1); i <= e; i++) { const v = av(a, i); if (isFinite(v)) { s += v; any = true; } }
  return any ? s : NaN;
};
// ── 🚀 MULTIBAGGER — 12 components, weights sum 100 ─────────────────────────
export function computeMultibagger(fin: Fin | null, s: Scored, r: Row, fxGrade: string): MBResult {
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
