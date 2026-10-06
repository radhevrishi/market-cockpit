// Moved verbatim out of page.tsx (pure refactor, no behaviour change).
import { FX_GRADE_COLOR, C, ABBR_END } from './constants';
import { lastNN, sumLast, av, firstNN } from './helpers';
import { type Fin, type Row, type FXResult, type FXCheck, type ConcallExtract } from './types';

// ── 🔬 FORENSICS — 12 checks, higher = cleaner ──────────────────────────────
export function computeForensic(fin: Fin | null, r: Row): FXResult {
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
export const upperFrac = (s: string): number => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters.length) return 1;
  return letters.replace(/[^A-Z]/g, '').length / letters.length;
};
export function transcriptSentences(text: string): string[] {
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
export function extractConcall(text: string): ConcallExtract {
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
