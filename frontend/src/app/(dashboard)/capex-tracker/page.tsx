'use client';

// ════════════════════════════════════════════════════════════════════════════
// CAPEX TRACKER — scoring engine built from "The CAPEX Masterclass"
// (200 cases · India + USA · 2005-2025). Implements Chapter 12 verbatim:
// 21 weighted factors (100 pts) → industry multiplier (Ch.8) → deal-breaker
// override (3+ of 6 ⇒ score capped at 30) → decision bands with position
// sizing + historical hit rates. Confidence per §12.5 (LOW ⇒ halve position).
// Data: upload Screener/Excel/CSV per Appendix B columns; rows merge by
// company and PERSIST in localStorage — nothing is cleared unless the user
// explicitly presses Clear all.
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

// ── theme (matches the cockpit dark palette) ────────────────────────────────
const C = {
  bg: '#0B1220', panel: '#101A2C', panel2: '#0D1623', line: '#1A2540',
  txt: '#E6EDF7', dim: '#8B98AC', muted: '#5B6A82',
  green: '#00E68A', red: '#FF4D6A', amber: '#FFB347', blue: '#4DA6FF',
  cyan: '#22D3EE', violet: '#A78BFA', gold: '#FFD700', teal: '#2DD4BF', orange: '#F0883E',
};
const F = { xs: 11, sm: 12.5, md: 14, lg: 17, xl: 24 };

// ── data model ──────────────────────────────────────────────────────────────
type Row = Record<string, string>;
type Scored = {
  name: string; sector: string; industry: string; country: 'IN' | 'US';
  base: number; final: number; decision: string; decisionColor: string;
  dbCount: number; dbList: string[]; mult: number; confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  position: string; gaps: number; factors: { id: number; label: string; pts: number; max: number; note: string }[];
  comment: string; action: string; theme: string | null;
  roce: number; de: number; util: number; anchor: number; debtFund: number; ocfYears: number;
  ebitda: number; pledge: number; raw: Row;
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
  ['ocf', /ocf/i],
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
  ['ebitda', /ebitda/i],
  ['revCagr', /cagr/i],
  ['brownfield', /brownfield|green.?field/i],
  ['cycle', /cycle/i],
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

function resolveHeaders(cols: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const col of cols) {
    const c = col.trim();
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

// ── industry multiplier (Ch.12.2) ───────────────────────────────────────────
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

// ── 2026-2030 theme tagger (Ch.11 Tier-1) ───────────────────────────────────
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

// ── THE SCORING ENGINE (Ch.12 verbatim) ─────────────────────────────────────
function scoreRow(r: Row, h: Record<string, string>): Scored {
  const g = (k: string) => r[h[k]];
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
  // OCF: accept years (number) or Y/N (Y ⇒ treat as 3-5yr streak)
  const ocfRaw = g('ocf');
  let ocfYears = num(ocfRaw);
  if (isNaN(ocfYears)) { const b = yes(ocfRaw); ocfYears = b === true ? 4 : b === false ? -1 : NaN; }
  let internal = num(g('internalPct'));
  let debtPct = num(g('debtPct'));
  if (isNaN(internal) && !isNaN(debtPct)) internal = 100 - debtPct;
  if (isNaN(debtPct) && !isNaN(internal)) debtPct = 100 - internal;
  const util = num(g('util'));
  const pledge = num(g('pledge'));
  const ebitda = num(g('ebitda'));
  const capex = num(g('capex')); const gb = num(g('grossBlock'));
  const capexPct = capex > 0 && gb > 0 ? (capex / gb) * 100 : NaN;
  const overrunRaw = (g('overrun') || '').toLowerCase();
  const cycleRaw = (g('cycle') || '').trim().toUpperCase();
  const wcRaw = (g('wc') || '').toLowerCase();
  const brownRaw = (g('brownfield') || '').toLowerCase();
  const revCagr = num(g('revCagr'));
  const peVsMean = num(g('peVsMean'));
  const indGrowth = num(g('industryGrowth'));

  const factors: Scored['factors'] = [];
  let gaps = 0;
  const add = (id: number, label: string, max: number, pts: number | null, note: string) => {
    if (pts === null) { gaps++; factors.push({ id, label, pts: 0, max, note: 'no data' }); }
    else factors.push({ id, label, pts, max, note });
  };

  // T1 (50)
  add(1, 'Pre-CAPEX ROCE/ROIC', 12, isNaN(roce) ? null :
    roce >= 20 ? 12 : roce >= 15 ? 9 : roce >= 10 ? 6 : roce >= 5 ? 3 : 0, isNaN(roce) ? '' : roce.toFixed(1) + '%');
  add(2, 'Anchor demand visibility', 12, isNaN(anchor) ? null :
    anchor > 60 ? 12 : anchor >= 40 ? 9 : anchor >= 20 ? 6 : anchor >= 10 ? 3 : 0, isNaN(anchor) ? '' : anchor.toFixed(0) + '% covered');
  add(3, 'D/E at announcement', 11, isNaN(de) ? null :
    de < 0.3 ? 11 : de < 0.5 ? 9 : de < 1.0 ? 7 : de < 1.5 ? 4 : 0, isNaN(de) ? '' : de.toFixed(2) + 'x');
  add(4, 'OCF status', 8, isNaN(ocfYears) ? null :
    ocfYears >= 5 ? 8 : ocfYears >= 3 ? 6 : ocfYears >= 1 ? 3 : 0, isNaN(ocfYears) ? '' : ocfYears < 0 ? 'negative' : ocfYears + 'y positive');
  add(5, 'Funding source', 7, isNaN(internal) ? null :
    internal > 70 ? 7 : internal >= 40 ? 5 : internal >= 20 ? 3 : 0, isNaN(internal) ? '' : internal.toFixed(0) + '% internal');
  // T2 (25)
  add(6, 'Capacity utilization', 6, isNaN(util) ? null :
    util > 90 ? 6 : util >= 85 ? 5 : util >= 75 ? 3 : util >= 60 ? 1 : 0, isNaN(util) ? '' : util.toFixed(0) + '%');
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
  add(7, country === 'IN' ? 'Promoter quality' : 'Founder-CEO', 6, f7, f7n);
  add(8, 'EBITDA margin', 5, isNaN(ebitda) ? null :
    ebitda > 25 ? 5 : ebitda >= 20 ? 4 : ebitda >= 15 ? 3 : ebitda >= 10 ? 1 : 0, isNaN(ebitda) ? '' : ebitda.toFixed(1) + '%');
  add(9, 'Capex size sweet spot', 4, isNaN(capexPct) ? null :
    capexPct >= 50 && capexPct <= 150 ? 4 : (capexPct >= 30 && capexPct < 50) || (capexPct > 150 && capexPct <= 200) ? 2 : 0,
    isNaN(capexPct) ? '' : capexPct.toFixed(0) + '% of gross block');
  add(10, 'Cost-overrun record', 4, !overrunRaw ? null :
    /^(n|no|none|zero|0)/.test(overrunRaw) ? 4 : /minor|<10/.test(overrunRaw) ? 2 : 0, overrunRaw || '');
  // T3 (15)
  add(11, 'Cycle timing', 4, !cycleRaw ? null :
    cycleRaw.startsWith('M') ? 4 : cycleRaw.startsWith('E') ? 2 : 0,
    cycleRaw.startsWith('M') ? 'mid-cycle' : cycleRaw.startsWith('E') ? 'early' : cycleRaw ? 'peak' : '');
  add(12, 'Working-capital trend', 3, !wcRaw ? null :
    /stable|improv|s\b|i\b/.test(wcRaw) ? 3 : 0, wcRaw || '');
  add(13, 'Revenue CAGR 3-yr', 3, isNaN(revCagr) ? null :
    revCagr >= 12 && revCagr <= 25 ? 3 : (revCagr >= 5 && revCagr < 12) || (revCagr > 25 && revCagr <= 35) ? 1 : 0,
    isNaN(revCagr) ? '' : revCagr.toFixed(0) + '%');
  add(14, 'Brownfield vs greenfield', 3, !brownRaw ? null :
    /brown|^y/.test(brownRaw) ? 3 : /hybrid|mix/.test(brownRaw) ? 1 : 0, brownRaw || '');
  add(15, 'Policy support', 2, !(g('policy') || '').trim() ? null :
    /pli|ira|chips|mandate|^y/i.test(g('policy')!) ? 2 : /indirect|partial/i.test(g('policy')!) ? 1 : 0, (g('policy') || '').slice(0, 24));
  // T4 (10)
  add(16, 'Industry growth', 2, isNaN(indGrowth) ? null : indGrowth > 2 ? 2 : indGrowth >= 1 ? 1 : 0,
    isNaN(indGrowth) ? '' : indGrowth.toFixed(1) + 'x GDP');
  add(17, 'Import substitution', 2, yes(g('importSub')) === null ? null : yes(g('importSub')) ? 2 : 0, '');
  add(18, 'Export opportunity', 1, yes(g('exportOpp')) === null ? null : yes(g('exportOpp')) ? 1 : 0, '');
  add(19, 'Valuation vs 5-yr mean', 2, isNaN(peVsMean) ? null :
    peVsMean < 1 ? 2 : peVsMean <= 1.5 ? 1 : 0, isNaN(peVsMean) ? '' : peVsMean.toFixed(2) + 'x mean');
  add(20, 'Competitive moat', 2, yes(g('moat')) === null ? null : yes(g('moat')) ? 2 : 0, '');
  add(21, 'Prior capex success', 1, yes(g('mgmtHistory')) === null ? null : yes(g('mgmtHistory')) ? 1 : 0, '');

  const base = factors.reduce((s, f) => s + f.pts, 0);

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
  const [decision, decisionColor, position, hit] =
    final >= 85 ? ['ANCHOR BUY', C.gold, '4-6%', '88%'] :
    final >= 70 ? ['CORE BUY', C.green, '3-4%', '72%'] :
    final >= 55 ? ['SATELLITE', C.cyan, '1.5-2.5%', '55%'] :
    final >= 40 ? ['WATCHLIST', C.amber, '0%', '—'] :
    final >= 25 ? ['AVOID', C.orange, '0%', '—'] : ['REJECT', C.red, '0%', '—'];

  // Confidence (§12.5): data completeness + industry hit-rate proxy (multiplier)
  const filled = 21 - gaps;
  const confidence: Scored['confidence'] =
    filled >= 17 && mult >= 1.0 ? 'HIGH' : filled >= 12 ? 'MEDIUM' : 'LOW';
  const positionFinal = confidence === 'LOW' && (final >= 55) ? position + ' → halve (LOW conf)' : position;

  // Action guidance (when to buy / wait / where)
  const action =
    final >= 85 ? 'Deploy now (' + position + '). Add on dips. Hit rate ' + hit + '. Monitor quarterly: D/E rise >0.3x or guidance moderation ×2 ⇒ trim 50%.' :
    final >= 70 ? 'Buy now (' + position + '). Hit rate ' + hit + '. Confirm anchor demand on next concall.' :
    final >= 55 ? 'WAIT — buy only after Q1 post-capex confirmation (utilization ramp + no D/E creep). Then ' + position + '.' :
    final >= 40 ? 'Do not deploy. Re-score when 2-3 weak factors improve: ' +
      factors.filter((f) => f.pts === 0 && f.max >= 4).slice(0, 3).map((f) => f.label).join(', ') + '.' :
    final >= 25 ? 'Avoid — capital impairment risk material (' + dbCount + ' deal-breakers).' :
    'Hard pass. Historical failure rate >60% in this band.';

  const top = [...factors].sort((a, b) => b.pts - a.pts).slice(0, 3).filter((f) => f.pts > 0);
  const weak = factors.filter((f) => f.pts === 0 && f.max >= 4).slice(0, 3);
  const comment =
    'Drivers: ' + (top.map((f) => f.label + ' ' + f.pts + '/' + f.max).join(' · ') || 'none') +
    (weak.length ? ' | Weak: ' + weak.map((f) => f.label).join(' · ') : '') +
    (dbList.length ? ' | ⛔ ' + dbList.join(' · ') : '') +
    (gaps > 4 ? ' | ' + gaps + ' data gaps — verify before sizing' : '');

  const th = THEMES.find(([re]) => re.test(industry) || re.test(sector) || re.test(name));

  return {
    name, sector, industry, country, base, final, decision, decisionColor, dbCount, dbList,
    mult, confidence, position: positionFinal, gaps, factors, comment, action,
    theme: th ? th[1] : null, roce, de, util, anchor, debtFund: debtPct, ocfYears, ebitda, pledge, raw: r,
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

const KD = 'mc:capex-tracker:data:v1'; const KN = 'mc:capex-tracker:files:v1';

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
    if (!h['name']) { setMsg('Could not find a Company Name column in ' + fname + ' — download the template below.'); return; }
    const key = (r: Row, hh: Record<string, string>) => (r[hh['name']] || '').trim().toLowerCase();
    const existingH = rows.length ? resolveHeaders(Object.keys(rows[0])) : h;
    const merged = [...rows];
    let updated = 0, added = 0;
    for (const inc of incoming) {
      const k = key(inc, h); if (!k) continue;
      const idx = merged.findIndex((r) => key(r, resolveHeaders(Object.keys(r))) === k);
      if (idx >= 0) { merged[idx] = inc; updated++; } else { merged.push(inc); added++; }
    }
    void existingH;
    persist(merged, [...files.filter((f) => f !== fname), fname]);
    setMsg('Loaded ' + fname + ': ' + added + ' added · ' + updated + ' updated · ' + merged.length + ' total (saved — survives reloads)');
  };

  const onFiles = async (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) {
      try {
        if (/\.(xlsx|xls)$/i.test(f.name)) {
          const XLSX = await loadSheetJS();
          const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
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
    const c: Record<string, number> = { 'ANCHOR BUY': 0, 'CORE BUY': 0, SATELLITE: 0, WATCHLIST: 0, AVOID: 0, REJECT: 0 };
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

  const Row21 = ({ s }: { s: Scored }) => (
    <div style={{ background: C.panel2, border: '1px solid ' + C.line, borderRadius: 10, padding: 12, margin: '6px 0 10px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 6 }}>
        {s.factors.map((f) => (
          <div key={f.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: F.xs, padding: '3px 8px', borderRadius: 6, background: f.note === 'no data' ? C.panel : f.pts === 0 ? '#FF4D6A12' : f.pts === f.max ? '#00E68A12' : C.panel }}>
            <span style={{ color: C.dim }}>F{f.id} {f.label}{f.note && f.note !== 'no data' ? ' · ' + f.note : ''}</span>
            <span style={{ fontWeight: 900, color: f.note === 'no data' ? C.muted : f.pts === 0 ? C.red : f.pts === f.max ? C.green : C.amber }}>{f.note === 'no data' ? 'n/a' : f.pts + '/' + f.max}</span>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8, fontSize: F.sm, color: C.txt }}><span style={{ color: C.dim }}>Base {s.base} × industry {s.mult.toFixed(2)}{s.dbCount >= 3 ? ' → CAPPED 30 (deal-breakers)' : ''} = </span><b>{s.final}</b><span style={{ color: C.dim }}> · confidence {s.confidence}{s.gaps ? ' · ' + s.gaps + ' gaps' : ''}</span></div>
      <div style={{ marginTop: 4, fontSize: F.sm, color: C.amber }}>{s.comment}</div>
      <div style={{ marginTop: 4, fontSize: F.sm, color: C.cyan }}>▶ {s.action}</div>
    </div>
  );

  const BAND_ORDER = ['ALL', 'ANCHOR BUY', 'CORE BUY', 'SATELLITE', 'WATCHLIST', 'AVOID', 'REJECT'];
  const bandColor = (b: string) => b === 'ANCHOR BUY' ? C.gold : b === 'CORE BUY' ? C.green : b === 'SATELLITE' ? C.cyan : b === 'WATCHLIST' ? C.amber : b === 'AVOID' ? C.orange : b === 'REJECT' ? C.red : C.blue;

  const upgradeWatch = useMemo(() => scored.filter((s) => s.decision === 'WATCHLIST' || s.decision === 'SATELLITE')
    .map((s) => ({ s, need: s.factors.filter((f) => f.pts === 0 && f.max >= 4 && f.note !== 'no data').slice(0, 2) }))
    .sort((a, b) => b.s.final - a.s.final).slice(0, 10), [scored]);

  return (
    <div style={{ maxWidth: 2100, margin: '0 auto', padding: '14px 18px', color: C.txt, fontFamily: 'inherit' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: C.dim, textDecoration: 'none', fontSize: F.sm }}>← Home</Link>
        <span style={{ fontSize: F.xl, fontWeight: 900, color: C.orange }}>🏗 CAPEX TRACKER</span>
        <span style={{ fontSize: F.sm, color: C.dim }}>200-case masterclass engine · 21 factors · deal-breaker override · when to buy, when to wait</span>
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
          <div style={{ fontSize: F.lg, fontWeight: 800 }}>Upload your capex universe (CSV or Excel)</div>
          <div style={{ fontSize: F.sm, color: C.dim, marginTop: 8, maxWidth: 760, margin: '8px auto' }}>
            One row per capex announcement, columns per the masterclass Appendix B (ROCE, D/E, utilization, anchor demand %, funding mix, promoter/pledge…).
            Download the input template above to see every accepted column. Data persists in this browser — re-upload any time to update; nothing is lost unless you press Clear all.
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
                <TH k="name" label="COMPANY" /><TH k="industry" label="INDUSTRY" />
                <TH k="final" label="SCORE" right /><TH k="decision" label="DECISION" />
                <TH k="confidence" label="CONF" /><TH k="dbCount" label="⛔DB" right />
                <TH k="roce" label="ROCE%" right /><TH k="de" label="D/E" right />
                <TH k="util" label="UTIL%" right /><TH k="anchor" label="ANCHOR%" right />
                <TH k="debtFund" label="DEBT-FUND%" right /><TH k="position" label="SIZE" />
              </tr></thead>
              <tbody>
                {visible.map((s) => (
                  <FragmentRow key={s.name} s={s} open={open === s.name} toggle={() => setOpen(open === s.name ? null : s.name)} fmt={fmt} Row21={Row21} />
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: F.xs, color: C.muted, marginTop: 8 }}>
            Click any row for the 21-factor breakdown + action plan. Scores are evidence-density per the 200-case masterclass — confirm anchor demand + funding mix on the concall before sizing. Not investment advice.
          </div>
        </>
      )}

      {/* ═══ DECISION BOARD ═══ */}
      {tab === 'analytics' && scored.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
          {(['ANCHOR BUY', 'CORE BUY', 'SATELLITE'] as const).map((b) => (
            <div key={b} style={card}>
              <div style={{ fontSize: F.md, fontWeight: 800, color: bandColor(b), marginBottom: 4 }}>
                {b === 'ANCHOR BUY' ? '🥇' : b === 'CORE BUY' ? '🟢' : '🛰'} {b} · {counts[b] || 0}
              </div>
              <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>
                {b === 'ANCHOR BUY' ? 'Deploy 4-6% now · 88% historical hit rate' : b === 'CORE BUY' ? 'Buy 3-4% · 72% hit rate · verify anchor on concall' : 'WAIT for Q1 post-capex confirmation, then 1.5-2.5% · 55% hit rate'}
              </div>
              {scored.filter((s) => s.decision === b).slice(0, 10).map((s) => (
                <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                  <span><b>{s.name}</b> <span style={{ color: C.muted }}>· {s.industry || s.sector}</span>{s.theme && <span style={{ color: C.violet }}> · {s.theme}</span>}</span>
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
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 4 }}>🔮 2026-2030 theme map (Ch.11 Tier-1)</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginBottom: 6 }}>Your names matched to the masterclass's highest-probability forward themes.</div>
            {scored.filter((s) => s.theme && s.final >= 55).slice(0, 12).map((s) => (
              <div key={s.name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '5px 2px', borderTop: '1px solid ' + C.line, fontSize: F.sm }}>
                <span><b>{s.name}</b> <span style={{ color: C.violet }}>{s.theme}</span></span>
                <span style={{ fontWeight: 900, color: bandColor(s.decision) }}>{s.final}</span>
              </div>
            ))}
            {!scored.some((s) => s.theme && s.final >= 55) && <div style={{ fontSize: F.sm, color: C.dim, padding: '8px 0' }}>No theme matches ≥55 yet.</div>}
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.teal, marginBottom: 4 }}>⏱ When capex works — the cycle checklist (Ch.9)</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.7 }}>
              ✅ Industry utilization &gt;85% across top-3 players · demand visibility 18-24 months · input costs lower half of 5-yr range · rates flat/declining · sector multiples NOT at decade highs · you're first/second mover.<br />
              ⛔ Skip when: sector is top-quartile performer of the decade (65% of failures announced there) · multiple competitors announce simultaneously · leverage rises &gt;0.5x during construction · cost overrun &gt;20%.<br />
              📋 Quarterly: track spend vs schedule, utilization ramp, D/E creep (&gt;+0.3x = flag), OCF. <b>2 consecutive guidance moderations = TRIM 50% · 3 = EXIT FULL.</b>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODEL ═══ */}
      {tab === 'model' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.cyan, marginBottom: 6 }}>Weights (100 pts · Ch.12.1)</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
              <b>Tier 1 (50):</b> ROCE/ROIC 12 · Anchor demand 12 · D/E 11 · OCF 8 · Funding source 7<br />
              <b>Tier 2 (25):</b> Utilization 6 · Promoter/Founder 6 · EBITDA 5 · Capex sweet-spot 4 · Overrun record 4<br />
              <b>Tier 3 (15):</b> Cycle timing 4 · WC trend 3 · Rev CAGR 3 · Brownfield 3 · Policy 2<br />
              <b>Tier 4 (10):</b> Industry growth 2 · Import-sub 2 · Export 1 · Valuation 2 · Moat 2 · Prior capex 1
            </div>
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.red, marginBottom: 6 }}>Deal breakers (any 3 ⇒ cap 30)</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
              DB1 D/E &gt;1.5x · DB2 OCF negative/below maintenance · DB3 pledge &gt;30% / material RPT · DB4 debt-funding &gt;70% · DB5 anchor &lt;25% of new capacity · DB6 ROCE below cost of debt.<br />
              <span style={{ color: C.dim }}>In 38 of 40 India failures, ≥4 of 8 red flags were visible in audited financials TWO YEARS before the announcement. The information was never the problem — discipline was.</span>
            </div>
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.gold, marginBottom: 6 }}>Decision bands (Ch.12.4)</div>
            <div style={{ fontSize: F.sm, lineHeight: 1.9 }}>
              <span style={{ color: C.gold }}>85-100 ANCHOR BUY</span> · 4-6% position · 88% hit rate<br />
              <span style={{ color: C.green }}>70-84 CORE BUY</span> · 3-4% · 72%<br />
              <span style={{ color: C.cyan }}>55-69 SATELLITE</span> · 1.5-2.5% · 55% · wait for Q1 confirmation<br />
              <span style={{ color: C.amber }}>40-54 WATCHLIST</span> · no deployment · wait for 2-3 metrics to improve<br />
              <span style={{ color: C.orange }}>25-39 AVOID</span> · impairment risk material<br />
              <span style={{ color: C.red }}>0-24 REJECT</span> · &gt;60% historical failure rate<br />
              <span style={{ color: C.dim }}>LOW confidence (data gaps / weak industry) ⇒ halve the position regardless of score.</span>
            </div>
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.violet, marginBottom: 6 }}>Industry multiplier (Ch.8/12.2)</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
              Defence 1.10 · SpecChem 1.08 · Pharma-CDMO 1.06 · Consumer-premium 1.05 · Cement/MiningTech/PEB 1.03 · Renewables-PPA 1.02 · Semis/AI/EMS 1.00 · Banks 0.95 · Real-estate 0.85 · Telecom 0.75 · Airlines 0.70 · Merchant-power/Steel 0.65.<br />
              <span style={{ color: C.dim }}>Industry adjusts the odds — it never overrides operational quality (the regression says quality dominates).</span>
            </div>
          </div>
          <div style={card}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.teal, marginBottom: 6 }}>The three universal predictors (Ch.6)</div>
            <div style={{ fontSize: F.sm, color: C.txt, lineHeight: 1.8 }}>
              (A) Pre-existing ROCE/ROIC above industry median — 84% of winners.<br />
              (B) Demand visibility BEFORE commitment (anchor &gt;40% of new capacity) — 81%.<br />
              (C) Balance-sheet shock capacity (D/E &lt;1.0) — 79%.<br />
              All three present ⇒ 85%+ success. All three absent ⇒ 80%+ failure.<br />
              <span style={{ color: C.dim }}>Asymmetries: brownfield 72% vs greenfield 51% · internal-funded 76% vs debt-funded 41% · &gt;85% utilization 74% vs &lt;70% 43% · domestic 68% vs cross-border M&A 37%.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// row + expandable detail (kept outside main render path for clarity)
function FragmentRow({ s, open, toggle, fmt, Row21 }: { s: Scored; open: boolean; toggle: () => void; fmt: (n: number, d?: number) => string; Row21: (p: { s: Scored }) => any }) {
  return (
    <>
      <tr onClick={toggle} style={{ borderBottom: '1px solid ' + C.line, cursor: 'pointer', background: open ? '#16233B' : 'transparent' }}>
        <td style={{ padding: '7px 8px', fontWeight: 800 }}>{s.name} <span style={{ fontSize: 10, color: C.muted }}>{s.country === 'US' ? '🇺🇸' : '🇮🇳'}</span></td>
        <td style={{ padding: '7px 8px', color: C.dim, fontSize: F.xs }}>{s.industry || s.sector}{s.theme ? ' · ' + s.theme : ''}</td>
        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 900, color: s.decisionColor, fontSize: F.md }}>{s.final}</td>
        <td style={{ padding: '7px 8px' }}><span style={{ fontSize: 10, fontWeight: 900, padding: '2px 8px', borderRadius: 10, background: s.decisionColor + '22', color: s.decisionColor, border: '1px solid ' + s.decisionColor + '55' }}>{s.decision}</span></td>
        <td style={{ padding: '7px 8px', fontSize: F.xs, color: s.confidence === 'HIGH' ? C.green : s.confidence === 'MEDIUM' ? C.amber : C.red }}>{s.confidence}</td>
        <td style={{ padding: '7px 8px', textAlign: 'right', fontWeight: 900, color: s.dbCount >= 3 ? C.red : s.dbCount ? C.amber : C.muted }}>{s.dbCount || '—'}</td>
        <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(s.roce)}</td>
        <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(s.de, 2)}</td>
        <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(s.util, 0)}</td>
        <td style={{ padding: '7px 8px', textAlign: 'right' }}>{fmt(s.anchor, 0)}</td>
        <td style={{ padding: '7px 8px', textAlign: 'right', color: s.debtFund > 70 ? C.red : C.txt }}>{fmt(s.debtFund, 0)}</td>
        <td style={{ padding: '7px 8px', fontSize: F.xs, color: C.cyan }}>{s.position}</td>
      </tr>
      {open && <tr><td colSpan={12} style={{ padding: '0 8px' }}><Row21 s={s} /></td></tr>}
    </>
  );
}
