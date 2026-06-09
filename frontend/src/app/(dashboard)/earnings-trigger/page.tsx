'use client';

// ============================================================================
// EARNINGS-TRIGGER ANALYZER (PATCH 1140)
// Upload a Screener.in export after earnings → the engine scores every stock on
// the institutional "earnings trigger" framework and ranks the best setups.
// Logic from the India Earnings-Trigger Masterclass — fundamentally different
// from the Multibagger/Fundamentals quality screens: this is about WHICH beats
// become multibaggers (speed of acceleration × margin trajectory × PE-cycle
// position × chart stage × earnings quality × sponsorship), classified into
// the five post-earnings scenarios (A–E). Self-contained (react + next/link).
// ============================================================================

import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';

const C = {
  bg: '#090d13', panel: '#111722', panel2: '#0d131c', line: '#1e2733', line2: '#2b3a4d',
  txt: '#e6edf3', muted: '#8a98ab', dim: '#5b6677',
  green: '#3fb950', red: '#f85149', amber: '#d29922', blue: '#58a6ff', violet: '#a78bfa', cyan: '#39d0d8', teal: '#2dd4bf', gold: '#e3b341',
};
const F = { xs: 12, sm: 13, md: 15, base: 16, lg: 19, xl: 24, xxl: 32, hero: 38 };

// ---- CSV parse (quote-aware) ----
type Row = Record<string, string>;
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let i = 0, field = '', row: string[] = [], inQ = false;
  while (i < text.length) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; } field += c; i++; continue; }
    else { if (c === '"') { inQ = true; i++; continue; } if (c === ',') { row.push(field); field = ''; i++; continue; } if (c === '\r') { i++; continue; } if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; } field += c; i++; } }
  if (field.length || row.length) { row.push(field); rows.push(row); } return rows;
}
function toObjects(rows: string[][]): Row[] {
  if (!rows.length) return []; const head = rows[0].map((h) => h.trim()); const out: Row[] = [];
  for (let r = 1; r < rows.length; r++) { if (rows[r].length <= 3) continue; const o: Row = {}; head.forEach((h, idx) => (o[h] = rows[r][idx])); out.push(o); } return out;
}
const num = (v: any) => { if (v == null) return NaN; const s = String(v).trim().replace(/,/g, ''); if (!s || s === '-') return NaN; const n = parseFloat(s); return isNaN(n) ? NaN : n; };
const c01 = (x: number) => Math.max(0, Math.min(1, x));
const G = (g: number) => { if (isNaN(g)) return 0.15; if (g < 0) return Math.max(0, 0.15 + g / 300); if (g < 25) return 0.15 + (g / 25) * 0.45; if (g < 40) return 0.60 + ((g - 25) / 15) * 0.20; if (g < 60) return 0.80 + ((g - 40) / 20) * 0.20; return 1; };
const qoq = (a: number, b: number) => (isNaN(a) || isNaN(b) || Math.abs(b) < 1e-6) ? NaN : (a - b) / Math.abs(b);

type Scored = {
  name: string; nse: string; industry: string; mcap: number; price: number;
  composite: number; scenario: string;
  subs: { trigger: number; accel: number; margin: number; multiple: number; stage: number; quality: number; sponsor: number };
  flags: string[]; notes: string[]; trend: { p200: string; p50: string; d5020: string };
  qp: number; qs: number; peg: number; pegNM: boolean; pe: number; om0: number; om1: number; roce: number; cfo: number; prom: number; pledge: number; r1y: number; stage2: boolean; stage4: boolean;
};

// ---- THE ENGINE (validated against a 145-stock Screener export) ----
function scoreRow(d: Row): Scored {
  const f = (k: string) => num(d[k]);
  const qp = f('YOY Quarterly profit growth'), qs = f('YOY Quarterly sales growth');
  const notes: string[] = [];
  let trigger = G(qp) * 0.6 + G(qs) * 0.4;
  if (!isNaN(qp) && qp >= 25 && !isNaN(qs) && qs < 10) { trigger *= 0.7; notes.push('Profit-led — sales lagging'); }
  if (!isNaN(qp) && qp > 300) notes.push('Low-base / possibly inorganic — verify');
  const p0 = f('Profit after tax latest quarter'), p1 = f('Profit after tax preceding quarter'), p2 = f('Net profit 2quarters back'), p3 = f('Net profit 3quarters back');
  const s0 = f('Sales latest quarter'), s1 = f('Sales preceding quarter'), s2 = f('Sales 2quarters back'), s3 = f('Sales 3quarters back');
  const accelOf = (g1: number, g2: number, g3: number) => { let a = 0.3; if (!isNaN(g1) && g1 > 0) a += 0.3; if (!isNaN(g1) && !isNaN(g2) && g1 >= g2) a += 0.25; if (!isNaN(g2) && !isNaN(g3) && g2 >= g3) a += 0.15; return c01(a); };
  const pAcc = accelOf(qoq(p0, p1), qoq(p1, p2), qoq(p2, p3));
  const sAcc = accelOf(qoq(s0, s1), qoq(s1, s2), qoq(s2, s3));
  const accel = 0.65 * pAcc + 0.35 * sAcc;
  const decel = (qoq(p0, p1) < qoq(p1, p2)) && (qoq(p1, p2) < qoq(p2, p3));
  const om0 = f('OPM latest quarter'), om1 = f('OPM preceding quarter'), omLY = f('OPM last year'), om5 = f('OPM 5Year');
  // OPM beyond ±120% is a data error (microcap near-zero revenue → e.g. "29 → −9553"). Ignore such values for the
  // margin trajectory so a garbage print can't fake expansion or compression.
  const okM = (x: number) => !isNaN(x) && Math.abs(x) <= 120;
  let margin = 0.4; if (okM(om0) && okM(om1) && om0 > om1) margin += 0.2; if (okM(om0) && okM(omLY) && om0 > omLY) margin += 0.2; if (okM(om0) && okM(om5) && om0 > om5) margin += 0.2;
  // Material moves only (≥1pp both sequentially AND vs last year). The masterclass punishes real margin erosion on a beat
  // (Scenario 2), not 0.2pp quarterly noise — tightening this stops the flag spamming the table and over-stating margins.
  const marginCompression = (okM(om0) && okM(om1) && okM(omLY) && (om1 - om0 >= 1) && (omLY - om0 >= 1));
  const marginExpansion = (okM(om0) && okM(om1) && okM(omLY) && (om0 - om1 >= 2) && (om0 - omLY >= 2)); // ≥200bps = the masterclass re-rating signal
  if (marginCompression) margin -= 0.2; margin = c01(margin);
  if (marginExpansion) notes.push('Margin expanding');
  const peg = f('PEG Ratio'), pe = f('Price to Earning'), pe5 = f('Historical PE 5Years'), ipe = f('Industry PE');
  // PEG is only meaningful with positive earnings AND a sane magnitude. Negative PEG (loss / negative TTM EPS growth)
  // or an extreme PEG (e.g. 25–58 from a near-zero growth denominator, often paired with a 600+ PE) is a data artifact,
  // not "expensive" or "cheap" — score it neutral and lean on PE-vs-history instead, rather than rewarding/penalising noise.
  const pegMeaningful = !isNaN(peg) && peg > 0 && peg <= 15 && !isNaN(pe) && pe > 0;
  let pegS; if (!pegMeaningful) pegS = 0.4; else if (peg < 1) pegS = 1; else if (peg < 1.5) pegS = 0.8; else if (peg < 2) pegS = 0.55; else if (peg < 3) pegS = 0.3; else pegS = 0.1;
  let peVs5 = 0.5; if (!isNaN(pe) && pe > 0 && !isNaN(pe5) && pe5 > 0) peVs5 = c01(1.0 - (pe / pe5 - 0.8) / 1.0);
  let peVsInd = 0.5; if (!isNaN(pe) && pe > 0 && !isNaN(ipe) && ipe > 0) peVsInd = pe < ipe ? 0.8 : 0.4;
  const multiple = 0.5 * pegS + 0.35 * peVs5 + 0.15 * peVsInd;
  const price = f('Current Price'), d50 = f('DMA 50'), d200 = f('DMA 200'), fromHi = f('From 52w high'), r1y = f('Return over 1year');
  let stage; if (!isNaN(price) && !isNaN(d200) && price < d200) stage = 0.15;
  else { stage = 0.3; if (!isNaN(price) && !isNaN(d200) && price > d200) stage += 0.25; if (!isNaN(price) && !isNaN(d50) && price > d50) stage += 0.1; if (!isNaN(d50) && !isNaN(d200) && d50 > d200) stage += 0.15; if (!isNaN(fromHi) && fromHi < 25) stage += 0.1; if (!isNaN(fromHi) && fromHi < 10) stage += 0.1; if (!isNaN(r1y) && r1y > 0) stage += 0.05; }
  stage = c01(stage);
  const stage2 = stage >= 0.6, stage4 = (!isNaN(price) && !isNaN(d200) && price < d200);
  // Stage-2 trend-template legs (Minervini): surfaced as their own column so the chart read is explicit, not hidden in a bar.
  const tri = (cond: boolean, known: boolean) => (known ? (cond ? 'y' : 'n') : '?');
  const trend = {
    p200: tri(price > d200, !isNaN(price) && !isNaN(d200)),
    p50: tri(price > d50, !isNaN(price) && !isNaN(d50)),
    d5020: tri(d50 > d200, !isNaN(d50) && !isNaN(d200)),
  };
  const cfo = f('CFO to PAT'), roce = f('Return on capital employed'), de = f('Debt to equity'), ic = f('Interest Coverage Ratio');
  // CFO/PAT bands. Negative = the business is burning cash (worst). 0.8–6 = healthy cash conversion. Far above ~6
  // (e.g. −575, 74, 31) is a near-zero-PAT denominator artifact, not quality — treat as neutral/suspect, never a win.
  let cfoS; if (isNaN(cfo)) cfoS = 0.5; else if (cfo < 0) cfoS = 0.15; else if (cfo < 0.6) cfoS = 0.2; else if (cfo < 0.8) cfoS = 0.5; else if (cfo < 1) cfoS = 0.8; else if (cfo <= 6) cfoS = 1; else cfoS = 0.5;
  const roceS = isNaN(roce) ? 0.3 : c01(roce / 30);
  let deS; if (isNaN(de)) deS = 0.6; else if (de <= 0.3) deS = 1; else if (de <= 0.5) deS = 0.85; else if (de <= 1) deS = 0.6; else if (de <= 2) deS = 0.3; else deS = 0.1;
  const quality = 0.4 * cfoS + 0.35 * roceS + 0.25 * deS;
  const prom = f('Promoter holding'), dProm = f('Change in promoter holding 3Years'), dFII = f('Change in FII holding 3Years'), dDII = f('Change in DII holding 3Years'), pledge = f('Pledged percentage');
  let promS = prom >= 50 ? 1 : prom >= 35 ? 0.7 : prom >= 20 ? 0.5 : 0.3; if (isNaN(prom)) promS = 0.4;
  const flowS = (dFII > 0 ? 0.5 : 0) + (dDII > 0 ? 0.3 : 0) + (dProm > 0 ? 0.2 : 0);
  let sponsor = c01(0.55 * promS + 0.45 * c01(flowS));
  if (!isNaN(pledge) && pledge > 10) sponsor *= 0.6; if (!isNaN(pledge) && pledge > 25) sponsor *= 0.5;

  // Weights follow the masterclass hierarchy: earnings growth + ACCELERATION are the trigger (O'Neil: "the single most
  // important element"), and the PE-multiple cycle does "≈60% of the work" on the eventual return (the entire Losers
  // chapter is multiple compression). Margin trajectory is a contextual modifier (Nick Sleep: judge reinvestment, not
  // Q-margins) — weighted below growth and the multiple, so it informs the score without dominating it.
  let composite = 100 * (0.20 * trigger + 0.18 * accel + 0.21 * multiple + 0.11 * margin + 0.12 * stage + 0.10 * quality + 0.08 * sponsor);
  const flags: string[] = [];
  if (!isNaN(cfo) && cfo < 0.6) { flags.push('CFO/PAT<0.6 earnings quality'); composite *= 0.7; }
  if (!isNaN(pledge) && pledge > 25) { flags.push('High pledge'); composite *= 0.6; }
  if (!isNaN(de) && de > 2 && !isNaN(ic) && ic < 1.5) { flags.push('Leveraged + low int-cover'); composite *= 0.7; }
  if (pegMeaningful && peg > 3) flags.push('PEG>3 compression risk');
  if (marginCompression) flags.push('Margin compressing');
  if (!isNaN(qp) && qp >= 20 && decel) flags.push('Growth decelerating');

  const premium = multiple < 0.4, discount = multiple >= 0.6;
  const vetoFlag = flags.some((x) => /quality|pledge|Leveraged/i.test(x));
  // Deterioration ladder. E (Avoid) must actually fire — a profit collapse hiding in "Hold/watch" was the bug.
  const collapse = !isNaN(qp) && qp < -40 && !(stage2 && quality >= 0.6 && !vetoFlag); // >40% YoY profit drop (unless still pristine Stage-2)
  const decline = !isNaN(qp) && qp < -10;                                              // profit actually contracting YoY
  const weak = quality < 0.45 || (!isNaN(roce) && roce < 5) || vetoFlag || stage4;     // corroborating weakness
  let scenario;
  if (!isNaN(qp) && qp >= 40 && accel >= 0.65 && margin >= 0.6 && multiple >= 0.62 && stage2 && !vetoFlag) scenario = 'A';
  else if (collapse || (decline && weak) || (stage4 && (isNaN(qp) || qp < 10) && quality < 0.5)) scenario = 'E';
  else if (premium && (decel || (!isNaN(qp) && qp < 15))) scenario = 'C';
  else if (decline) scenario = 'C';                                                    // moderate decline, not avoid-grade → trim
  else if (discount && !stage4 && quality >= 0.45 && (isNaN(qp) || qp < 25)) scenario = 'D';
  else scenario = 'B';

  composite = Math.round(c01(composite / 100) * 100);
  return {
    name: (d['Name'] || d['NSE Code'] || '').trim(), nse: (d['NSE Code'] || '').trim(), industry: (d['Industry'] || '').trim(),
    mcap: f('Market Capitalization'), price,
    composite, scenario, subs: { trigger, accel, margin, multiple, stage, quality, sponsor }, flags, notes, trend,
    qp, qs, peg, pegNM: pegMeaningful, pe, om0, om1, roce, cfo, prom, pledge, r1y, stage2, stage4,
  };
}

const SCEN: Record<string, { c: string; label: string; tip: string }> = {
  A: { c: C.green, label: 'A · Multibagger setup', tip: 'Beat + accelerating + margin expanding + PE at discount + Stage-2. Highest-probability multibagger. Buy full size, hold 18–36m.' },
  B: { c: C.blue, label: 'B · Hold / watch', tip: 'Beat with steady growth or premium multiple. Hold if owned; do not chase. Needs acceleration or a cheaper entry.' },
  C: { c: C.amber, label: 'C · Trim / sell', tip: 'Decelerating growth at a premium multiple. The market compresses the multiple to the new growth rate. Trim.' },
  D: { c: C.cyan, label: 'D · Pullback watch', tip: 'Soft quarter but trend intact + multiple compressed + quality sound. A potential pullback buy in a compounder.' },
  E: { c: C.red, label: 'E · Avoid', tip: 'Profit contracting (esp. >40% YoY) or Stage-4 downtrend, with weak quality / negative returns. Capitulation or value-trap zone — avoid or exit; do the work before touching.' },
};

const VARS: { k: keyof Scored['subs']; label: string; color: string }[] = [
  { k: 'trigger', label: 'Trigger', color: C.green }, { k: 'accel', label: 'Accel', color: C.teal }, { k: 'margin', label: 'Margin', color: C.cyan },
  { k: 'multiple', label: 'Multiple', color: C.violet }, { k: 'stage', label: 'Stage', color: C.blue }, { k: 'quality', label: 'Quality', color: C.gold }, { k: 'sponsor', label: 'Sponsor', color: C.amber },
];
const band = (r: number) => (r >= 0.66 ? C.green : r >= 0.45 ? C.amber : C.red);
const fmtCr = (n: number) => isNaN(n) ? '—' : n >= 100000 ? (n / 100000).toFixed(1) + 'L Cr' : Math.round(n).toLocaleString('en-IN') + ' Cr';
// Display sanitizers — Screener throws absurd prints on near-zero denominators (sales +26193%, OPM −9553, CFO/PAT −575).
// Cap the on-screen value so one garbage cell can't make the whole row unreadable; the tooltip shows the raw figure.
const fmtPct = (n: number) => isNaN(n) ? '—' : (n > 999 ? '>999%' : n < -999 ? '<-999%' : n.toFixed(0) + '%');
const fmtOPM = (n: number) => isNaN(n) ? '—' : (Math.abs(n) > 120 ? 'n/m' : n.toFixed(0));
const fmtCFO = (n: number) => isNaN(n) ? '—' : (Math.abs(n) > 20 ? 'n/m' : n.toFixed(2));

// ---- sort / filter accessors (every column is sortable; every numeric field is filterable) ----
function getVal(s: Scored, k: string): number | string {
  switch (k) {
    case 'name': return (s.name || '').toLowerCase();
    case 'scenario': return s.scenario;
    case 'composite': return s.composite;
    case 'qp': return s.qp; case 'qs': return s.qs;
    case 'peg': return s.pegNM ? s.peg : NaN;
    case 'om0': return s.om0; case 'cfo': return s.cfo; case 'roce': return s.roce;
    case 'r1y': return s.r1y; case 'mcap': return s.mcap;
    default: return s.composite;
  }
}
const NUMFIELDS: [string, string][] = [['composite', 'Score'], ['qp', 'YoY PAT %'], ['qs', 'YoY Sales %'], ['peg', 'PEG'], ['om0', 'OPM latest'], ['cfo', 'CFO/PAT'], ['roce', 'ROCE %'], ['r1y', '1Y return %'], ['mcap', 'Mkt cap (Cr)']];

const SAMPLE = 'Name, NSE Code, YOY Quarterly profit growth, YOY Quarterly sales growth, PEG Ratio, Price to Earning, Historical PE 5Years, OPM latest quarter, OPM preceding quarter, Profit after tax latest quarter … (a standard Screener.in export — all 62 columns supported)';

// ---- The "do-the-work" checklist: the 2 variables the screen can't read (guidance language + sector flow),
// the A–E action map, what re-rates the multiple, the traps/discipline, and worked examples. Verbatim from the masterclass.
const GUIDE: { title: string; color: string; tag: string; items: string[] }[] = [
  {
    title: 'Guidance language — read the concall transcript, not the headline', color: C.teal, tag: 'Variable the screen can’t read — listen for these',
    items: [
      'Opening tone, verbatim across 4 quarters: “strong” → “satisfactory” is a yellow flag even on identical numbers. Bajaj Finance Q3FY24 added “despite a challenging… environment” → stock −7%.',
      'Conviction ladder, low→high: “we hope” < “we expect” < “we are targeting” < “we are confident” < “we are committed” < “we will deliver.” A downgrade from “confident” to “expect” is a SELL even if the number is unchanged (HUL 5–7% → 3–5% volume guide → −8%).',
      'First-time HEDGING words = sell: “subject to monsoon”, “ex-one-time”, “barring headwinds”, “normalize”, “competitive intensity has stepped up” (Asian Paints Q4FY25 → −23% over 12m).',
      'First-time forward CONFIDENCE = buy: “demand visibility through FY26”, “well placed”, “strong tailwinds” (Apar Q3FY24 → +30% in 3 months).',
      'Margin guidance: a widening range (18–19% → 17–19%) = falling visibility; a point estimate = highest conviction. Cyient widened 15–17% → 13–17% → −45%.',
      'Order book: granular (“47 orders, 12 customers, 5 geographies”) = de-risked; one lumpy order = concentration risk. Falling top-5 concentration re-rates.',
      'Q&A behaviour: short/defensive answers or a repeated dodge on margins = the answer is bad. Promoter personally on the call = strategically important quarter.',
      'Forward visibility horizon: extending (→ FY27 / FY29) = positive; shortening = negative.',
      'Transcript word-search: count “challenging / headwind / one-time / lumpy / subject to / normalize” vs last quarter — a jump = deteriorating narrative.',
    ],
  },
  {
    title: 'Sector flow & pre-Q whisper', color: C.violet, tag: 'Variable the screen can’t read — gather before the print',
    items: [
      'Peer concall read-across — read same-sector names that reported earlier (UltraTech for Shree; HDFC Bank for ICICI) and note the deltas.',
      'Channel checks — call 5–10 dealers/distributors across geographies (not only the friendly ones — confirmation bias).',
      'Industry data — SIAM/FADA (autos), AIOCD (pharma), GST collections, UPI, cement dispatches.',
      'Sell-side estimate-revision DIRECTION over the last 30/60/90 days — up = tailwind, down = headwind.',
      'Block & bulk deals + insider activity in the 5 days pre-result — promoter selling = red flag; FII accumulation = positive.',
      'Raw-material / commodity moves 4–6 weeks ahead often pre-signal margin pressure.',
      'AMFI sector positioning vs Nifty-500 weight — overweight = building conviction; underweight = disbelief.',
    ],
  },
  {
    title: 'After the print — the A→E action map', color: C.gold, tag: 'Match the engine’s scenario to a decision',
    items: [
      'A · Multibagger setup — beat + accelerating + margin expanding + PE at a discount + Stage-2. Buy full size; hold 18–36 months.',
      'B · Hold / watch — beat but steady or premium. Hold if owned, don’t chase; needs acceleration or a cheaper entry.',
      'C · Trim / sell — decelerating growth at a premium. The market compresses the multiple to the new growth rate. Trim ~50% on the print.',
      'D · Pullback watch — soft quarter but trend intact + cheap + quality sound. A potential pullback buy in a compounder.',
      'E · Avoid — profit contracting / Stage-4 downtrend / weak quality. Capitulation or value-trap zone; avoid or exit.',
      'Reaction read: big beat + small move = BUY (not priced); small beat + big move = TRIM (over-reaction); big miss + big drop = sidelines 1–2 weeks.',
    ],
  },
  {
    title: 'What re-rates the multiple (≈60% of the return)', color: C.green, tag: 'Watch your watchlist names for these 10',
    items: [
      'Capacity utilisation crossing 80% — operating-leverage breakthrough (Polycab 76%→85% drove +200bps).',
      'Top-5 customer concentration falling below 25% — de-risking (Azad 78%→65% re-rated).',
      'New geography/customer/product disclosed with a QUANTIFIED revenue number.',
      'Margin expansion +200 bps YoY for 4 consecutive quarters — structural, not a one-quarter pop (Apar).',
      'Promoter holding rising / pledge falling to zero — governance re-rating.',
      'FII above 15% or MF above 10% in a SMID — passive-flow threshold.',
      'First sell-side coverage initiation (0 → 5 brokers) — information asymmetry collapses.',
      'Index inclusion (Nifty 500, MSCI, FTSE) or F&O inclusion — passive demand + liquidity premium.',
      'First dividend / first buyback — capital-return discipline signals maturity.',
    ],
  },
  {
    title: 'Traps & iron discipline', color: C.red, tag: 'Memorise these — they catch experienced investors',
    items: [
      'NEVER buy a new position on result day — wait T+1 to T+5 to absorb the data and the concall.',
      'NEVER hold past 2 consecutive disappointing quarters — the third won’t save you.',
      'Trim 33% at +50%, another 33% at +120%, let the last 33% run on a trailing stop.',
      'One beat in a cyclical can just be a commodity price — you need 3 consecutive beats.',
      'High-PE compounder miss = 25–30% drawdown (Page Q2FY23 −25% in two sessions). Size accordingly.',
      'Promoter selling after a beat, or a block deal in the 5 days pre-result = they know something.',
      'OCF/PAT < 60% for 3 years = receivables-bloated. A margin-led beat with thin volume = unsustainable.',
      'PEG > 2 = multiple compression is the default outcome; PEG > 3 = distress.',
      'Don’t buy on “they should accelerate next year” without evidence — that’s hope, not a thesis.',
    ],
  },
  {
    title: 'Examples — beats that 5×’d vs beats that got punished', color: C.blue, tag: 'Same beat, opposite outcome — pattern-match yours',
    items: [
      'WON · MTAR — Q3FY22 revenue +50% / PAT +83%, EBITDA 23%→27%, order book 1.7× sales; re-rated 51×→125× = ~4× in 8 months.',
      'WON · Polycab — utilisation 76%→85% drove +200bps; multiple 25×→50×; tripled.',
      'WON · Tanfac — promoter change + utilisation 60%→85% + margin 12%→22%; ~20× in 2 years.',
      'WON · Apar — premium mix-shift drove 4 quarters of margin expansion; PE 12×→35×; ~20×.',
      'LOST · HUL — chronic 7–8% growth; each beat confirmed the ceiling; 62×→55×, flat 4 years (acceleration, not the beat, is what matters).',
      'LOST · Bajaj Finance — record Q3FY24 PAT but AUM guidance 31%→28%; PE 32×→26×; −7% on the day.',
      'LOST · Asian Paints — revenue beat but “competitive intensity” (Birla Opus); 55×→42×; −12% in a month.',
      'LOST · DMart — revenue beat but SSSG <8% at 90× PE; multiple compressed 21%.',
    ],
  },
];

// ---- Transparency: how the 0–100 score is built and how A–E is decided ----
const WEIGHTS: { k: string; w: number; color: string; desc: string }[] = [
  { k: 'Earnings trigger', w: 20, color: C.green, desc: 'YoY PAT (60%) + sales (40%). ≥25% is the floor, ≥40% is strong. A profit beat with sales lagging (<10%) is cut ×0.7 — no cost-cut beats.' },
  { k: 'Acceleration', w: 18, color: C.teal, desc: 'Sequential QoQ trend of PAT & sales over the last 3–4 quarters. Accelerating beats high-but-flat (the HUL lesson).' },
  { k: 'Multiple cycle', w: 21, color: C.violet, desc: 'PEG band + PE vs its own 5-yr median + vs industry. The single biggest lever — the masterclass says the multiple does ≈60% of the return.' },
  { k: 'Margin trajectory', w: 11, color: C.cyan, desc: 'OPM latest vs preceding / last-year / 5-yr. Expansion re-rates; material compression (≥1pp on a beat) is penalised.' },
  { k: 'Chart stage', w: 12, color: C.blue, desc: 'Minervini Stage-2 template — price above 50 & 200-DMA, 50>200, near the 52-wk high. Below the 200-DMA (Stage-4) is penalised.' },
  { k: 'Earnings quality', w: 10, color: C.gold, desc: 'CFO/PAT (Buffett: <0.6 = sell), ROCE, debt/equity. Cash flow is fact; profit is opinion.' },
  { k: 'Sponsorship', w: 8, color: C.amber, desc: 'Promoter holding, FII/DII accumulation over 3 years, pledge (penalised).' },
];
const CLASSIFY: { k: string; color: string; rule: string }[] = [
  { k: 'A · Multibagger setup', color: C.green, rule: 'ALL of: YoY PAT ≥40%, acceleration strong, margin expanding, multiple at a discount (cheap vs its history), Stage-2 uptrend, and NO quality/pledge/leverage red flag. The full alignment — buy full size.' },
  { k: 'B · Hold / watch', color: C.blue, rule: 'The residual — a genuine beat, but not cheap/accelerating enough for A and not deteriorating enough for C/E. Most names land here: hold if owned, don’t chase.' },
  { k: 'C · Trim / sell', color: C.amber, rule: 'Premium multiple + decelerating (or sub-15%) growth — the market compresses the multiple to the new growth rate. Also catches a moderate profit decline (−10% to −40%) that isn’t avoid-grade.' },
  { k: 'D · Pullback watch', color: C.cyan, rule: 'Soft quarter (growth <25%) but the trend is intact, the multiple is cheap, and quality is sound. A potential pullback buy in a compounder.' },
  { k: 'E · Avoid', color: C.red, rule: 'Real deterioration: profit collapsing >40% YoY; OR profit contracting >10% with weak quality / negative ROCE / a veto flag / Stage-4 downtrend; OR a Stage-4 chart with no growth and poor quality.' },
];

export default function EarningsTriggerPage({ scope: scopeProp = '' }: { scope?: string }) {
  let scope = scopeProp;
  if (!scope && typeof window !== 'undefined') { try { const qp = new URLSearchParams(window.location.search).get('scope'); if (qp === 'watchlist' || qp === 'portfolio') scope = qp; } catch {} }
  const KEY = scope ? 'mc:earnings-trigger:' + scope + ':data:v1' : 'mc:earnings-trigger:data:v1';
  const NKEY = scope ? 'mc:earnings-trigger:' + scope + ':name:v1' : 'mc:earnings-trigger:name:v1';

  const [data, setData] = useState<Row[]>([]);
  const [files, setFiles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [scenFilter, setScenFilter] = useState<string>('ALL');
  const [q, setQ] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'composite', dir: 'desc' });
  const [trendUp, setTrendUp] = useState(false);
  const [fField, setFField] = useState('');
  const [fMin, setFMin] = useState('');
  const [fMax, setFMax] = useState('');
  // refs so the async FileReader merge always sees the latest data/files (avoids stale closures)
  const dataRef = useRef<Row[]>([]); const filesRef = useRef<string[]>([]);
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { filesRef.current = files; }, [files]);

  const keyOf = (r: Row) => (r['NSE Code'] || r['Name'] || '').trim().toUpperCase();
  const label = files.length === 0 ? '' : files.length === 1 ? files[0] : files.length + ' files';

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY); if (raw) { const p = JSON.parse(raw); if (Array.isArray(p) && p.length) setData(p); }
      const nm = localStorage.getItem(NKEY);
      if (nm) { try { const arr = JSON.parse(nm); setFiles(Array.isArray(arr) ? arr : [String(arr)]); } catch { setFiles([nm]); } }
    } catch {}
  }, []);

  const persist = (rows: Row[], fileList: string[]) => { try { localStorage.setItem(KEY, JSON.stringify(rows)); localStorage.setItem(NKEY, JSON.stringify(fileList)); } catch (e) { setError("Couldn't save to browser storage — the combined list is large, but it still works for this session."); } };

  // Merge one or many CSVs into the working set, de-duping by ticker (a re-uploaded stock overwrites the older row).
  const ingest = useCallback((parts: { text: string; name: string }[]) => {
    const merged: Row[] = [...dataRef.current];
    const seen = new Map<string, number>(); merged.forEach((r, i) => seen.set(keyOf(r), i));
    const ok: string[] = []; const bad: string[] = []; let added = 0, updated = 0;
    for (const { text, name } of parts) {
      let inc: Row[] = []; try { inc = toObjects(parseCSV(text)); } catch {}
      if (!inc.length || (!('YOY Quarterly profit growth' in inc[0]) && !('Profit after tax latest quarter' in inc[0]))) { bad.push(name); continue; }
      ok.push(name);
      for (const row of inc) { const k = keyOf(row); if (!k) continue; if (seen.has(k)) { merged[seen.get(k) as number] = row; updated++; } else { seen.set(k, merged.length); merged.push(row); added++; } }
    }
    if (!ok.length) { setError(bad.length ? 'Not a Screener.in export (missing earnings columns): ' + bad.join(', ') : 'No data rows found in that CSV.'); return; }
    const newFiles = Array.from(new Set([...filesRef.current, ...ok]));
    setData(merged); setFiles(newFiles); persist(merged, newFiles);
    setError(bad.length ? 'Skipped (not Screener exports): ' + bad.join(', ') : '');
  }, [KEY, NKEY]);

  const onFile = useCallback((fl?: FileList | File[] | null) => {
    if (!fl) return; const arr = Array.from(fl as any) as File[]; if (!arr.length) return;
    Promise.all(arr.map((f) => new Promise<{ text: string; name: string }>((res) => { const r = new FileReader(); r.onload = (ev) => res({ text: String(ev.target?.result || ''), name: f.name }); r.onerror = () => res({ text: '', name: f.name }); r.readAsText(f); }))).then(ingest);
  }, [ingest]);
  const clearAll = () => { setData([]); setFiles([]); try { localStorage.removeItem(KEY); localStorage.removeItem(NKEY); } catch {} };

  const scored = useMemo(() => data.map(scoreRow).filter((s) => s.name).sort((a, b) => b.composite - a.composite), [data]);
  const counts = useMemo(() => { const m: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 }; scored.forEach((s) => m[s.scenario]++); return m; }, [scored]);
  const shown = useMemo(() => {
    const fmin = fMin === '' ? null : parseFloat(fMin);
    const fmax = fMax === '' ? null : parseFloat(fMax);
    let arr = scored.filter((s) =>
      (scenFilter === 'ALL' || s.scenario === scenFilter) &&
      s.composite >= minScore &&
      (!q || (s.name + ' ' + s.nse + ' ' + s.industry).toLowerCase().includes(q.toLowerCase())) &&
      (!trendUp || (s.trend.p50 === 'y' && s.trend.p200 === 'y')));
    if (fField) {
      arr = arr.filter((s) => { const v = getVal(s, fField); if (typeof v !== 'number' || isNaN(v)) return false; if (fmin != null && v < fmin) return false; if (fmax != null && v > fmax) return false; return true; });
    }
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...arr].sort((a, b) => {
      const va = getVal(a, sort.key), vb = getVal(b, sort.key);
      if (typeof va === 'string' || typeof vb === 'string') { const sa = String(va), sb = String(vb); return dir * (sa < sb ? -1 : sa > sb ? 1 : 0); }
      const na = isNaN(va), nb = isNaN(vb); if (na && nb) return 0; if (na) return 1; if (nb) return -1; // NaN/n-a always last
      return dir * (va - vb);
    });
  }, [scored, scenFilter, minScore, q, trendUp, fField, fMin, fMax, sort]);

  const wrap = { maxWidth: 2100, margin: '0 auto', padding: '0 16px' } as const;
  const onSort = (k: string) => setSort((s) => ({ key: k, dir: s.key === k ? (s.dir === 'asc' ? 'desc' : 'asc') : (k === 'name' || k === 'scenario' ? 'asc' : 'desc') }));
  const sArr = (k: string) => (sort.key === k ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '');
  const sStyle = (k: string, base: Record<string, any>): any => ({ ...base, cursor: 'pointer', userSelect: 'none', color: sort.key === k ? C.txt : C.muted });

  return (
    <div style={{ background: C.bg, minHeight: '100vh', color: C.txt, fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 20, background: `${C.bg}f0`, borderBottom: `1px solid ${C.line}`, backdropFilter: 'blur(8px)' }}>
        <div style={{ ...wrap, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '8px 16px' }}>
          <Link href="/" style={{ fontSize: F.sm, color: C.muted, textDecoration: 'none', fontWeight: 700 }}>← Home</Link>
          <span style={{ fontSize: F.md, fontWeight: 900, color: C.gold, letterSpacing: 0.4 }}>⚡ EARNINGS-TRIGGER ANALYZER{scope ? ' · ' + scope.toUpperCase() : ''}</span>
          {label ? <span style={{ fontSize: F.xs, color: C.dim }}>· {label} · {scored.length} stocks</span> : null}
          <Link href="/investing-os#styles" style={{ marginLeft: 'auto', fontSize: F.xs, color: C.muted, textDecoration: 'none', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>Investing OS →</Link>
        </div>
      </div>

      <div style={{ ...wrap, padding: '20px 16px 80px' }}>
        <div style={{ fontSize: F.xs, fontWeight: 800, color: C.gold, letterSpacing: 1.2, textTransform: 'uppercase' }}>Why some Q-beats become multibaggers and other beats get punished</div>
        <div style={{ fontSize: F.hero, fontWeight: 900, marginTop: 6, lineHeight: 1.1 }}>Earnings-Trigger Analyzer</div>
        <div style={{ fontSize: F.base, color: C.muted, lineHeight: 1.55, marginTop: 8, maxWidth: 1180 }}>
          Export your Screener.in watchlist and drop the CSV(s) below — <b style={{ color: C.txt }}>add several and they merge into one ranking</b>. A beat alone isn't a buy: the engine ranks what converts it — <b style={{ color: C.txt }}>acceleration × PE-cycle × margin × chart stage × quality × sponsorship</b> — into the five post-earnings scenarios (A–E).
        </div>

        {/* upload zone */}
        <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); onFile(e.dataTransfer.files); }}
          style={{ marginTop: 18, border: `2px dashed ${dragging ? C.gold : C.line2}`, background: dragging ? `${C.gold}10` : C.panel2, borderRadius: 14, padding: '20px 18px', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 280 }}>
            <div style={{ fontSize: F.md, fontWeight: 800, color: C.txt }}>{data.length ? `Loaded ${data.length} stocks from ${files.length} file${files.length === 1 ? '' : 's'}` : 'Drop your Screener.in CSV(s) here'}</div>
            <div style={{ fontSize: F.xs, color: C.dim, marginTop: 4, lineHeight: 1.5 }}>{data.length ? 'Drop or choose more exports to add — they merge and de-dupe by ticker, so you can combine several screens into one ranking.' : SAMPLE}</div>
            {files.length ? <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>{files.map((fn, i) => <span key={i} style={{ fontSize: F.xs, color: C.muted, background: C.panel, border: `1px solid ${C.line2}`, borderRadius: 999, padding: '3px 10px' }}>{fn}</span>)}</div> : null}
          </div>
          <label style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, color: '#05231a', background: C.gold, borderRadius: 8, padding: '9px 16px' }}>
            {data.length ? 'Add CSV(s)' : 'Choose CSV(s)'}<input type="file" accept=".csv,text/csv" multiple style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files); (e.target as HTMLInputElement).value = ''; }} />
          </label>
          {data.length ? <button onClick={clearAll} style={{ cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '6px 12px' }}>Clear all</button> : null}
        </div>
        {error ? <div style={{ marginTop: 10, fontSize: F.sm, color: C.red, background: `${C.red}12`, border: `1px solid ${C.red}40`, borderRadius: 8, padding: '8px 12px' }}>{error}</div> : null}

        {!data.length ? (
          <div style={{ marginTop: 22, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, padding: 18 }}>
            <div style={{ fontSize: F.lg, fontWeight: 800, marginBottom: 10 }}>The seven variables it scores</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
              {[
                ['Trigger (O’Neil C)', 'YoY quarterly PAT & sales growth — the ≥25% floor, ≥40% preferred; sales must back the profit (no cost-cut beats).'],
                ['Acceleration', 'Sequential QoQ trend of PAT & sales — 3 quarters of acceleration (Minervini). Deceleration is flagged (the Bajaj Finance trap).'],
                ['Margin trajectory', 'OPM latest vs preceding vs last-year vs 5-yr — expansion re-rates; compression on a revenue beat is punished.'],
                ['Multiple cycle (PEG)', 'PEG band + PE vs its 5-yr median + vs industry. Discount = re-rating room; PEG>2 = compression default (the HUL trap).'],
                ['Chart stage', 'Stage-2 = price above 50/200-DMA with 50>200, near 52-wk high. Below the 200-DMA (Stage-4) is penalised.'],
                ['Earnings quality', 'CFO/PAT (Buffett: <0.6 is a sell), ROCE, debt/equity, interest cover. Cash flow is fact; profit is opinion.'],
                ['Sponsorship', 'Promoter holding (>50%), pledge (penalised), and FII/DII accumulation over 3 years.'],
              ].map(([t, d], i) => (
                <div key={i} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 12 }}>
                  <div style={{ fontSize: F.sm, fontWeight: 800, color: C.teal, marginBottom: 4 }}>{t}</div>
                  <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5 }}>{d}</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: F.xs, color: C.dim, marginTop: 12, lineHeight: 1.55 }}>Two of the masterclass’s seven variables — <b style={{ color: C.muted }}>guidance language</b> and <b style={{ color: C.muted }}>sector flow</b> — can’t be read from a numbers export; apply the Concall Framework for those. This tool does the quantitative 5 of 7 and ranks accordingly.</div>
          </div>
        ) : (
          <>
            {/* scenario summary + filters */}
            <div style={{ marginTop: 18, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button onClick={() => setScenFilter('ALL')} style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, padding: '6px 12px', borderRadius: 999, border: `1px solid ${scenFilter === 'ALL' ? C.txt : C.line2}`, background: scenFilter === 'ALL' ? C.panel : 'transparent', color: scenFilter === 'ALL' ? C.txt : C.muted }}>All {scored.length}</button>
              {(['A', 'B', 'C', 'D', 'E'] as const).map((k) => (
                <button key={k} onClick={() => setScenFilter(k)} style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, padding: '6px 12px', borderRadius: 999, border: `1px solid ${scenFilter === k ? SCEN[k].c : C.line2}`, background: scenFilter === k ? `${SCEN[k].c}1f` : 'transparent', color: scenFilter === k ? SCEN[k].c : C.muted }} title={SCEN[k].tip}>{SCEN[k].label} · {counts[k]}</button>
              ))}
              <button onClick={() => setTrendUp((v) => !v)} title="Show only stocks trading above BOTH their 50-DMA and 200-DMA (Stage-2 uptrend)" style={{ cursor: 'pointer', fontSize: F.sm, fontWeight: 800, padding: '6px 12px', borderRadius: 999, border: `1px solid ${trendUp ? C.green : C.line2}`, background: trendUp ? `${C.green}1f` : 'transparent', color: trendUp ? C.green : C.muted }}>↑ Above 50 &amp; 200-DMA</button>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name / sector…" style={{ marginLeft: 'auto', fontSize: F.sm, background: C.panel2, border: `1px solid ${C.line2}`, color: C.txt, borderRadius: 8, padding: '7px 12px', minWidth: 180 }} />
              <label style={{ fontSize: F.xs, color: C.muted, display: 'flex', alignItems: 'center', gap: 6 }}>min score {minScore}<input type="range" min={0} max={90} value={minScore} onChange={(e) => setMinScore(+e.target.value)} /></label>
              <select value={fField} onChange={(e) => setFField(e.target.value)} title="Filter on any numeric field" style={{ fontSize: F.sm, background: C.panel2, border: `1px solid ${C.line2}`, color: fField ? C.txt : C.muted, borderRadius: 8, padding: '7px 10px' }}>
                <option value="">Filter field…</option>
                {NUMFIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
              {fField ? (
                <>
                  <input type="number" value={fMin} onChange={(e) => setFMin(e.target.value)} placeholder="min" style={{ width: 66, fontSize: F.sm, background: C.panel2, border: `1px solid ${C.line2}`, color: C.txt, borderRadius: 8, padding: '7px 8px' }} />
                  <input type="number" value={fMax} onChange={(e) => setFMax(e.target.value)} placeholder="max" style={{ width: 66, fontSize: F.sm, background: C.panel2, border: `1px solid ${C.line2}`, color: C.txt, borderRadius: 8, padding: '7px 8px' }} />
                  <button onClick={() => { setFField(''); setFMin(''); setFMax(''); }} title="Clear field filter" style={{ cursor: 'pointer', fontSize: F.xs, color: C.muted, background: 'transparent', border: `1px solid ${C.line2}`, borderRadius: 999, padding: '6px 10px' }}>✕</button>
                </>
              ) : null}
            </div>

            {/* leaderboard */}
            <div style={{ marginTop: 12, overflowX: 'auto', border: `1px solid ${C.line}`, borderRadius: 12 }}>
              <div style={{ minWidth: 1500 }}>
                <div style={{ display: 'flex', background: C.panel2, borderBottom: `1px solid ${C.line2}`, fontSize: F.xs, fontWeight: 800, color: C.muted, position: 'sticky', top: 0 }}>
                  <div style={{ width: 44, padding: '10px 8px' }}>#</div>
                  <div onClick={() => onSort('name')} style={sStyle('name', { flex: '0 0 220px', padding: '10px 8px' })}>Stock{sArr('name')}</div>
                  <div onClick={() => onSort('scenario')} style={sStyle('scenario', { flex: '0 0 150px', padding: '10px 8px' })}>Scenario{sArr('scenario')}</div>
                  <div onClick={() => onSort('composite')} style={sStyle('composite', { flex: '0 0 110px', padding: '10px 8px' })}>Score{sArr('composite')}</div>
                  <div style={{ flex: '0 0 250px', padding: '10px 8px' }}>7-variable breakdown</div>
                  <div onClick={() => onSort('qp')} style={sStyle('qp', { flex: '0 0 80px', padding: '10px 8px', textAlign: 'right' })}>YoY PAT{sArr('qp')}</div>
                  <div onClick={() => onSort('qs')} style={sStyle('qs', { flex: '0 0 80px', padding: '10px 8px', textAlign: 'right' })}>YoY Sales{sArr('qs')}</div>
                  <div onClick={() => onSort('peg')} style={sStyle('peg', { flex: '0 0 64px', padding: '10px 8px', textAlign: 'right' })}>PEG{sArr('peg')}</div>
                  <div onClick={() => onSort('om0')} style={sStyle('om0', { flex: '0 0 92px', padding: '10px 8px', textAlign: 'right' })}>OPM q-1→q{sArr('om0')}</div>
                  <div onClick={() => onSort('cfo')} style={sStyle('cfo', { flex: '0 0 70px', padding: '10px 8px', textAlign: 'right' })}>CFO/PAT{sArr('cfo')}</div>
                  <div onClick={() => onSort('roce')} style={sStyle('roce', { flex: '0 0 64px', padding: '10px 8px', textAlign: 'right' })}>ROCE{sArr('roce')}</div>
                  <div onClick={() => onSort('r1y')} style={sStyle('r1y', { flex: '0 0 68px', padding: '10px 8px', textAlign: 'right' })} title="Price return over the last 1 year">1Y ret{sArr('r1y')}</div>
                  <div style={{ flex: '0 0 152px', padding: '10px 8px' }} title="Minervini Stage-2 trend template: Price &gt; 200-DMA · Price &gt; 50-DMA · 50-DMA &gt; 200-DMA">Stage-2 trend</div>
                  <div style={{ flex: '1 1 200px', padding: '10px 8px' }}>Flags &amp; notes</div>
                </div>
                {shown.map((s, i) => (
                  <div key={s.nse + i} style={{ display: 'flex', borderBottom: i < shown.length - 1 ? `1px solid ${C.line}` : 'none', background: i % 2 ? C.panel2 : 'transparent', alignItems: 'center' }}>
                    <div style={{ width: 44, padding: '9px 8px', fontSize: F.sm, fontWeight: 800, color: C.dim }}>{i + 1}</div>
                    <div style={{ flex: '0 0 220px', padding: '9px 8px' }}>
                      <div style={{ fontSize: F.sm, fontWeight: 800, color: C.txt }}>{s.name}</div>
                      <div style={{ fontSize: F.xs, color: C.dim }}>{s.nse} · {s.industry} · {fmtCr(s.mcap)}</div>
                    </div>
                    <div style={{ flex: '0 0 150px', padding: '9px 8px' }}><span title={SCEN[s.scenario].tip} style={{ fontSize: F.xs, fontWeight: 800, color: SCEN[s.scenario].c, border: `1px solid ${SCEN[s.scenario].c}66`, background: `${SCEN[s.scenario].c}14`, borderRadius: 6, padding: '2px 7px' }}>{SCEN[s.scenario].label}</span></div>
                    <div style={{ flex: '0 0 110px', padding: '9px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: F.md, fontWeight: 900, color: band(s.composite / 100), minWidth: 26 }}>{s.composite}</span>
                      <div style={{ flex: 1, height: 7, background: C.panel, borderRadius: 4, overflow: 'hidden', border: `1px solid ${C.line}` }}><div style={{ width: `${s.composite}%`, height: '100%', background: band(s.composite / 100) }} /></div>
                    </div>
                    <div style={{ flex: '0 0 250px', padding: '9px 8px', display: 'flex', gap: 4 }}>
                      {VARS.map((v) => { const val = s.subs[v.k]; return (
                        <div key={v.k} title={`${v.label}: ${Math.round(val * 100)}`} style={{ flex: 1, textAlign: 'center' }}>
                          <div style={{ height: 26, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}><div style={{ width: 12, height: `${Math.max(8, val * 26)}px`, background: v.color, opacity: 0.4 + val * 0.6, borderRadius: 2 }} /></div>
                          <div style={{ fontSize: 9, color: C.dim, marginTop: 2 }}>{v.label.slice(0, 4)}</div>
                        </div>
                      ); })}
                    </div>
                    <div style={{ flex: '0 0 80px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.qp) ? C.dim : s.qp < 0 ? C.red : s.qp >= 25 ? C.green : C.txt }} title={isNaN(s.qp) ? '' : s.qp.toFixed(1) + '%'}>{fmtPct(s.qp)}</div>
                    <div style={{ flex: '0 0 80px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.qs) ? C.dim : s.qs < 0 ? C.red : C.muted }} title={isNaN(s.qs) ? '' : s.qs.toFixed(1) + '%'}>{fmtPct(s.qs)}</div>
                    <div style={{ flex: '0 0 64px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: !s.pegNM ? C.dim : (s.peg < 1.5) ? C.green : s.peg >= 2 ? C.red : C.muted }} title={!s.pegNM ? 'PEG not meaningful (loss / negative growth / extreme magnitude) — judged on PE-vs-history instead' : ''}>{!s.pegNM ? 'n/m' : s.peg.toFixed(2)}</div>
                    <div style={{ flex: '0 0 92px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: (Math.abs(s.om0) <= 120 && Math.abs(s.om1) <= 120) ? (s.om0 > s.om1 ? C.green : s.om0 < s.om1 ? C.red : C.muted) : C.dim }} title={`${isNaN(s.om1) ? '—' : s.om1.toFixed(1)} → ${isNaN(s.om0) ? '—' : s.om0.toFixed(1)} (OPM %)`}>{fmtOPM(s.om1)}→{fmtOPM(s.om0)}</div>
                    <div style={{ flex: '0 0 70px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.cfo) ? C.dim : (s.cfo < 0 || s.cfo > 6) ? C.amber : s.cfo >= 0.8 ? C.green : s.cfo < 0.6 ? C.red : C.amber }} title={isNaN(s.cfo) ? '' : (Math.abs(s.cfo) > 20 ? 'CFO/PAT ' + s.cfo.toFixed(1) + ' — near-zero PAT distorts this; treated as suspect, not clean quality' : s.cfo.toFixed(2))}>{fmtCFO(s.cfo)}</div>
                    <div style={{ flex: '0 0 64px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.roce) ? C.dim : s.roce >= 15 ? C.green : C.muted }}>{isNaN(s.roce) ? '—' : s.roce.toFixed(0) + '%'}</div>
                    <div style={{ flex: '0 0 68px', padding: '9px 8px', textAlign: 'right', fontSize: F.sm, color: isNaN(s.r1y) ? C.dim : s.r1y < 0 ? C.red : C.green }} title={isNaN(s.r1y) ? '' : s.r1y.toFixed(1) + '%'}>{fmtPct(s.r1y)}</div>
                    <div style={{ flex: '0 0 152px', padding: '9px 8px', display: 'flex', gap: 3, alignItems: 'center' }}>
                      {([['P>200', s.trend.p200, 'Price above 200-DMA'], ['P>50', s.trend.p50, 'Price above 50-DMA'], ['50>200', s.trend.d5020, '50-DMA above 200-DMA']] as const).map(([lab, v, tip], j) => (
                        <span key={j} title={tip} style={{ fontSize: 10, fontWeight: 800, padding: '2px 5px', borderRadius: 5, whiteSpace: 'nowrap', color: v === 'y' ? C.green : v === 'n' ? C.red : C.dim, border: `1px solid ${v === 'y' ? C.green + '55' : v === 'n' ? C.red + '40' : C.line}`, background: v === 'y' ? `${C.green}14` : v === 'n' ? `${C.red}10` : 'transparent' }}>{lab} {v === 'y' ? '✓' : v === 'n' ? '✗' : '–'}</span>
                      ))}
                    </div>
                    <div style={{ flex: '1 1 200px', padding: '9px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>{s.flags.map((fl, j) => <span key={'f' + j} style={{ fontSize: 10, color: C.red, border: `1px solid ${C.red}40`, background: `${C.red}10`, borderRadius: 5, padding: '1px 5px' }}>{fl}</span>)}{s.notes.map((nt, j) => { const pos = /expanding/i.test(nt); const col = pos ? C.green : C.amber; return <span key={'n' + j} style={{ fontSize: 10, color: col, border: `1px solid ${col}40`, background: `${col}10`, borderRadius: 5, padding: '1px 5px' }}>{nt}</span>; })}{(!s.flags.length && !s.notes.length) ? <span style={{ fontSize: 10, color: C.dim }}>—</span> : null}</div>
                  </div>
                ))}
                {!shown.length ? <div style={{ padding: 20, fontSize: F.sm, color: C.muted, textAlign: 'center' }}>No stocks match the current filter.</div> : null}
              </div>
            </div>
            <div style={{ marginTop: 14, fontSize: F.xs, color: C.dim, lineHeight: 1.6 }}>
              Ranking is a quantitative screen of 5 of the masterclass’s 7 variables — it tells you WHERE to do the work, not what to buy. Confirm guidance language + sector flow via the concall, and remember: never buy a new position on result day, never hold past two disappointing quarters. Not investment advice; figures are as per your uploaded sheet.
            </div>
          </>
        )}

        {/* Do-the-work checklist — collapsible, lives below everything so it never disturbs the table/visualisation */}
        <div style={{ marginTop: 22, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <button onClick={() => setShowGuide((v) => !v)} style={{ width: '100%', cursor: 'pointer', background: 'transparent', border: 'none', color: C.txt, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', textAlign: 'left' }}>
            <span style={{ fontSize: F.lg, fontWeight: 800 }}>📋 Do-the-work checklist — guidance, sector flow, re-rating triggers, traps & worked examples</span>
            <span style={{ marginLeft: 'auto', fontSize: F.sm, fontWeight: 800, color: showGuide ? C.gold : C.muted }}>{showGuide ? 'Hide ▲' : 'Show ▼'}</span>
          </button>
          {showGuide ? (
            <div style={{ padding: '0 16px 18px' }}>
              <div style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.55, marginBottom: 14 }}>The ranking scores 5 of the 7 variables from your sheet. The two it can’t read — <b style={{ color: C.teal }}>guidance language</b> and <b style={{ color: C.violet }}>sector flow</b> — plus the post-earnings discipline are below. Run this against any name before you act on it.</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 12 }}>
                {GUIDE.map((g, i) => (
                  <div key={i} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 10, padding: 14 }}>
                    <div style={{ fontSize: F.md, fontWeight: 800, color: g.color, lineHeight: 1.3 }}>{g.title}</div>
                    <div style={{ fontSize: F.xs, color: C.dim, margin: '3px 0 9px' }}>{g.tag}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 7 }}>
                      {g.items.map((it, j) => <li key={j} style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5 }}>{it}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* How it's scored & classified — the engine's exact criteria, so an empty bucket is legible */}
        <div style={{ marginTop: 12, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 12, overflow: 'hidden' }}>
          <button onClick={() => setShowRules((v) => !v)} style={{ width: '100%', cursor: 'pointer', background: 'transparent', border: 'none', color: C.txt, display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px', textAlign: 'left' }}>
            <span style={{ fontSize: F.lg, fontWeight: 800 }}>📐 How the score &amp; A–E scenarios are computed — the exact criteria</span>
            <span style={{ marginLeft: 'auto', fontSize: F.sm, fontWeight: 800, color: showRules ? C.gold : C.muted }}>{showRules ? 'Hide ▲' : 'Show ▼'}</span>
          </button>
          {showRules ? (
            <div style={{ padding: '0 16px 18px' }}>
              <div style={{ fontSize: F.md, fontWeight: 800, color: C.txt, marginBottom: 8 }}>The 0–100 score — weighted blend of 7 sub-scores</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 8, marginBottom: 8 }}>
                {WEIGHTS.map((w, i) => (
                  <div key={i} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 9, padding: '9px 11px', display: 'flex', gap: 10, alignItems: 'baseline' }}>
                    <span style={{ fontSize: F.base, fontWeight: 900, color: w.color, minWidth: 38 }}>{w.w}%</span>
                    <span><b style={{ color: C.txt, fontSize: F.sm }}>{w.k}</b> <span style={{ fontSize: F.xs, color: C.muted, lineHeight: 1.45 }}>— {w.desc}</span></span>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: F.xs, color: C.dim, lineHeight: 1.55, marginBottom: 16 }}>Then hard red flags <i>multiply</i> the score down: CFO/PAT &lt; 0.6 ×0.7 · pledge &gt; 25% ×0.6 · (debt/equity &gt; 2 with interest-cover &lt; 1.5) ×0.7. Garbage prints (CFO/PAT, OPM, PEG beyond sane bounds) are shown as “n/m” and don’t score.</div>

              <div style={{ fontSize: F.md, fontWeight: 800, color: C.txt, marginBottom: 8 }}>How each stock is labelled A–E (checked in this order)</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {CLASSIFY.map((c, i) => (
                  <div key={i} style={{ background: C.panel2, border: `1px solid ${c.color}40`, borderLeft: `3px solid ${c.color}`, borderRadius: 8, padding: '9px 12px' }}>
                    <span style={{ fontSize: F.sm, fontWeight: 800, color: c.color }}>{c.k}</span>
                    <span style={{ fontSize: F.sm, color: C.muted, lineHeight: 1.5 }}> — {c.rule}</span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 12, fontSize: F.sm, color: C.muted, background: `${C.amber}10`, border: `1px solid ${C.amber}40`, borderRadius: 8, padding: '10px 12px', lineHeight: 1.55 }}>
                <b style={{ color: C.amber }}>Why “Avoid” can be 0:</b> E only fires on genuine deterioration. A clean watchlist of beats has no stock with contracting profit + a weakness, so E is correctly empty — that’s the screen working, not a bug. Load a broader list that includes losers and E populates (your earlier 153-name file had Valor −371%, Meesho −56%, Mah. Seamless −57% → all E).
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
