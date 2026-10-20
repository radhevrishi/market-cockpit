// zzz1161 — the measures a LENDER is judged on (owner, 20 Oct: "based on them are you showing correct metrics?"). A bank has no
// "revenue" line: its top line is NET INTEREST INCOME (interest earned minus interest paid) plus NON-INTEREST (fee) income, and the
// cost of its risk is the PROVISION for credit losses. Read from the company's own XBRL (quarter = 80–100 days), and on the evening
// of a print from the release, where a row counts only when its year-ago column reproduces last year's XBRL quarter. Pure.
import { conceptSeries } from './us-earnings-core';

export interface BankQuarter {
  nii: number | null; nii_prev: number | null;
  nonint: number | null; nonint_prev: number | null;
  provision: number | null; provision_prev: number | null;
}
const NII_TAGS = ['InterestIncomeExpenseNet', 'InterestIncomeExpenseAfterProvisionForLoanLoss__no', 'NetInterestIncome'];
const NONINT_TAGS = ['NoninterestIncome', 'NoninterestIncomeOther__no'];
const PROV_TAGS = ['ProvisionForLoanLeaseAndOtherLosses', 'ProvisionForCreditLossExpenseReversal', 'ProvisionForLoanAndLeaseLosses', 'ProvisionForLoanLossesExpensed'];

const days = (a: string, b: string) => (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/** The quarter value of the first tag that has one for this period end (±7 days). */
function quarterOf(facts: any, tags: string[], end: string): number | null {
  for (const t of tags) {
    if (t.endsWith('__no')) continue;
    for (const r of conceptSeries(facts, t)) {
      if (r.days >= 80 && r.days <= 100 && Math.abs(days(r.end, end)) <= 7) return r.val;
    }
  }
  return null;
}

/** NII when the filer tags only its two halves: interest income − interest expense (same period). */
function niiOf(facts: any, end: string): number | null {
  const direct = quarterOf(facts, NII_TAGS, end);
  if (direct != null) return direct;
  const inc = quarterOf(facts, ['InterestAndDividendIncomeOperating', 'InterestIncomeOperating', 'InterestAndFeeIncomeLoansAndLeases'], end);
  const exp = quarterOf(facts, ['InterestExpense', 'InterestExpenseOperating', 'InterestExpenseDeposits'], end);
  return inc != null && exp != null && inc > exp ? inc - exp : null;
}

/** Latest equity ÷ total assets (a lender's capital cushion), from the same balance-sheet date. */
export function equityToAssets(facts: any): { pct: number; asOf: string } | null {
  const inst = (c: string) => {
    const u = facts?.facts?.['us-gaap']?.[c]?.units?.USD as any[] | undefined;
    const m = new Map<string, number>();
    for (const e of u || []) if (!e?.start && e?.end && /^10-[QK]/.test(String(e.form)) && typeof e.val === 'number') m.set(e.end, e.val);
    return m;
  };
  const eq = inst('StockholdersEquity'), as = inst('Assets');
  const ends = [...eq.keys()].filter((d) => as.has(d)).sort();
  const d = ends[ends.length - 1];
  if (!d) return null;
  const a = as.get(d)!, e = eq.get(d)!;
  if (!(a > 0) || !(e > 0) || e > a) return null;
  return { pct: Math.round((e / a) * 1000) / 10, asOf: d };
}

/** Bank figures for the quarter ending `qEnd` and the same quarter a year earlier. */
export function bankQuarterFromFacts(facts: any, qEnd: string | null): BankQuarter {
  const empty: BankQuarter = { nii: null, nii_prev: null, nonint: null, nonint_prev: null, provision: null, provision_prev: null };
  if (!facts || !qEnd || !/^\d{4}-\d{2}-\d{2}$/.test(qEnd)) return empty;
  const ya = new Date(Date.parse(`${qEnd}T00:00:00Z`) - 365 * 86_400_000).toISOString().slice(0, 10);
  return {
    nii: niiOf(facts, qEnd), nii_prev: niiOf(facts, ya),
    nonint: quarterOf(facts, NONINT_TAGS, qEnd), nonint_prev: quarterOf(facts, NONINT_TAGS, ya),
    provision: quarterOf(facts, PROV_TAGS, qEnd), provision_prev: quarterOf(facts, PROV_TAGS, ya),
  };
}

const LINES: Array<{ key: 'nii' | 'nonint' | 'provision'; re: RegExp }> = [
  { key: 'nii', re: /\bnet interest income\b(?!\s*(?:after|to|margin|\(fte\)|on a fully|-\s*fte|ratio))/i },
  { key: 'nonint', re: /\b(?:total\s+)?non-?interest income\b/i },
  { key: 'provision', re: /\bprovision for (?:credit|loan)(?: and lease)? losses\b/i },
];

/** Numbers after a label, as written: "(1,234)" → -1234, "—" skipped. */
function numsAfter(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/\(?-?\$?\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)\)?/g)) {
    const v = Number(m[1].replace(/,/g, ''));
    if (Number.isFinite(v)) out.push(/^\(/.test(m[0]) ? -v : v);
    if (out.length >= 6) break;
  }
  return out;
}

/**
 * Release figures for a bank on the evening of the print: a row counts only when one of its next columns, at some print scale,
 * reproduces the year-ago XBRL quarter (±1.5%), and the current figure is the column before it. Nothing else is guessed.
 */
export function bankFromRelease(html: string, yearAgo: Pick<BankQuarter, 'nii_prev' | 'nonint_prev' | 'provision_prev'>): Partial<BankQuarter> {
  const text = String(html || '').replace(/<\/(?:td|th)>/gi, ' | ').replace(/<\/tr>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/&#\d+;|&\w+;/g, ' ');
  const out: Partial<BankQuarter> = {};
  const prevOf = { nii: yearAgo.nii_prev, nonint: yearAgo.nonint_prev, provision: yearAgo.provision_prev };
  for (const line of text.split('\n')) {
    for (const { key, re } of LINES) {
      if ((out as any)[key] != null) continue;
      const m = re.exec(line);
      if (!m) continue;
      const ya = prevOf[key];
      if (ya == null || ya === 0) continue;
      const nums = numsAfter(line.slice(m.index + m[0].length));
      for (let i = 1; i < nums.length; i++) {
        let hit = false;
        for (const sc of [1e3, 1e6, 1, 1e9]) {
          if (Math.abs(nums[i] * sc - ya) / Math.abs(ya) <= 0.015) { (out as any)[key] = nums[i - 1] * sc; (out as any)[`${key}_prev`] = ya; hit = true; break; }
        }
        if (hit) break;
      }
    }
  }
  return out;
}

const pct = (a: number | null, b: number | null) => (a != null && b != null && b !== 0 ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);
const musd = (v: number | null) => (v == null ? null : Math.round(v / 1e4) / 100);

/** Row fields for the card (USD millions, YoY %). Revenue for a bank = net interest income + non-interest income. */
export function bankRowFields(b: Partial<BankQuarter>): Record<string, number | null> {
  const rev = b.nii != null && b.nonint != null ? b.nii + b.nonint : null;
  const revP = b.nii_prev != null && b.nonint_prev != null ? b.nii_prev + b.nonint_prev : null;
  return {
    nii_curr_musd: musd(b.nii ?? null), nii_prev_musd: musd(b.nii_prev ?? null), nii_yoy_pct: pct(b.nii ?? null, b.nii_prev ?? null),
    bank_revenue_curr_musd: musd(rev), bank_revenue_prev_musd: musd(revP), bank_revenue_yoy_pct: pct(rev, revP),
    provision_curr_musd: musd(b.provision ?? null), provision_prev_musd: musd(b.provision_prev ?? null), provision_yoy_pct: pct(b.provision ?? null, b.provision_prev ?? null),
  };
}
