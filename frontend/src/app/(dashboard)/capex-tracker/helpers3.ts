// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { VERDICT_COLOR, C, TRANSCRIPT_CAP, CO_STOP } from './constants';
import { parseFin } from './helpers';
import { type Scored, type MBResult, type FXResult, type CCState, type Verdict, type Row } from './types';

export function computeVerdict(s: Scored, mb: MBResult, fx: FXResult, cc: CCState | null): Verdict {
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
export function parseCSV(text: string): Row[] {
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
export function loadSheetJS(): Promise<any> {
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
export function loadPdfJs(): Promise<any> {
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
export function loadJSZip(): Promise<any> {
  return new Promise((resolve, reject) => {
    const w = window as any;
    if (w.JSZip) return resolve(w.JSZip);
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
    s.onload = () => resolve(w.JSZip); s.onerror = reject;
    document.head.appendChild(s);
  });
}
 // same 300k-char cap as the paste path
export const capTranscript = (raw: string): string =>
  raw.length > TRANSCRIPT_CAP ? raw.slice(0, TRANSCRIPT_CAP - 60) + '\n\n[… truncated at the 300k-char transcript cap]' : raw;
export async function extractPdfText(buf: ArrayBuffer): Promise<string> {
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
export async function extractPptxText(buf: ArrayBuffer): Promise<string> {
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
export function findPeriod(s: string): string | null {
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
export function transcriptLabel(fname: string, textHead: string): string {
  const base = fname.replace(/\.(pdf|pptx?|txt)$/i, '').replace(/[-_]+/g, ' ').trim();
  const d = findPeriod(base) || findPeriod(textHead);
  return d ? d + ' · ' + base : base + ' · ' + new Date().toLocaleDateString();
}
export function matchCompanies(names: string[], fname: string, textHead: string): string[] {
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
export const uid = () => String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7);
// ── Screener.in workbook parser ─────────────────────────────────────────────
// Mines the "Data Sheet" raw values: quantitative factors, capex telemetry,
// history (prior cycles, funding, utilization proxies) and the Framework
// cross-checks (Net Debt/EBITDA, cycle-capex vs pre-capex revenue). Fields it
// can only estimate are emitted ONLY as '... (est)' — never as empty clean
// headers (so estimates can't be shadowed). Manual edits write clean headers
// and always win.
export function parseScreenerWorkbook(XLSX: any, wb: any, fname: string): Row | null {
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
