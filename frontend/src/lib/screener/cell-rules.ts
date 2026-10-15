// zzz1045b — the exact rule check behind a table cell's tooltip: for every applied rule on that field, the unrounded figure, the
// exact rule and whether it passes ("40.04 > 40 ✓"). When the rounded figure on screen looks equal to the rule's limit (shows 40.0%
// for "> 40"), the line says so — the exact figure decides, never the rounded one. Pure.
import type { ScreenMarket, ScreenRow } from './types';
import { fieldOf, fmtExact, fmtValue, passes, type Filter, type NumKey } from './filters';

const OPS: Record<string, string> = { gt: '>', ge: '≥', lt: '<', le: '≤', above: '>', below: '<' };
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The rounded figure the table shows equals the rounded limit, but the exact figures differ. */
export function looksAtBoundary(v: number, limit: number, key: NumKey, market: ScreenMarket): boolean {
  const unit = fieldOf(key)?.unit || 'num';
  return v !== limit && fmtValue(v, unit, market) === fmtValue(limit, unit, market);
}

export interface CellRuleLine { text: string; pass: boolean; boundary: boolean }

/** One line per applied rule that reads `key` (number, comparison and "within % above" rules). */
export function cellRuleLines(row: ScreenRow, key: NumKey, filters: readonly Filter[], market: ScreenMarket, now: Date = new Date(), exactOnly = false): CellRuleLine[] {
  const out: CellRuleLine[] = [];
  const v = row[key] as number | null | undefined;
  for (const f of filters) {
    if (f.off) continue;
    if (f.kind !== 'num' && f.kind !== 'cmp' && f.kind !== 'near') continue;
    if (f.key !== key && !((f.kind === 'cmp' || f.kind === 'near') && f.other === key)) continue;
    const pass = passes(row, f, now, exactOnly);
    const mark = pass ? '✓' : '✗';
    const approxFail = !pass && exactOnly && !!row.approx?.includes(key);
    if (f.kind === 'num') {
      if (!fin(v)) { out.push({ text: `rule ${OPS[f.op] ?? f.op} ${f.v}: figure not known ✗`, pass: false, boundary: false }); continue; }
      if (f.op === 'between') {
        const lo = Math.min(f.v, f.v2 ?? f.v), hi = Math.max(f.v, f.v2 ?? f.v);
        const boundary = looksAtBoundary(v, lo, key, market) || looksAtBoundary(v, hi, key, market);
        out.push({ text: `${fmtExact(v)} between ${lo} and ${hi} (ends included) ${mark}${approxFail ? ' (≈ figure, "Exact figures only" is on)' : ''}${boundary ? ' — the rounded figure looks like the limit; the exact figure decides' : ''}`, pass, boundary });
        continue;
      }
      const boundary = looksAtBoundary(v, f.v, key, market);
      out.push({ text: `${fmtExact(v)} ${OPS[f.op]} ${f.v} ${mark}${approxFail ? ' (≈ figure, "Exact figures only" is on)' : ''}${boundary ? ' — the rounded figure looks like the limit; the exact figure decides' : ''}`, pass, boundary });
      continue;
    }
    const a = row[f.key] as number | null | undefined, b = row[f.other] as number | null | undefined;
    const la = fieldOf(f.key)?.label || f.key, lb = fieldOf(f.other)?.label || f.other;
    if (!fin(a) || !fin(b)) { out.push({ text: `${la} vs ${lb}: a figure is not known ✗`, pass: false, boundary: false }); continue; }
    if (f.kind === 'cmp') {
      const unit = fieldOf(f.key)?.unit || 'num';
      const boundary = a !== b && fmtValue(a, unit, market) === fmtValue(b, unit, market);
      out.push({ text: `${la} ${fmtExact(a)} ${OPS[f.op]} ${lb} ${fmtExact(b)} ${mark}${boundary ? ' — the rounded figures look equal; the exact figures decide' : ''}`, pass, boundary });
      continue;
    }
    const p = b > 0 ? (a / b - 1) * 100 : NaN;
    const lo = Math.min(f.lo, f.hi), hi = Math.max(f.lo, f.hi);
    const boundary = Number.isFinite(p) && (Math.abs(p - lo) < 0.05 || Math.abs(p - hi) < 0.05) && p !== lo && p !== hi;
    out.push({ text: `${la} is ${Number.isFinite(p) ? `${Math.round(p * 1000) / 1000}%` : 'n/a'} above ${lb} — rule ${lo}–${hi}% ${mark}${boundary ? ' (very close to the limit; the exact figure decides)' : ''}`, pass, boundary });
  }
  return out;
}
