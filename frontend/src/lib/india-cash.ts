// ═══════════════════════════════════════════════════════════════════════════
// SAME-FISCAL-YEAR CASH (zzz821) — see the note above `sameFyCash` in
// app/api/v1/earnings/enrich/route.ts. Pure; kept here so it can be tested.
// ═══════════════════════════════════════════════════════════════════════════

export type LabelledTable = { labels: string[]; rows: Record<string, (number | null)[]> } | null;
export function sameFyCash(cf: LabelledTable, pl: LabelledTable): {
  ocf_annual_cr: number | null; pat_annual_cr: number | null; ocf_to_pat_ratio: number | null;
  cash_fy: string | null; cash_basis: string | null;
} {
  const none = { ocf_annual_cr: null, pat_annual_cr: null, ocf_to_pat_ratio: null, cash_fy: null, cash_basis: null };
  if (!cf || !pl) return none;
  const isFY = (lb: string) => /^[A-Za-z]{3}\s+\d{4}$/.test(String(lb || '').trim());
  const rowOf = (t: NonNullable<LabelledTable>, re: RegExp) => {
    const k = Object.keys(t.rows).find((kk) => re.test(kk));
    return k ? t.rows[k] : null;
  };
  const cfo = rowOf(cf, /cash\s+from\s+operating/i);
  const pat = rowOf(pl, /^\s*net\s+profit/i) ?? rowOf(pl, /^\s*profit\s+for/i);
  const sales = rowOf(pl, /^\s*(sales|revenue)/i);
  if (!cfo || !pat || cf.labels.length !== cfo.length || pl.labels.length !== pat.length) return none;
  for (let i = cf.labels.length - 1; i >= 0; i--) {
    const lb = String(cf.labels[i] || '').trim();
    if (!isFY(lb)) continue;
    const c = cfo[i];
    // Screener prints 0 where a figure is absent; a real operating cash flow
    // of exactly zero is vanishingly rare, so 0 is "not reported".
    // Only the LATEST fiscal year is used: falling back to an older year
    // would be a different period from the one being graded.
    if (c == null || c === 0) return none;
    const j = pl.labels.findIndex((x) => String(x || '').trim() === lb);
    if (j < 0) return none;
    const p = pat[j];
    if (p == null || p === 0) return none;
    const sv = sales && sales.length === pl.labels.length ? sales[j] : null;
    let ratio: number | null = p > 0 ? Math.round((c / p) * 100) / 100 : null;
    // zzz364 meaningfulness guard, kept: a profit under 2% of sales, or a ratio
    // beyond ±8x, says nothing about cash conversion.
    if (ratio != null && ((typeof sv === 'number' && sv !== 0 && Math.abs(p) < 0.02 * Math.abs(sv)) || Math.abs(ratio) > 8)) ratio = null;
    const [mon, yr] = lb.split(/\s+/);
    const basis = /^mar$/i.test(mon) ? `FY${yr.slice(-2)} full year` : `year to ${lb}`;
    return { ocf_annual_cr: c, pat_annual_cr: p, ocf_to_pat_ratio: ratio, cash_fy: lb, cash_basis: basis };
  }
  return none;
}

