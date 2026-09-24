// ═══════════════════════════════════════════════════════════════════════════
// US PERSISTENT CATALYSTS — THE SHARED DETECTOR, FED US INPUTS.       (zzz793)
//
// The India detector (lib/catalyst/persistence detectPersistentCatalysts) and
// its Special Focus gate are used UNCHANGED. What was wrong on the US page was
// the inputs:
//   · quarterRevenueCr — India's order-book coverage test reads the order book
//     (scaledNumber, raw units) ÷ 1e7 against "quarterly revenue in crore".
//     The US row has no crore revenue, so coverage was never computed. The US
//     quarter's revenue in USD, expressed on the SAME scale (raw ÷ 1e7, i.e.
//     USD millions ÷ 10), makes the ratio exact — a unitless multiple of
//     annual revenue, nothing converted to rupees.
//   · the filed order backlog — us-gaap RevenueRemainingPerformanceObligation
//     is a FILED figure in every 10-Q / 10-K that tags it. It enters the
//     detector as ledger facts dated by the filing that carried each reading
//     (current, and the same quarter a year earlier), exactly as a read
//     document's order book would. Two filed readings a year apart are two
//     independent evidence periods — India's own rule, not a looser one.
// No price, no model.
// ═══════════════════════════════════════════════════════════════════════════

import { detectPersistentCatalysts, type PersistentCatalyst } from '@/lib/catalyst/persistence';
import { reportingPeriodFromDate } from '@/lib/thesis/evidence-ledger';
import { usdWords, niceDate, type UsRpo } from './xbrl';

interface DetectRow { symbol: string; ledger?: any; assessment?: any; capex?: any; graded?: any; sec?: any }

const rpoOf = (r: DetectRow): UsRpo | null => (r.graded?.rpo || r.sec?.rpo || null) as UsRpo | null;

/** The quarter's revenue on the detector's scale (raw USD ÷ 1e7). */
export function usQuarterRevenueScale(graded: any): number | null {
  const m = typeof graded?.revenue_curr_musd === 'number' ? graded.revenue_curr_musd : null;
  return m != null && m > 0 && (!graded?.currency || graded.currency === 'USD') ? m / 10 : null;
}

/** The row's ledger with the filed RPO readings added as order-book facts. */
export function usLedgerWithRpo(row: DetectRow): any {
  const rpo = rpoOf(row);
  const base = row.ledger && typeof row.ledger === 'object' ? row.ledger : { ticker: row.symbol, periods: {}, latest_period: null };
  if (!rpo) return row.ledger || null;
  const cik = row.sec?.cik || null;
  const url = cik ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${String(cik).padStart(10, '0')}&type=10-&dateb=&owner=include&count=40` : null;
  const fact = (r: { end: string; value: number; filed: string; form: string }, before: { end: string; value: number } | null) => {
    const period = reportingPeriodFromDate(r.filed || r.end)?.period || 'UNDATED';
    const quote = `Remaining performance obligations (us-gaap:RevenueRemainingPerformanceObligation) ${usdWords(r.value)} at ${niceDate(r.end)}${before ? `, against ${usdWords(before.value)} at ${niceDate(before.end)}` : ''} — ${r.form} filed ${r.filed}, SEC XBRL.`;
    return {
      period,
      f: {
        id: `xbrl-rpo:${row.symbol}:${r.end}`, ticker: row.symbol, reporting_period: period, evidence_type: 'mechanism',
        metric_name: 'order_book', metric_label: 'Order book (remaining performance obligations, SEC XBRL)',
        value: usdWords(r.value), after_value: usdWords(r.value), before_value: before ? usdWords(before.value) : null, unit: null,
        delta: null, direction: before ? (r.value > before.value ? 'up' : r.value < before.value ? 'down' : 'flat') : 'unknown',
        source_document_id: null, source_name: `${r.form} (SEC XBRL, filed ${r.filed})`, source_date: r.filed || null, source_type: 'results',
        source_quote: quote, fact_or_management_statement: 'FACT', confidence: 'HIGH', evidence_quality: 'sentence',
        effective_date: r.end, source_url: url, record_status: 'ACTIVE', extracted_at: r.filed, updated_at: r.filed,
      },
    };
  };
  const add = [fact(rpo.cur, rpo.prev), ...(rpo.prev ? [fact(rpo.prev, null)] : [])];
  const periods: Record<string, any> = { ...(base.periods || {}) };
  for (const { period, f } of add) {
    const p = periods[period] || { reporting_period: period, documents: [], facts: [], events: [], summary: null };
    // A figure already on file for the same metric and value is not added twice.
    if (!(p.facts || []).some((x: any) => x.metric_name === 'order_book' && x.after_value === f.after_value)) periods[period] = { ...p, facts: [...(p.facts || []), f] };
  }
  return { ...base, periods };
}

/** Persistent catalysts for a US row — the India detector on US inputs. */
export function usDetect(row: DetectRow): PersistentCatalyst[] {
  if (!row?.symbol) return [];
  const ledger = usLedgerWithRpo(row);
  if (!ledger && !row.assessment) return [];
  try {
    return detectPersistentCatalysts({ ticker: row.symbol, ledger, assessment: row.assessment, capex: row.capex ?? null, origin: 'portfolio',
      quarterRevenueCr: usQuarterRevenueScale(row.graded) });
  } catch { return []; }
}
