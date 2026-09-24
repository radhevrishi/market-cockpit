// ═══════════════════════════════════════════════════════════════════════════
// SEC FILINGS → THE SHARED LEDGER FORMAT.                            (zzz790)
//
// Pure adapters between EDGAR and the India thesis engine. Nothing here
// fetches, calls a model, or reads a price. Each function is the US-side
// twin of a step the India reader performs inline, written so the SAME
// shared engine (lib/thesis/*) consumes the result unchanged:
//
//   submissions (EDGAR)   → usCandidatesFromSubmissions → LedgerDocument[]
//   10-Q / 10-K text      → mdnaSection (the part that carries mechanism)
//   8-K EX-99.1 text      → looksLikeUsEarningsRelease (a release, or not)
//   model summary         → verifyUsSummary (every figure must be printed)
//   XBRL companyfacts     → usGradedRow (the deterministic grader row)
//   sentences             → deterministicUsFacts (search-first, no model)
//
// US dollars stay as printed ("$1.2 billion", "$345.6 million"): the shared
// unit normaliser (lib/thesis/fact-model normalizeValue) reads both as
// USD million, so a before → after across the two spellings is exact.
// ═══════════════════════════════════════════════════════════════════════════

import {
  moneyTokens, numeralsIn, supported, pctTokens, valuesIn, supportedPct, SYSTEM_BASE,
} from '@/lib/earnings/ai-summary-shared';
import { documentId, reportingPeriodFromDate, periodOrdinal, type LedgerDocument } from '@/lib/thesis/evidence-ledger';
import { findPassages, type Passage } from '@/lib/thesis/evidence-extract';
import { extractUsPressRelease } from '@/lib/ai-gainers/us-gainers';

// ── the prompt addendum ───────────────────────────────────────────────────

export const US_SYSTEM = `${SYSTEM_BASE}

THIS IS A US SEC FILER'S QUARTERLY OR ANNUAL REPORTING.
- The documents are an earnings press release (8-K Item 2.02, exhibit 99.1) and/or the Form 10-Q / 10-K for the same quarter (Management's Discussion and Analysis). Read only them.
- Figures are in US dollars. Copy every number exactly as printed with its unit ("$1.2 billion", "$345.6 million", "$0.84 per diluted share"). Never convert, round or re-scale.
- Fiscal quarters are the COMPANY'S OWN ("second quarter of fiscal 2026", "quarter ended June 28, 2026"). Put the period exactly as the document names it.
- Compare against the same quarter of the prior year unless the document itself highlights the sequential comparison, and say which one you used.
- Backlog, remaining performance obligations (RPO) and bookings are the order book. Capacity, utilization, production rate, units shipped and customer counts are structural variables — fill them only when the document gives them.
- A target, an expectation or an outlook is not a result. A figure for an earlier period is not this quarter's.
- There is no analyst consensus in these documents. Never describe anything as a beat or a miss.`;

// ── documents ─────────────────────────────────────────────────────────────

export type UsForm = '10-Q' | '10-K' | '8-K' | '6-K' | '20-F' | '40-F';

export interface UsFilingRow { form: string; filingDate: string; reportDate: string | null; items: string[]; accession: string }

export interface UsDocCandidate {
  url: string;              // the filing index (…-index.htm); the reader resolves the document
  accession: string;
  form: UsForm;
  kind: 'results' | 'annual_report';
  role: 'release' | 'periodic';
  label: string;
  source: 'SEC EDGAR';
  tier: 1;
  dateIso: string;          // filing date
  reportDate: string | null;
  /** The shared calendar key the document resolves to (India convention). */
  period: string | null;
}

export function filingIndexUrl(cik: number | string, accession: string): string {
  const bare = accession.replace(/-/g, '');
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${bare}/${accession}-index.htm`;
}

/**
 * Pure: the evidence documents in a filer's submission list — earnings
 * releases (8-K with Item 2.02), quarterly and annual reports (10-Q, 10-K,
 * and for foreign private issuers 20-F / 40-F), newest first, inside
 * `windowDays`. 6-Ks are included only when `includeSixK` (they are not
 * always results, so a discovery-only check never counts them as new
 * evidence). Amendments (/A) are left out: an amended filing restates, it
 * does not report a new quarter.
 */
export function usCandidatesFromSubmissions(recent: UsFilingRow[], cik: number | string, now: Date = new Date(), opts: { windowDays?: number; includeSixK?: boolean } = {}): UsDocCandidate[] {
  const cutoff = new Date(now.getTime() - (opts.windowDays ?? 460) * 86_400_000).toISOString().slice(0, 10);
  const out: UsDocCandidate[] = [];
  for (const f of recent || []) {
    const form = String(f.form || '').toUpperCase();
    const date = String(f.filingDate || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < cutoff || !f.accession) continue;
    let role: UsDocCandidate['role'] | null = null;
    let kind: UsDocCandidate['kind'] = 'results';
    let label = '';
    const rep = f.reportDate ? String(f.reportDate).slice(0, 10) : null;
    if (form === '8-K' && (f.items || []).map(String).includes('2.02')) { role = 'release'; label = `Earnings release — 8-K Item 2.02 (EX-99.1), filed ${date}`; }
    else if (form === '6-K' && opts.includeSixK) { role = 'release'; label = `Form 6-K (possible results release), filed ${date}`; }
    else if (form === '10-Q') { role = 'periodic'; label = `Form 10-Q${rep ? ` — quarter ended ${rep}` : ''} (MD&A), filed ${date}`; }
    else if (form === '10-K' || form === '20-F' || form === '40-F') { role = 'periodic'; kind = 'annual_report'; label = `Form ${form}${rep ? ` — fiscal year ended ${rep}` : ''} (MD&A), filed ${date}`; }
    if (!role) continue;
    out.push({
      url: filingIndexUrl(cik, f.accession), accession: f.accession, form: form as UsForm, kind, role, label,
      source: 'SEC EDGAR', tier: 1, dateIso: date, reportDate: rep, period: reportingPeriodFromDate(date)?.period || null,
    });
  }
  return out.sort((a, b) => b.dateIso.localeCompare(a.dateIso));
}

/**
 * Pure: which documents one read takes in — for the newest reporting period
 * the candidates cover (or `target`), the newest earnings release and the
 * newest periodic report of that period. Two documents answer different
 * questions: the release carries the headline figures, the MD&A carries
 * backlog, capacity and the cause.
 */
export function planUsRead(cands: UsDocCandidate[], target?: string | null): { period: string | null; docs: UsDocCandidate[] } {
  const periods = Array.from(new Set(cands.map((c) => c.period).filter((p): p is string => !!p)))
    .sort((a, b) => periodOrdinal(b) - periodOrdinal(a));
  const period = target ? (periods.includes(target) ? target : null) : (periods[0] || null);
  if (!period) return { period: target || null, docs: [] };
  const inP = cands.filter((c) => c.period === period);
  const release = inP.find((c) => c.role === 'release' && c.form === '8-K') || inP.find((c) => c.role === 'release');
  const periodic = inP.find((c) => c.role === 'periodic');
  return { period, docs: [release, periodic].filter((c): c is UsDocCandidate => !!c) };
}

export type UsDocOutcome = 'read' | 'download_failed' | 'scanned' | 'too_short' | 'budget_exhausted' | 'not_selected';

/** Pure: the ledger documents for a read — every candidate listed, with the
 *  outcome of the ones the reader touched. */
export function usLedgerDocuments(cands: UsDocCandidate[], outcomes: Array<{ url: string; outcome: UsDocOutcome; chars?: number; detail?: string; docUrl?: string | null; hash?: string | null }>): LedgerDocument[] {
  const by = new Map(outcomes.map((o) => [o.url, o]));
  return cands.map((c) => {
    const o = by.get(c.url);
    // Identity is the FILING (its index url), so a discovery-only check that
    // lists the same filing recognises it as already on file. The document
    // actually read (EX-99.1, the 10-Q body) is named in `detail`.
    const detail = [o?.detail, o?.docUrl && o.docUrl !== c.url ? `document: ${o.docUrl}` : null].filter(Boolean).join(' · ');
    return {
      id: documentId(c.url), url: c.url, label: c.label, kind: c.kind, source: c.source, tier: c.tier,
      period: c.reportDate, date_iso: c.dateIso, outcome: (o?.outcome || 'not_selected') as LedgerDocument['outcome'],
      ...(o?.chars != null ? { chars: o.chars } : {}), ...(detail ? { detail } : {}),
      ...(o?.hash ? { content_hash: o.hash } : {}),
    };
  });
}

// ── text ──────────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', bull: '•', reg: '®', trade: '™', dollar: '$', percnt: '%',
};

/** Filing HTML → text, entities decoded, table cells kept apart, no length cap. */
export function usHtmlToText(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<ix:header[\s\S]*?<\/ix:header>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h\d|table)>/gi, '. ').replace(/<br\s*\/?>/gi, ' ').replace(/<\/t[dh]>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c === 160 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => { const c = parseInt(h, 16); return c === 0xa0 ? ' ' : c > 0 && c < 0x110000 ? String.fromCodePoint(c) : ' '; })
    .replace(/&([a-z]+);/gi, (m, k) => NAMED[k.toLowerCase()] ?? m)
    .replace(/(\|\s*){2,}/g, '| ').replace(/(\.\s*){2,}/g, '. ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Pure: the Management's Discussion and Analysis of a 10-Q (Item 2) or 10-K
 * (Item 7) — where backlog, capacity, utilization and the cause of the
 * quarter live. The table of contents names the item too, so the LAST
 * heading that is followed by real prose is taken. Falls back to the whole
 * text (capped) when no heading is found.
 */
export function mdnaSection(text: string, form: string, cap = 70_000): string {
  const t = String(text || '');
  const annual = /^(10-K|20-F|40-F)/i.test(form);
  const start = annual
    ? /item\s*7\.?\s*[-–—:]?\s*management[’'`s]{0,2}\s*discussion/gi
    : /item\s*2\.?\s*[-–—:]?\s*management[’'`s]{0,2}\s*discussion/gi;
  const end = annual ? /item\s*7a\.?\s*[-–—:]?\s*quantitative/i : /item\s*3\.?\s*[-–—:]?\s*quantitative/i;
  let best = -1;
  let m: RegExpExecArray | null;
  while ((m = start.exec(t))) {
    const after = t.slice(m.index, m.index + 1500);
    // A table-of-contents entry is followed by the next item within a few words.
    if (!/item\s*[3-9]/i.test(after.slice(80, 600))) best = m.index;
    else if (best < 0) best = m.index;
  }
  if (best < 0) {
    const md = /management[’'`s]{0,2}\s*discussion and analysis/i.exec(t);
    best = md ? md.index : 0;
  }
  const rest = t.slice(best);
  const e = end.exec(rest.slice(200));
  const body = e ? rest.slice(0, e.index + 200) : rest;
  return body.slice(0, cap);
}

/** Pure: is this text an earnings release (the 8-K's EX-99.1), or a
 *  certification / periodic wrapper? Decided on content. */
export function looksLikeUsEarningsRelease(t: string): boolean {
  if (!t || t.length < 800) return false;
  const head = t.slice(0, 6000);
  if (/pursuant to\s+(?:rule\s+13a-14|section\s+(?:302|906))/i.test(head)) return false;
  if (/\bI,\s+[A-Z][^,]{2,60},\s+certify that\b/i.test(head)) return false;
  let marks = 0;
  if (/\b(?:reports?|reported|announces?|announced|posts?|delivers?)\b[\s\S]{0,60}\b(?:results|earnings|revenue|quarter|financial)\b/i.test(head)) marks++;
  if (/\b(?:first|second|third|fourth)\s+quarter\b|\bQ[1-4]\s*(?:FY)?\s*20\d\d\b|\b(?:quarter|year)\s+ended\b/i.test(head)) marks++;
  if ((t.match(/\b(?:net income|net revenue|total revenue|revenues?|net sales|earnings per share|operating income|EBITDA)\b/gi) || []).length >= 4) marks++;
  if ((t.match(/\$\s?\d/g) || []).length >= 8) marks++;
  if (/\b(?:conference call|webcast|investor relations|forward-looking statements|non-GAAP)\b/i.test(t)) marks++;
  return marks >= 2;
}

// ── deterministic first ────────────────────────────────────────────────────

export interface UsDeterministicFacts {
  /** Search-first sentences naming a structural variable WITH a number. */
  passages: Passage[];
  byFamily: Record<string, number>;
  /** The release's own revenue / guidance / deal sentences, verbatim. */
  release: { lead: string | null; revenueSentence: string | null; guidance: string | null };
}

/** Pure: what the documents say before any model is asked. The model is
 *  asked about structure only when a passage exists (the shared extractor
 *  already returns early without one). */
export function deterministicUsFacts(docs: Array<{ label: string; text: string; role?: string }>): UsDeterministicFacts {
  const passages: Passage[] = [];
  for (const d of docs) passages.push(...findPassages(d.text, d.label));
  const byFamily: Record<string, number> = {};
  for (const p of passages) byFamily[p.family] = (byFamily[p.family] || 0) + 1;
  const rel = docs.find((d) => d.role === 'release') || null;
  const pr = rel ? extractUsPressRelease(rel.text) : null;
  return { passages, byFamily, release: { lead: pr?.lead || null, revenueSentence: pr?.revenueSentence || null, guidance: pr?.facts?.guidance || null } };
}

// ── verification: the gate every figure passes ────────────────────────────

/**
 * Pure: the India/US verification gate, per field — a figure the documents
 * do not print costs its own item and the rest survives. Returns the cleaned
 * object, the dropped figures, and `rejected` when so little is left that
 * showing the remainder would misrepresent the quarter.
 */
export function verifyUsSummary(data0: any, sourceText: string): { data: any; dropped: string[]; rejected: string | null } {
  const data = data0 && typeof data0 === 'object' ? JSON.parse(JSON.stringify(data0)) : {};
  const inText = numeralsIn(sourceText);
  const values = valuesIn(sourceText);
  const dropped: string[] = [];
  const clean = (s: any): boolean => {
    const v = typeof s === 'string' ? s : '';
    if (!v) return true;
    const badMoney = moneyTokens(v).filter((f) => !supported(f, inText));
    if (badMoney.length) { dropped.push(`$${badMoney[0]}`); return false; }
    const badPct = pctTokens(v).filter((p) => !supportedPct(p, values));
    if (badPct.length) { dropped.push(`${badPct[0].v}%`); return false; }
    return true;
  };
  const keepItems = (arr: any): any[] => (Array.isArray(arr) ? arr : []).filter((it) => (typeof it === 'string' ? clean(it) : clean(it?.detail) && clean(it?.label)));
  const posBefore = Array.isArray(data.positives) ? data.positives.length : 0;
  data.positives = keepItems(data.positives);
  data.negatives = keepItems(data.negatives);
  data.segments = keepItems(data.segments);
  data.new_business = keepItems(data.new_business);
  data.watch_next = keepItems(data.watch_next);
  data.not_disclosed = keepItems(data.not_disclosed);
  if (!clean(data.mix_shift)) data.mix_shift = '';
  if (!clean(data.management)) data.management = '';
  if (!clean(data.verdict_line)) data.verdict_line = '';
  if (data.guidance && !clean(data.guidance.detail)) data.guidance.detail = '';
  for (const k of ['capex', 'buyback', 'dividend', 'debt']) if (data.capital && !clean(data.capital[k])) data.capital[k] = '';
  data.catalysts = (Array.isArray(data.catalysts) ? data.catalysts : []).filter((c: any) => clean(c?.title) && clean(c?.size_vs_company));
  data.capex_projects = (Array.isArray(data.capex_projects) ? data.capex_projects : []).filter((c: any) => clean(c?.amount) && clean(c?.capacity_added) && clean(c?.name));
  data.one_offs = (Array.isArray(data.one_offs) ? data.one_offs : []).filter((o: any) => clean(o?.amount) && clean(o?.item));
  if (data.margin_bridge) {
    if (!clean(data.margin_bridge.opm_change_pp)) data.margin_bridge.opm_change_pp = '';
    data.margin_bridge.drivers = (Array.isArray(data.margin_bridge.drivers) ? data.margin_bridge.drivers : []).filter((d: any) => clean(d?.detail));
  }
  for (const k of ['current', 'prior', 'expected', 'expected_by', 'basis']) if (data.utilisation && !clean(data.utilisation[k])) data.utilisation[k] = '';
  const h = data.headline;
  if (h && typeof h === 'object') {
    for (const k of ['period', 'revenue', 'revenue_prior', 'revenue_growth', 'profit', 'profit_prior', 'profit_growth', 'ebitda', 'cash_from_operations', 'cash_flow_period']) {
      if (typeof h[k] !== 'string' || !clean(h[k])) h[k] = '';
    }
    for (const k of ['revenue_growth', 'profit_growth']) if (h[k] && !/%|per ?cent/i.test(h[k])) h[k] = '';
    if (!['consolidated', 'standalone', 'not_stated'].includes(h.basis)) h.basis = 'not_stated';
    if (!['yoy', 'qoq', 'not_stated'].includes(h.comparison)) h.comparison = 'not_stated';
    if (!h.cash_from_operations) h.cash_flow_period = '';
  } else data.headline = null;
  for (const k of ['closing_value', 'growth', 'order_inflow', 'book_to_bill', 'execution_period', 'concentration']) if (data.order_book && !clean(data.order_book[k])) data.order_book[k] = '';
  if (!clean(data.operating_leverage_evidence)) data.operating_leverage_evidence = '';
  for (const grp of ['capacity', 'demand', 'customers', 'volume_price_mix', 'balance', 'risks']) {
    const o = data[grp];
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) if (typeof o[k] === 'string' && !clean(o[k])) o[k] = '';
  }
  if (!clean(data.capex_earning)) data.capex_earning = '';
  if (Array.isArray(data.management_targets)) data.management_targets = data.management_targets.filter((t: any) => clean(t?.target) && clean(t?.metric));

  let rejected: string | null = null;
  if (!data.positives.length && !data.negatives.length && !data.verdict_line) {
    rejected = `summary discarded: cited figures absent from the filing (${dropped.slice(0, 3).join(', ') || 'nothing verifiable'})`;
  } else if (posBefore >= 3 && data.positives.length < posBefore * 0.5) {
    rejected = `summary discarded: most figures absent from the filing (${dropped.slice(0, 3).join(', ')})`;
  }
  return { data, dropped, rejected };
}

// ── the company's own fiscal quarter ──────────────────────────────────────

/**
 * Pure: "Q2 FY2026" for the quarter ending `qEnd`, from XBRL companyfacts —
 * the fiscal period (fp) and year (fy) the company tagged in the FIRST filing
 * that reported that period end. Null when the facts do not say.
 */
export function fiscalLabelFor(facts: any, qEnd: string | null | undefined): string | null {
  if (!qEnd || !facts?.facts) return null;
  let best: { fy: number; fp: string; filed: string } | null = null;
  for (const ns of ['us-gaap', 'ifrs-full', 'dei']) {
    const concepts = facts.facts[ns];
    if (!concepts) continue;
    for (const c of Object.values<any>(concepts)) {
      for (const arr of Object.values<any>(c?.units || {})) {
        if (!Array.isArray(arr)) continue;
        for (const e of arr) {
          if (e?.end !== qEnd || !e?.fp || !e?.fy || !/^(10-Q|10-K|20-F|40-F)/.test(String(e.form || ''))) continue;
          const filed = String(e.filed || '');
          if (!best || filed < best.filed) best = { fy: Number(e.fy), fp: String(e.fp), filed };
        }
      }
    }
    if (best) break;
  }
  const b = best as { fy: number; fp: string; filed: string } | null;
  if (!b || !Number.isFinite(b.fy)) return null;
  const q = b.fp === 'FY' ? 'Q4' : /^Q[1-4]$/.test(b.fp) ? b.fp : null;
  return q ? `${q} FY${b.fy}` : null;
}

// ── the deterministic grader row (XBRL), NO PRICE ─────────────────────────

export interface UsFundamentalsLike {
  q_end: string | null; q_end_prev: string | null; q_filed: string | null;
  revenue: number | null; revenue_prev: number | null;
  operating_income: number | null; operating_income_prev: number | null;
  net_income: number | null; net_income_prev: number | null;
  eps: number | null; eps_prev: number | null; eps_compare_blocked?: boolean;
  cfo: number | null; cfo_prev?: number | null;
  capex?: number | null;
  operating_income_basis?: string;
}

const pct1 = (a: number, b: number) => Math.round(((a / b) - 1) * 1000) / 10;
const m1 = (v: number | null) => (v == null ? null : Math.round((v / 1e6) * 10) / 10);

/**
 * Pure: the grader row the shared engine reads (sales_yoy_pct,
 * net_profit_yoy_pct, eps_yoy_pct, opm_pct, opm_prev_pct, opm_change_pp,
 * cfo_to_pat_ratio, net_income_*_musd) from EDGAR's XBRL figures. Growth
 * off a non-positive base is left null — a loss that narrowed is not "+∞%".
 * No price, no market value, no day-one reaction: none is an input here.
 */
export function usGradedRow(ticker: string, f: UsFundamentalsLike, meta: { company?: string | null; cik?: number | string | null; fiscalLabel?: string | null } = {}): Record<string, any> | null {
  if (!f || !f.q_end) return null;
  const rev = f.revenue, revP = f.revenue_prev;
  const ni = f.net_income, niP = f.net_income_prev;
  const opm = rev && rev > 0 && f.operating_income != null ? Math.round((f.operating_income / rev) * 1000) / 10 : null;
  const opmP = revP && revP > 0 && f.operating_income_prev != null ? Math.round((f.operating_income_prev / revP) * 1000) / 10 : null;
  const row: Record<string, any> = {
    ticker, requested: ticker, market: 'US', source: 'sec-xbrl',
    company: meta.company || null,
    period: meta.fiscalLabel ? `${meta.fiscalLabel} (quarter ended ${f.q_end})` : `quarter ended ${f.q_end}`,
    fiscal_label: meta.fiscalLabel || null,
    q_end: f.q_end, q_end_prev: f.q_end_prev,
    filing_date: f.q_filed,
    source_url: meta.cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(meta.cik).padStart(10, '0')}&type=10-&dateb=&owner=include&count=40` : null,
    sales_yoy_pct: rev != null && revP != null && revP > 0 ? pct1(rev, revP) : null,
    net_profit_yoy_pct: ni != null && niP != null && niP > 0 && ni > 0 ? pct1(ni, niP) : null,
    eps_yoy_pct: f.eps != null && f.eps_prev != null && f.eps_prev > 0 && f.eps > 0 && !f.eps_compare_blocked ? pct1(f.eps, f.eps_prev) : null,
    opm_pct: opm, opm_prev_pct: opmP,
    opm_change_pp: opm != null && opmP != null ? Math.round((opm - opmP) * 10) / 10 : null,
    opm_basis: f.operating_income_basis || null,
    cfo_to_pat_ratio: f.cfo != null && ni != null && ni > 0 ? Math.round((f.cfo / ni) * 100) / 100 : null,
    cfo_period_is_current: true,
    revenue_curr_musd: m1(rev), revenue_prev_musd: m1(revP),
    net_income_curr_musd: m1(ni), net_income_prev_musd: m1(niP),
    operating_income_curr_musd: m1(f.operating_income), cfo_curr_musd: m1(f.cfo),
    capex_curr_musd: m1(f.capex ?? null),
  };
  // Nothing usable: say so rather than hand the engine an empty row.
  if (row.sales_yoy_pct == null && row.opm_pct == null && row.net_income_curr_musd == null) return null;
  return row;
}

/** Keys a grader row must never carry into the engine. */
export const PRICE_KEYS = ['price', 'cmp', 'last_price', 'close', 'd1_pct', 'gap_pct', 'live_move_pct', 'market_cap', 'market_cap_cr', 'mcap', 'pe', 'avgPrice', 'avg_price', 'marketValue'] as const;
