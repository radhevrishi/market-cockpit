// zzz1055 — FII / DII page: Indian number formatting (pure, unit-tested). ₹ crore below 1 lakh crore, "L Cr" above.

const grp = (v: number, digits = 0) => v.toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** 5285.37 → '₹5,285 Cr'; 507517 → '₹5.08 L Cr'; signed adds '+' for positives. null → '—'. */
export function fmtCr(v: number | null | undefined, opts: { signed?: boolean; digits?: number } = {}): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const sign = v < 0 ? '−' : opts.signed && v > 0 ? '+' : '';
  if (a >= 100_000) return `${sign}₹${(a / 100_000).toFixed(2)} L Cr`;
  return `${sign}₹${grp(a, opts.digits ?? 0)} Cr`;
}

/** Axis label: short, no decimals for big numbers. */
export function fmtAxisCr(v: number): string {
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 100_000) return `${s}${(a / 100_000).toFixed(a >= 1_000_000 ? 0 : 1)}L`;
  if (a >= 1000) return `${s}${grp(Math.round(a / 1000))}k`;
  return `${s}${grp(Math.round(a))}`;
}

export function fmtPct(v: number | null | undefined, signed = false): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${signed && v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '2026-10-15' → '15 Oct 2026' (or '15 Oct' when short). */
export function fmtDate(iso: string | null | undefined, short = false): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return short ? `${d} ${MON[m - 1]}` : `${d} ${MON[m - 1]} ${y}`;
}

export const GREEN = '#047857';
export const RED = '#b91c1c';
export const flowColor = (v: number | null | undefined) => (v == null ? '#475569' : v >= 0 ? GREEN : RED);
