// ═══════════════════════════════════════════════════════════════════════════
// zzz1059 — ON-DEMAND RESULTS GRADE for a US mover whose results 8-K (Item 2.02) landed in the move window but whose day
// is not in the graded-us cache yet (FMC −30%, MAN −16%, RXRX +11% showed "figures not graded yet").
//
// The same engine and the same evidence rules as /api/v1/earnings/graded-us, for ONE company, inside a time budget:
//   · XBRL (companyfacts) already holds this quarter       → graded on it (the full path);
//   · XBRL is still last quarter's (the 10-Q has not posted) → the PRELIM path: revenue / operating income / net income /
//     GAAP EPS read from the 8-K's EX-99.1 and accepted only where the release's prior-year column reproduces last year's
//     XBRL (financialsFromReleaseHtml) — a PRELIM grade never outranks STRONG, exactly as on the earnings page;
//   · the company's ADJUSTED EPS is read from the release (adjustedEpsFromReleaseHtml) and kept apart from GAAP;
//   · guidance RAISED / LOWERED / WITHDRAWN and the filer's own quarter label come from the release (guidanceFromFiling).
// When nothing validates, the release's own headline is returned instead ("FMC lowers full-year outlook") — never a
// figure the documents do not state. Everything fetched here lands in the per-filing caches the graded-us route uses, and
// the day itself is queued there (cache_only probe in us-movers-server), so the next refresh has the full grade.
// ═══════════════════════════════════════════════════════════════════════════

import { companyFacts, sharesOutstandingFromFacts } from './us-edgar';
import { releaseDocument, guidanceFromFiling, htmlToText, type Guidance } from './us-guidance';
import { financialsFromReleaseHtml, periodEndFromReleaseHtml } from './us-pr-financials';
import { adjustedEpsFromReleaseHtml } from './us-pr-adjusted';
import { extractFundamentals, gradeUsRow, fiscalPeriodFromFacts, usFiscalLabel, nextFiscalYear, type UsGradedRow } from './us-earnings-core';
import { classifyXbrlFreshness } from './us-earnings-dates';
import { releaseHeadline } from './us-movers-catalysts';
import type { UsEarningsLite } from './us-movers';

export interface QuickResultsInput {
  ticker: string;
  company: string;
  /** the 8-K's primary-document URL (…/edgar/data/<cik>/<accession>/<doc>) */
  filingUrl: string;
  /** YYYY-MM-DD (ET) */
  filed: string;
  price: number | null;
  chg: number | null;
  hi52: number | null;
  relVol: number | null;
  avgDollarVolM: number | null;
}

/** "…/edgar/data/1398733/000139873326000058/x.htm" → cik 1398733, accession "0001398733-26-000058", the -index.htm URL. Pure. */
export function filingRefFromUrl(url: string): { cikNum: number; accession: string; indexUrl: string } | null {
  const m = /\/edgar\/data\/(\d+)\/(\d{10})(\d{2})(\d{6})\//.exec(String(url || ''));
  if (!m) return null;
  const accession = `${m[2]}-${m[3]}-${m[4]}`;
  const dir = String(url).replace(/\/[^/]*$/, '');
  return { cikNum: Number(m[1]), accession, indexUrl: `${dir}/${accession}-index.htm` };
}

const isoAddDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

/** The graded row (or the release-only facts) → the WHY's earnings record. Pure. */
export function liteFromGraded(row: UsGradedRow | null, o: { ticker: string; filed: string; prelim: boolean; guidance: string | null; headline: string | null; url: string | null; quarter?: string | null }): UsEarningsLite | null {
  if (!row) {
    if (!o.headline && !o.guidance) return null;
    return {
      ticker: o.ticker, filing_date: o.filed, quarter: o.quarter ?? null, sales_yoy_pct: null, eps_yoy_pct: null, tier: null,
      guidance: o.guidance, headline: o.headline, via: 'press release (SEC 8-K 2.02) — figures not validated yet', url: o.url,
    };
  }
  return {
    ticker: o.ticker, filing_date: o.filed, quarter: row.quarter || o.quarter || null,
    sales_yoy_pct: row.sales_yoy_pct, eps_yoy_pct: row.eps_yoy_pct, eps_swing: row.eps_swing || null,
    net_profit_yoy_pct: row.net_profit_yoy_pct,
    eps_gaap_yoy_pct: row.eps_gaap_yoy_pct ?? null, eps_adj_yoy_pct: row.eps_adj_yoy_pct ?? null, eps_adj_swing: row.eps_adj_swing || null,
    // a PRELIM grade never outranks STRONG (same rule as the earnings page)
    tier: o.prelim && row.tier === 'BLOCKBUSTER' ? 'STRONG' : row.tier,
    guidance: o.guidance, prelim: o.prelim, headline: o.headline,
    via: o.prelim ? 'on-demand grade — 8-K press release figures validated against last year’s XBRL (prelim)' : 'on-demand grade — SEC XBRL + 8-K press release',
    url: o.url,
  };
}

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.catch(() => fallback), new Promise<T>((res) => { t = setTimeout(() => res(fallback), Math.max(1, ms)); })]);
  } finally { if (t) clearTimeout(t); }
}

/** Grade one results 8-K now (bounded by `timeoutMs`). Null when the filing gave nothing usable. Never throws. */
export async function quickUsResults(i: QuickResultsInput, timeoutMs = 15_000): Promise<UsEarningsLite | null> {
  const ref = filingRefFromUrl(i.filingUrl);
  if (!ref) return null;
  const end = Date.now() + timeoutMs;
  const left = () => Math.max(500, end - Date.now());
  try {
    const [facts, doc] = await Promise.all([
      withTimeout(companyFacts(ref.cikNum), left(), null as any),
      withTimeout(releaseDocument(ref.cikNum, ref.accession, ref.indexUrl), left(), { url: null, html: null }),
    ]);
    const g: Guidance | null = await withTimeout(guidanceFromFiling(ref.cikNum, ref.accession, ref.indexUrl), Math.min(left(), 6_000), null);
    const html = doc?.html || null;
    const headline = html ? releaseHeadline(htmlToText(html)) : null;
    const guidance = g?.label || null;
    const url = doc?.url || i.filingUrl;

    let fund: any = null;
    let prelim = false;
    let fiscalLabel: string | null = null;
    let fiscalFy: number | null = null;
    const full = facts ? extractFundamentals(facts) : null;
    const fresh = full?.q_end
      ? classifyXbrlFreshness({ filed: i.filed, qEnd: full.q_end, qFiled: full.q_filed, maxLagDays: 110, checkAlreadyPublic: true })
      : null;
    let qEnd: string | null = null;
    if (full?.q_end && fresh === 'current') {
      fund = full; qEnd = full.q_end;
      const fp = fiscalPeriodFromFacts(facts, full.q_end);
      fiscalLabel = g?.fiscal_label || usFiscalLabel(fp) || null; fiscalFy = g?.fiscal_fy ?? fp.fy;
    } else if (html) {
      // PRELIM: the 10-Q has not posted — read the release, validated against the year-ago XBRL
      prelim = true;
      qEnd = periodEndFromReleaseHtml(html, i.filed);
      if (qEnd) {
        const ya = facts ? extractFundamentals(facts, isoAddDays(qEnd, -365)) : null;
        const yaUsable = !!ya && !!ya.q_end && Math.abs(Math.abs(daysBetween(qEnd, ya.q_end)) - 365) <= 25;
        let pr: ReturnType<typeof financialsFromReleaseHtml> | null = null;
        if (yaUsable && ya && (ya.revenue != null || ya.net_income != null)) {
          try {
            pr = financialsFromReleaseHtml(html, {
              revenue: ya.revenue, operating_income: ya.operating_income, net_income: ya.net_income, eps: ya.eps,
              cfo: ya.cfo ?? null, capex: ya.capex != null ? Math.abs(ya.capex) : null,
            }, { reportedPeriodEnd: qEnd });
          } catch { pr = null; }
        }
        fund = {
          q_end: qEnd, q_end_prev: ya?.q_end ?? null, q_filed: null,
          revenue: pr?.revenue ?? null, revenue_prev: pr?.revenue_prev ?? null,
          operating_income: pr?.operating_income ?? null, operating_income_prev: pr?.operating_income_prev ?? null,
          net_income: pr?.net_income ?? null, net_income_prev: pr?.net_income_prev ?? null,
          eps: pr?.eps ?? null, eps_prev: pr?.eps_prev ?? null, eps_derived: false,
          cfo: pr?.cfo ?? null, cfo_prev: pr?.cfo_prev ?? null, capex: pr?.capex ?? null, capex_prev: pr?.capex_prev ?? null, tags: {},
          quarters_revenue: null, quarters_eps: null, quarters_opm: null,
        };
        const fp = nextFiscalYear(facts ? fiscalPeriodFromFacts(facts, ya?.q_end || isoAddDays(qEnd, -365)) : null);
        fiscalLabel = g?.fiscal_label || usFiscalLabel(fp) || ((g?.fiscal_q ?? fp.q) ? `Q${g?.fiscal_q ?? fp.q}` : null);
        fiscalFy = g?.fiscal_fy ?? fp.fy;
      }
    }
    let row: UsGradedRow | null = null;
    if (fund) {
      const adj = html ? adjustedEpsFromReleaseHtml(html, { gaapEps: fund.eps ?? null, periodEndISO: qEnd }) : null;
      const pct52 = i.price != null && i.hi52 != null && i.hi52 > 0 ? ((i.price - i.hi52) / i.hi52) * 100 : null;
      try {
        row = gradeUsRow({
          ticker: i.ticker, company: i.company, filing_date: i.filed, form: '8-K', items: ['2.02'], filing_url: ref.indexUrl,
          fundamentals: fund,
          price: {
            price: i.price, d1_pct: i.chg, gap_pct: null, move_pct: i.chg, pct_from_52w_high: pct52,
            stage: null, rs_rating: null, addv_musd: i.avgDollarVolM, vol_ratio_20d: i.relVol,
          },
          shares_outstanding: facts ? sharesOutstandingFromFacts(facts, null) : null,
          adj_eps: adj ? adj.value : null,
          adj_eps_prev: adj ? (adj.prior ?? null) : null,
          positive_guidance: guidance === 'RAISED',
          fiscal_label: fiscalLabel, fiscal_year_own: fiscalFy,
        });
      } catch { row = null; }
      // a row with no growth figure on any line says nothing a reader can use — the headline stands in
      if (row && row.sales_yoy_pct == null && row.eps_yoy_pct == null && row.eps_gaap_yoy_pct == null && row.eps_adj_yoy_pct == null && !row.eps_swing) row = null;
      if (row && (guidance === 'LOWERED' || guidance === 'WITHDRAWN') && row.tier === 'BLOCKBUSTER') row = { ...row, tier: 'STRONG' as UsGradedRow['tier'] };
    }
    return liteFromGraded(row, { ticker: i.ticker, filed: i.filed, prelim, guidance, headline, url, quarter: fiscalLabel });
  } catch { return null; }
}
