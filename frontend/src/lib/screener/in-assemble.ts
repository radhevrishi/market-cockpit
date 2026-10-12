// zzz939 — India company figures for the screener, from one screener.in company page plus three of its small "schedule" answers
// (the expense split, the year's expense split and the other-assets split). Pure: the server fetches (lib/screener/in-build.ts).
// zzz948 — the page is boiled down to the few table rows we use (InRaw) and THAT is stored, so a new figure or a fixed formula
// takes effect at the next build without reading 2,500 pages again. The figures are worked out from it (inFiguresFromRaw).
//
// Every figure is read from a table cell; growth is one cell against another. Notes on the rougher ones:
//   • gross profit / gross margin: Indian results do not print gross profit. zzz948: sales − (material + manufacturing + employee
//     cost, screener.in's expense split) − depreciation — TradingView's figure within ~1 point for most companies (checked on 80);
//   • F-score: the 9 standard Piotroski checks on the latest two years; "current ratio" uses other assets ÷ other liabilities;
//   • EBITDA = screener.in "Operating Profit" (before other income); operating margin (as TradingView's) = after depreciation;
//   • "latest quarter" balance-sheet figures (debt/equity, net debt, liabilities, ROE TTM…) exist only when a balance sheet was
//     published for the latest quarter — Indian companies publish one twice a year. TradingView leaves them empty too.
import { parseSection } from '../thesis/screener-financials';
import { parseTopRatios, parseAnnouncements } from '../ai-gainers/screener-company';

type Table = NonNullable<ReturnType<typeof parseSection>>;
export interface InSchedules { expQ?: unknown; expA?: unknown; otherAssets?: unknown }

/** What is kept from one company page (a few KB). */
export interface InRaw {
  v: 2;
  name: string | null; sector: string | null; industry: string | null;
  bse: boolean;                      // also listed on BSE (the page shows a BSE code)
  price: number | null; mcapCr: number | null; roce: number | null;   // the page's top ratios
  T: { q: Table | null; a: Table | null; bs: Table | null; cf: Table | null; r: Table | null };
  /** cost of sales as % of sales per period: material + manufacturing + employee cost (screener.in's expense split) */
  cogsQ: Record<string, number>; cogsA: Record<string, number>; cash: Record<string, number>;
  ann: Array<{ d: string; s: string }>;   // results announcements (date, subject), newest first
}

export interface InFigures {
  q: string | null;               // latest quarter, e.g. 'Jun 2026'
  revQYoY: number | null; revAYoY: number | null; gpQYoY: number | null; gmFY: number | null;
  ebitdaQoQ: number | null; ebitdaAYoY: number | null; epsQYoY: number | null; opmTTM: number | null;
  salesTTM: number | null; borrowings: number | null; cash: number | null; de: number | null; fs: number | null;
  shares: number | null;          // crore shares = market cap ÷ price as printed (to value the company at today's close)
  sector: string | null; industry: string | null; name: string | null;
  approx: string[];
  // zzz948
  bse: boolean; earnD: string | null;   // latest results announcement (ISO date) when the page lists it
  revTTMYoY: number | null; epsTTMYoY: number | null; gpAYoY: number | null; ebitdaTTMYoY: number | null; ebitdaQYoY: number | null;
  nmTTM: number | null; ptmTTM: number | null; opmFY: number | null; npTTM: number | null; niFY: number | null;   // ₹ crore
  roeTTM: number | null; roeFY: number | null; roceTTM: number | null; roceFY: number | null;
  deFY: number | null; netDebt: number | null; liabQ: number | null; liabA: number | null;
  debtAssetsQ: number | null; debtAssetsA: number | null; debtCapQ: number | null; debtCapA: number | null;
  debtEbitdaQ: number | null; debtEbitdaA: number | null;
  /** zzz984 — free-cash-flow margin of the latest full year, ≈ (cash from operations + cash from investing) ÷ sales; screener.in's
   *  page prints no capex line, and pages read before zzz984 kept no investing line (blank until re-read) */
  fcfmFY?: number | null;
}

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r2 = (v: number) => Math.round(v * 100) / 100;
// growth as TradingView works it: (now − before) ÷ |before| (a loss shrinking from −10 to −4 = +60%); none from a zero base and
// none when a loss turns into a profit (TradingView leaves that empty)
const g = (a: number | null | undefined, b: number | null | undefined): number | null => (fin(a) && fin(b) && b !== 0 && !(b < 0 && a > 0) ? r1(((a - b) / Math.abs(b)) * 100) : null);
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
/** screener.in schedule answer → { 'Jun 2026': 63 } for one line (e.g. 'Material Cost %') */
function sched(raw: unknown, key: string): Record<string, number> {
  const out: Record<string, number> = {};
  const r = raw && typeof raw === 'object' ? (raw as any)[key] : null;
  if (!r || typeof r !== 'object') return out;
  for (const [k, v] of Object.entries(r)) { const n = parseFloat(String(v).replace(/[,%]/g, '')); if (monthIndex(k) != null && Number.isFinite(n)) out[k] = n; }
  return out;
}
/** cost of sales % per period = material + manufacturing + employee cost % (whichever of the three are given; none → no entry) */
function cogsPct(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const line of ['Material Cost %', 'Manufacturing Cost %', 'Employee Cost %']) for (const [k, v] of Object.entries(sched(raw, line))) out[k] = (out[k] || 0) + v;
  return out;
}
/** keep only the rows the figures use */
function trim(t: Table | null, keep: string[]): Table | null {
  if (!t) return null;
  const rows: Table['rows'] = {};
  for (const [k, v] of Object.entries(t.rows)) if (keep.includes(k.replace(/\s+/g, ' ').toLowerCase())) rows[k] = v;
  return { headers: t.headers, rows };
}
const PL_ROWS = ['sales', 'revenue', 'operating profit', 'financing profit', 'depreciation', 'profit before tax', 'net profit', 'eps in rs'];
const BS_ROWS = ['equity capital', 'reserves', 'borrowings', 'borrowing', 'other liabilities', 'total assets', 'other assets', 'deposits'];
/** A results filing — not the notice that a board meeting will consider results. */
const RESULTS_RE = /financial results|\bresults\b.*(quarter|half|year|period)|un-?audited|audited (standalone|consolidated)/i;
const NOT_RESULTS_RE = /intimation|to consider|will be held|is scheduled|prior notice|trading window|newspaper/i;

export function rawFromHtml(html: string, s: InSchedules = {}): InRaw {
  const tag = (t: string) => { const m = new RegExp(`title="${t}">([^<]+)<`).exec(html); return m ? m[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null; };
  const h1 = /<h1[^>]*>([^<]+)<\/h1>/.exec(html);
  const top = parseTopRatios(html);
  const roceM = /<span class="name">\s*ROCE\s*<\/span>[\s\S]*?<span class="number">([^<]*)<\/span>/.exec(html);
  const roce = roceM ? parseFloat(roceM[1].replace(/,/g, '')) : NaN;
  let ann: Array<{ d: string; s: string }> = [];
  try {
    ann = parseAnnouncements(html)
      .filter((a) => a.dateIso && (RESULTS_RE.test(a.subject) || (/board meeting outcome|outcome of board meeting/i.test(a.subject) && /results/i.test(a.summary || ''))) && !NOT_RESULTS_RE.test(a.subject))
      .map((a) => ({ d: String(a.dateIso).slice(0, 10), s: a.subject.slice(0, 120) }))
      .slice(0, 3);
  } catch { /* no announcements block */ }
  return {
    v: 2,
    name: h1 ? h1[1].replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : null, sector: tag('Sector'), industry: tag('Industry'),
    bse: /BSE:\s*\d{6}/.test(html),
    price: fin(top.price) ? top.price : null, mcapCr: fin(top.marketCapCr) ? top.marketCapCr : null, roce: Number.isFinite(roce) ? roce : null,
    T: {
      q: trim(parseSection(html, 'quarters'), PL_ROWS), a: trim(parseSection(html, 'profit-loss'), PL_ROWS), bs: trim(parseSection(html, 'balance-sheet'), BS_ROWS),
      cf: trim(parseSection(html, 'cash-flow'), ['cash from operating activity', 'cash from investing activity']), r: trim(parseSection(html, 'ratios'), ['roce %']),
    },
    cogsQ: cogsPct(s.expQ), cogsA: cogsPct(s.expA), cash: sched(s.otherAssets, 'Cash Equivalents'),
    ann,
  };
}

/** All figures from one company page (kept for the tests and older callers). */
export function inFigures(html: string, s: InSchedules = {}): InFigures { return inFiguresFromRaw(rawFromHtml(html, s)); }

export function inFiguresFromRaw(raw: InRaw): InFigures {
  const approx: string[] = [];
  const out: InFigures = {
    q: null, revQYoY: null, revAYoY: null, gpQYoY: null, gmFY: null, ebitdaQoQ: null, ebitdaAYoY: null, epsQYoY: null, opmTTM: null, salesTTM: null,
    borrowings: null, cash: null, de: null, fs: null, shares: null, sector: raw.sector, industry: raw.industry, name: raw.name, approx,
    bse: !!raw.bse, earnD: raw.ann?.[0]?.d ?? null,
    revTTMYoY: null, epsTTMYoY: null, gpAYoY: null, ebitdaTTMYoY: null, ebitdaQYoY: null, nmTTM: null, ptmTTM: null, opmFY: null, npTTM: null, niFY: null,
    roeTTM: null, roeFY: null, roceTTM: null, roceFY: null, deFY: null, netDebt: null, liabQ: null, liabA: null,
    debtAssetsQ: null, debtAssetsA: null, debtCapQ: null, debtCapA: null, debtEbitdaQ: null, debtEbitdaA: null,
  };
  if (fin(raw.price) && raw.price > 0 && fin(raw.mcapCr) && raw.mcapCr > 0) out.shares = raw.mcapCr / raw.price;
  const { q: Q, a: A, bs: BS, cf: CF, r: R } = raw.T;
  const cogsQ = raw.cogsQ || {}, cogsA = raw.cogsA || {};
  // gross profit as TradingView has it for Indian companies (checked on 80: median gap 0.8 points of margin):
  // sales − (material + manufacturing + employee cost) − depreciation
  const gpOf = (sales: number | null | undefined, cogs: number | undefined, dep: number | null | undefined): number | null =>
    fin(sales) && fin(cogs) ? sales * (1 - cogs / 100) - (fin(dep) ? dep : 0) : null;
  const sum = (arr: (number | null)[] | null, cols: number[]) => (arr && cols.every((i) => i >= 0 && fin(arr[i])) ? cols.reduce((x, i) => x + (arr[i] as number), 0) : null);

  // balance sheet columns: equity, debt, liabilities and assets at one date
  const bsAt = (h: string | null) => {
    if (!BS || !h) return null;
    const c = BS.headers.indexOf(h);
    if (c < 0) return null;
    const eqc = row(BS, 'Equity Capital'), res = row(BS, 'Reserves'), bor = row(BS, 'Borrowings', 'Borrowing'), ol = row(BS, 'Other Liabilities'), ta = row(BS, 'Total Assets'), dep = row(BS, 'Deposits');
    if (!eqc || !fin(eqc[c])) return null;
    const eq = (eqc[c] as number) + (fin(res?.[c]) ? (res![c] as number) : 0);
    const debt = fin(bor?.[c]) ? (bor![c] as number) : 0;
    const liab = debt + (fin(ol?.[c]) ? (ol![c] as number) : 0) + (fin(dep?.[c]) ? (dep![c] as number) : 0);
    return { eq, debt, liab, assets: fin(ta?.[c]) ? (ta![c] as number) : null };
  };
  const ratiosOf = (b: NonNullable<ReturnType<typeof bsAt>>) => ({
    de: b.eq > 0 ? r2(b.debt / b.eq) : 99,
    debtAssets: b.assets != null && b.assets > 0 ? r2(b.debt / b.assets) : null,
    debtCap: b.debt + b.eq > 0 ? r2(b.debt / (b.debt + b.eq)) : null,
  });

  // ── quarters ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  let opTTM: number | null = null, qHeader: string | null = null;
  if (Q) {
    const H = Q.headers;
    const sales = row(Q, 'Sales', 'Revenue'), op = row(Q, 'Operating Profit', 'Financing Profit'), eps = row(Q, 'EPS in Rs');
    const dep = row(Q, 'Depreciation'), pbt = row(Q, 'Profit before tax'), np = row(Q, 'Net Profit');
    let L = -1;
    for (let i = H.length - 1; i >= 0; i--) if (monthIndex(H[i]) != null && fin(sales?.[i])) { L = i; break; }
    if (L >= 0 && sales) {
      out.q = qHeader = H[L];
      const Y = colBack(H, L, 12), P = colBack(H, L, 3);
      out.revQYoY = Y >= 0 ? g(sales[L], sales[Y]) : null;
      if (eps && Y >= 0) out.epsQYoY = g(eps[L], eps[Y]);
      if (op && P >= 0) out.ebitdaQoQ = g(op[L], op[P]);
      if (op && Y >= 0) out.ebitdaQYoY = g(op[L], op[Y]);
      const last4 = [L, colBack(H, L, 3), colBack(H, L, 6), colBack(H, L, 9)];
      const prev4 = [colBack(H, L, 12), colBack(H, L, 15), colBack(H, L, 18), colBack(H, L, 21)];
      const s4 = sum(sales, last4), s4p = sum(sales, prev4);
      if (s4 != null) {
        out.salesTTM = r1(s4);
        opTTM = sum(op, last4);
        const ebit = opTTM != null ? opTTM - (sum(dep, last4) ?? 0) : null;
        if (s4 > 0) {
          if (ebit != null) out.opmTTM = r1((ebit / s4) * 100);
          const p = sum(pbt, last4), n = sum(np, last4);
          if (p != null) out.ptmTTM = r1((p / s4) * 100);
          if (n != null) out.nmTTM = r1((n / s4) * 100);
        }
        out.revTTMYoY = g(s4, s4p);
        out.ebitdaTTMYoY = g(opTTM, sum(op, prev4));
        out.epsTTMYoY = g(sum(eps, last4), sum(eps, prev4));
        out.npTTM = sum(np, last4);
      }
      if (Y >= 0) {
        out.gpQYoY = g(gpOf(sales[L], cogsQ[H[L]], dep?.[L]), gpOf(sales[Y], cogsQ[H[Y]], dep?.[Y]));
        if (out.gpQYoY != null) approx.push('gpQYoY');
      }
    }
  }

  // ── years ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let opFY: number | null = null, fyHeader: string | null = null, fyPrevHeader: string | null = null, npFY: number | null = null;
  if (A) {
    const H = A.headers;
    const sales = row(A, 'Sales', 'Revenue'), op = row(A, 'Operating Profit', 'Financing Profit'), np = row(A, 'Net Profit'), dep = row(A, 'Depreciation');
    let a = -1;
    for (let i = H.length - 1; i >= 0; i--) if (monthIndex(H[i]) != null && fin(sales?.[i])) { a = i; break; }
    const b = a >= 0 ? colBack(H, a, 12) : -1;
    if (a >= 0 && sales) {
      fyHeader = H[a];
      if (op && fin(op[a])) {
        opFY = op[a] as number;
        if (fin(sales[a]) && (sales[a] as number) > 0) out.opmFY = r1(((opFY - (fin(dep?.[a]) ? (dep![a] as number) : 0)) / (sales[a] as number)) * 100);
      }
      if (np && fin(np[a])) { npFY = np[a] as number; out.niFY = r1(npFY); }
      const gpA = gpOf(sales[a], cogsA[H[a]], dep?.[a]);
      if (gpA != null && fin(sales[a]) && (sales[a] as number) > 0) { out.gmFY = r1((gpA / (sales[a] as number)) * 100); approx.push('gmFY'); }
    }
    if (a >= 0 && b >= 0 && sales) {
      fyPrevHeader = H[b];
      out.revAYoY = g(sales[a], sales[b]);
      if (op) out.ebitdaAYoY = g(op[a], op[b]);
      out.gpAYoY = g(gpOf(sales[a], cogsA[H[a]], dep?.[a]), gpOf(sales[b], cogsA[H[b]], dep?.[b]));
      // Piotroski F-score on years a and b (balance sheet and cash flow at the same year-ends)
      if (BS && CF && np) {
        const col = (t: Table, h: string) => t.headers.indexOf(h);
        const ba = col(BS, H[a]), bb = col(BS, H[b]), ca = col(CF, H[a]);
        const ta = row(BS, 'Total Assets'), bor = row(BS, 'Borrowings', 'Borrowing'), eqc = row(BS, 'Equity Capital'), oa = row(BS, 'Other Assets'), ol = row(BS, 'Other Liabilities');
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
          const gpa = gpOf(sales[a], cogsA[H[a]], dep?.[a]), gpb = gpOf(sales[b], cogsA[H[b]], dep?.[b]);
          const gm1 = gpa != null && (sales[a] as number) > 0 ? gpa / (sales[a] as number) : null, gm0 = gpb != null && fin(sales[b]) && (sales[b] as number) > 0 ? gpb / (sales[b] as number) : null;
          chk(gm1 != null && gm0 != null ? gm1 > gm0 : op && fin(op[a]) && fin(op[b]) && fin(sales[a]) && fin(sales[b]) && (sales[a] as number) > 0 && (sales[b] as number) > 0 ? (op[a] as number) / (sales[a] as number) > (op[b] as number) / (sales[b] as number) : null);
          chk(fin(sales[a]) && fin(sales[b]) ? (sales[a] as number) / TA1 > (sales[b] as number) / TA0 : null);
          if (known >= 8) { out.fs = known === 9 ? pts : r1((pts * 9) / known); if (known < 9 || gm1 == null) approx.push('fs'); }
        }
      }
    }
  }
  // zzz984 — FCF margin (latest year with both cash-flow lines and sales): (operations + investing) ÷ sales, marked ≈
  if (A && CF) {
    const cfo = row(CF, 'Cash from Operating Activity'), cfi = row(CF, 'Cash from Investing Activity'), sales = row(A, 'Sales', 'Revenue');
    if (cfo && cfi && sales) {
      for (let i = CF.headers.length - 1; i >= 0; i--) {
        const h = CF.headers[i], ai = A.headers.indexOf(h);
        if (monthIndex(h) == null || ai < 0 || !fin(cfo[i]) || !fin(cfi[i]) || !fin(sales[ai]) || !((sales[ai] as number) > 0)) continue;
        out.fcfmFY = r1((((cfo[i] as number) + (cfi[i] as number)) / (sales[ai] as number)) * 100);
        approx.push('fcfmTTM', 'r40');
        break;
      }
    }
  }
  // ROCE: screener.in's own (the ratios table's latest year, else the page's top ratio)
  const roceRow = row(R, 'ROCE %');
  if (roceRow && R) { for (let i = R.headers.length - 1; i >= 0; i--) if (fin(roceRow[i])) { out.roceFY = roceRow[i] as number; break; } }
  if (out.roceFY == null && fin(raw.roce)) out.roceFY = raw.roce;
  out.roceTTM = out.roceFY;
  if (out.roceFY != null) approx.push('roceTTM');

  // ── balance sheet ────────────────────────────────────────────────────────────────────────────────────────────────────
  if (BS) {
    const H = BS.headers;
    const eqc = row(BS, 'Equity Capital');
    let c = -1;
    for (let i = H.length - 1; i >= 0; i--) if (monthIndex(H[i]) != null && fin(eqc?.[i])) { c = i; break; }
    if (c >= 0) {
      const newest = bsAt(H[c])!;
      out.borrowings = newest.debt;
      const cash = raw.cash || {};
      if (fin(cash[H[c]])) out.cash = cash[H[c]];
      else { const ks = Object.keys(cash).sort((x, y) => (monthIndex(y) ?? 0) - (monthIndex(x) ?? 0)); if (ks.length) out.cash = cash[ks[0]]; }
    }
    // the latest quarter's balance sheet — only if one was published for that quarter (TradingView: empty otherwise)
    const bq = bsAt(qHeader);
    if (bq) {
      const rq = ratiosOf(bq);
      out.de = rq.de; out.debtAssetsQ = rq.debtAssets; out.debtCapQ = rq.debtCap; out.liabQ = r1(bq.liab);
      const cq = raw.cash?.[qHeader as string];
      if (fin(cq)) out.netDebt = r1(bq.debt - cq);
      if (opTTM != null && opTTM !== 0) out.debtEbitdaQ = r2(bq.debt / opTTM);
      const bY = bsAt(Q && qHeader ? Q.headers[colBack(Q.headers, Q.headers.indexOf(qHeader), 12)] ?? null : null);
      const eqAvg = bY ? (bq.eq + bY.eq) / 2 : bq.eq;
      if (out.npTTM != null && eqAvg > 0) out.roeTTM = r1((out.npTTM / eqAvg) * 100);
    }
    // the latest year end
    const ba = bsAt(fyHeader);
    if (ba) {
      const ra = ratiosOf(ba);
      out.deFY = ra.de; out.debtAssetsA = ra.debtAssets; out.debtCapA = ra.debtCap; out.liabA = r1(ba.liab);
      if (opFY != null && opFY !== 0) out.debtEbitdaA = r2(ba.debt / opFY);
      const bp = bsAt(fyPrevHeader);
      const eqAvg = bp ? (ba.eq + bp.eq) / 2 : ba.eq;
      if (npFY != null && eqAvg > 0) out.roeFY = r1((npFY / eqAvg) * 100);
    }
  }
  return out;
}
