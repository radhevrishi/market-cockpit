// zzz939 — India company figures for the screener, from one screener.in company page plus three of its small "schedule" answers
// (the expense split, the year's expense split and the other-assets split). Pure: the server fetches (lib/screener/in-build.ts).
//
// Every figure is read from a table cell; growth is one cell against another. Notes on the rougher ones:
//   • gross profit / gross margin: Indian results do not print gross profit. Here it is sales × (1 − "Material Cost %"), screener.in's
//     raw-material share of sales. A service company has no material cost → no gross margin (the filter then fails for it);
//   • F-score: the 9 standard Piotroski checks on the latest two years; "current ratio" uses other assets ÷ other liabilities;
//   • EBITDA = screener.in "Operating Profit" (before other income).
import { parseSection } from '../thesis/screener-financials';
import { parseTopRatios } from '../ai-gainers/screener-company';

type Table = NonNullable<ReturnType<typeof parseSection>>;
export interface InSchedules { expQ?: unknown; expA?: unknown; otherAssets?: unknown }
export interface InFigures {
  q: string | null;               // latest quarter, e.g. 'Jun 2026'
  revQYoY: number | null; revAYoY: number | null; gpQYoY: number | null; gmFY: number | null;
  ebitdaQoQ: number | null; ebitdaAYoY: number | null; epsQYoY: number | null; opmTTM: number | null;
  salesTTM: number | null; borrowings: number | null; cash: number | null; de: number | null; fs: number | null;
  shares: number | null;          // crore shares = market cap ÷ price as printed (to value the company at today's close)
  sector: string | null; industry: string | null; name: string | null;
  approx: string[];
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const g = (a: number | null | undefined, b: number | null | undefined): number | null => (fin(a) && fin(b) && b > 0 ? r1((a / b - 1) * 100) : null);
function row(t: Table | null, ...labels: string[]): (number | null)[] | null {
  if (!t) return null;
  for (const l of labels) { const k = Object.keys(t.rows).find((x) => x.replace(/\s+/g, ' ').toLowerCase() === l.toLowerCase()); if (k) return t.rows[k]; }
  return null;
}
const MONTHS: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const monthIndex = (h: string): number | null => { const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(h.trim()); return m && m[1] in MONTHS ? Number(m[2]) * 12 + MONTHS[m[1]] : null; };
/** the column holding the period `monthsBack` months before column i (same header style), or -1 */
function colBack(headers: string[], i: number, monthsBack: number): number {
  const m = monthIndex(headers[i] || '');
  if (m == null) return -1;
  return headers.findIndex((h) => monthIndex(h) === m - monthsBack);
}
/** screener.in schedule answer → { 'Material Cost %': { 'Jun 2026': 63 } } */
function sched(raw: unknown, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  const r = raw && typeof raw === 'object' ? (raw as any)[key] : null;
  if (!r || typeof r !== 'object') return out;
  for (const [k, v] of Object.entries(r)) { const n = parseFloat(String(v).replace(/[,%]/g, '')); if (monthIndex(k) != null && Number.isFinite(n)) out[k] = n; }
  // a material cost under 1% of sales is a service business (a bank, a software company): it has no gross margin in this sense
  if (key === 'Material Cost %') for (const k of Object.keys(out)) if (out[k] < 1) delete out[k];
  return out;
}

export function inFigures(html: string, s: InSchedules = {}): InFigures {
  const approx: string[] = [];
  const out: InFigures = { q: null, revQYoY: null, revAYoY: null, gpQYoY: null, gmFY: null, ebitdaQoQ: null, ebitdaAYoY: null, epsQYoY: null, opmTTM: null, salesTTM: null, borrowings: null, cash: null, de: null, fs: null, shares: null, sector: null, industry: null, name: null, approx };
  const tag = (t: string) => { const m = new RegExp(`title="${t}">([^<]+)<`).exec(html); return m ? m[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null; };
  out.sector = tag('Sector'); out.industry = tag('Industry');
  const h1 = /<h1[^>]*>([^<]+)<\/h1>/.exec(html); out.name = h1 ? h1[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null;
  const top = parseTopRatios(html);
  if (fin(top.price) && top.price > 0 && fin(top.marketCapCr) && top.marketCapCr > 0) out.shares = top.marketCapCr / top.price;

  // ── quarters ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  const Q = parseSection(html, 'quarters');
  if (Q) {
    const H = Q.headers;
    const sales = row(Q, 'Sales', 'Revenue'), op = row(Q, 'Operating Profit', 'Financing Profit'), eps = row(Q, 'EPS in Rs');
    let L = -1;
    for (let i = H.length - 1; i >= 0; i--) if (monthIndex(H[i]) != null && fin(sales?.[i])) { L = i; break; }
    if (L >= 0 && sales) {
      out.q = H[L];
      const Y = colBack(H, L, 12), P = colBack(H, L, 3);
      out.revQYoY = Y >= 0 ? g(sales[L], sales[Y]) : null;
      if (eps && Y >= 0) out.epsQYoY = g(eps[L], eps[Y]);
      if (op && P >= 0) out.ebitdaQoQ = g(op[L], op[P]);
      const last4 = [L, colBack(H, L, 3), colBack(H, L, 6), colBack(H, L, 9)];
      if (last4.every((i) => i >= 0 && fin(sales[i]))) {
        out.salesTTM = r1(last4.reduce((a, i) => a + (sales[i] as number), 0));
        if (op && last4.every((i) => fin(op[i])) && out.salesTTM > 0) out.opmTTM = r1((last4.reduce((a, i) => a + (op[i] as number), 0) / out.salesTTM) * 100);
      }
      const mat = sched(s.expQ, 'Material Cost %');
      if (Y >= 0 && fin(mat[H[L]]) && fin(mat[H[Y]]) && fin(sales[Y])) {
        out.gpQYoY = g((sales[L] as number) * (1 - mat[H[L]] / 100), (sales[Y] as number) * (1 - mat[H[Y]] / 100));
        approx.push('gpQYoY');
      }
    }
  }

  // ── years ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const A = parseSection(html, 'profit-loss');
  const BS = parseSection(html, 'balance-sheet');
  const CF = parseSection(html, 'cash-flow');
  const matA = sched(s.expA, 'Material Cost %');
  if (A) {
    const H = A.headers;
    const sales = row(A, 'Sales', 'Revenue'), op = row(A, 'Operating Profit', 'Financing Profit'), np = row(A, 'Net Profit');
    let a = -1;
    for (let i = H.length - 1; i >= 0; i--) if (monthIndex(H[i]) != null && fin(sales?.[i])) { a = i; break; }
    const b = a >= 0 ? colBack(H, a, 12) : -1;
    if (a >= 0 && b >= 0 && sales) {
      out.revAYoY = g(sales[a], sales[b]);
      if (op) out.ebitdaAYoY = g(op[a], op[b]);
      if (fin(matA[H[a]])) { out.gmFY = r1(100 - matA[H[a]]); approx.push('gmFY'); }
      // Piotroski F-score on years a and b (balance sheet and cash flow at the same year-ends)
      if (BS && CF && np) {
        const col = (t: Table, h: string) => t.headers.indexOf(h);
        const ba = col(BS, H[a]), bb = col(BS, H[b]), ca = col(CF, H[a]);
        const ta = row(BS, 'Total Assets'), bor = row(BS, 'Borrowings'), eqc = row(BS, 'Equity Capital'), oa = row(BS, 'Other Assets'), ol = row(BS, 'Other Liabilities');
        const cfo = row(CF, 'Cash from Operating Activity');
        if (ba >= 0 && bb >= 0 && ca >= 0 && ta && cfo && fin(ta[ba]) && fin(ta[bb]) && (ta[ba] as number) > 0 && (ta[bb] as number) > 0 && fin(np[a]) && fin(np[b]) && fin(cfo[ca])) {
          const TA1 = ta[ba] as number, TA0 = ta[bb] as number, NP1 = np[a] as number, NP0 = np[b] as number, CFO1 = cfo[ca] as number;
          let pts = 0, known = 0;
          const chk = (ok: boolean | null) => { if (ok == null) return; known++; if (ok) pts++; };
          chk(NP1 > 0);
          chk(CFO1 > 0);
          chk(NP1 / TA1 > NP0 / TA0);
          chk(CFO1 > NP1);
          chk(bor && fin(bor[ba]) && fin(bor[bb]) ? (bor[ba] as number) / TA1 <= (bor[bb] as number) / TA0 : null);
          chk(oa && ol && fin(oa[ba]) && fin(oa[bb]) && fin(ol[ba]) && fin(ol[bb]) && (ol[ba] as number) > 0 && (ol[bb] as number) > 0 ? (oa[ba] as number) / (ol[ba] as number) > (oa[bb] as number) / (ol[bb] as number) : null);
          chk(eqc && fin(eqc[ba]) && fin(eqc[bb]) ? (eqc[ba] as number) <= (eqc[bb] as number) : null);
          const gm1 = fin(matA[H[a]]) ? 100 - matA[H[a]] : null, gm0 = fin(matA[H[b]]) ? 100 - matA[H[b]] : null;
          chk(gm1 != null && gm0 != null ? gm1 > gm0 : op && fin(op[a]) && fin(op[b]) && fin(sales[a]) && fin(sales[b]) && (sales[a] as number) > 0 && (sales[b] as number) > 0 ? (op[a] as number) / (sales[a] as number) > (op[b] as number) / (sales[b] as number) : null);
          chk(fin(sales[a]) && fin(sales[b]) ? (sales[a] as number) / TA1 > (sales[b] as number) / TA0 : null);
          if (known >= 8) { out.fs = known === 9 ? pts : r1((pts * 9) / known); if (known < 9 || gm1 == null) approx.push('fs'); }
        }
      }
    }
  }

  // ── balance sheet: the newest column (often a half-year) ────────────────────────────────────────────────────────────
  if (BS) {
    const H = BS.headers;
    let c = -1;
    const bor = row(BS, 'Borrowings'), eqc = row(BS, 'Equity Capital'), res = row(BS, 'Reserves');
    for (let i = H.length - 1; i >= 0; i--) if (monthIndex(H[i]) != null && fin(eqc?.[i])) { c = i; break; }
    if (c >= 0) {
      const debt = bor && fin(bor[c]) ? (bor[c] as number) : 0;
      out.borrowings = debt;
      const eq = (eqc?.[c] ?? 0) + (res?.[c] ?? 0);
      out.de = eq > 0 ? Math.round((debt / eq) * 100) / 100 : 99;
      const cash = sched(s.otherAssets, 'Cash Equivalents');
      if (fin(cash[H[c]])) out.cash = cash[H[c]];
      else { const ks = Object.keys(cash).sort((x, y) => (monthIndex(y) ?? 0) - (monthIndex(x) ?? 0)); if (ks.length) out.cash = cash[ks[0]]; }
    }
  }
  return out;
}
