// ═══════════════════════════════════════════════════════════════════════════
// zzz1068 — ONE LOOK FOR THE CONVICTION BEATS METRIC LINE (India + US). Pure.
//
// The owner (18 Oct 2026): add DEBT / EQUITY beside ROCE · ROE, colour every
// figure the same way (green good · amber middling · red poor · grey unknown),
// and never show "—" for a profit that TURNED from a loss (SOLARA, E2E, VIJIFIN:
// growth is undefined, the answer is "turned profitable").
//
// D/E comes from the stock-screener snapshot (latest-quarter `de`, else the
// fiscal-year `deFY`). A missing value is "—" with a tooltip saying so — never a
// guessed number. The snapshot writes 99 for negative equity; that is shown as
// "negative equity", not as 99×.
// ═══════════════════════════════════════════════════════════════════════════

export type MetricTone = 'good' | 'warn' | 'bad' | 'none';
export const TONE_COLOR: Record<MetricTone, string> = {
  good: 'var(--mc-bullish)', warn: '#D97706', bad: 'var(--mc-bearish)', none: 'var(--mc-text-4)',
};
export interface MetricCell { label: string; text: string; tone: MetricTone; title: string }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** At or below this the company is called debt-free. */
export const DE_DEBT_FREE = 0.05;
/** The snapshot's marker for negative equity. */
export const DE_NEG_EQUITY = 99;
export const DE_MAX_OPTIONS: ReadonlyArray<{ v: number; lbl: string }> = [{ v: 0.3, lbl: '≤0.3' }, { v: 0.5, lbl: '≤0.5' }, { v: 1, lbl: '≤1' }];

/** The D/E a card uses from a snapshot row: latest quarter first, else the fiscal year. */
export function deFromSnapshotRow(r: any): { de: number; basis: 'latest quarter' | 'fiscal year' } | null {
  if (!r) return null;
  if (fin(r.de) && r.de >= 0) return { de: r.de, basis: 'latest quarter' };
  if (fin(r.deFY) && r.deFY >= 0) return { de: r.deFY, basis: 'fiscal year' };
  return null;
}

/** ticker → D/E from the slim snapshot rows (`t`, `de`, `deFY`). */
export function deIndex(rows: ReadonlyArray<any> | null | undefined): Record<string, { de: number; basis: string }> {
  const out: Record<string, { de: number; basis: string }> = {};
  for (const r of rows || []) {
    const t = String(r?.t || '').toUpperCase();
    const v = deFromSnapshotRow(r);
    if (t && v) out[t] = v;
  }
  return out;
}

export function deTone(de: number): MetricTone {
  if (de >= DE_NEG_EQUITY) return 'bad';
  return de <= 0.5 ? 'good' : de <= 1 ? 'warn' : 'bad';
}

/** The D/E cell. `lender` → "n/a (lender)". */
export function deCell(de: unknown, basis: unknown, lender: boolean): MetricCell {
  const label = 'D/E';
  if (lender) return { label, text: 'n/a (lender)', tone: 'none', title: 'Debt ÷ equity is not meaningful for banks, NBFCs and insurers — borrowing is their raw material.' };
  if (!fin(de) || de < 0) return { label, text: '—', tone: 'none', title: 'Debt ÷ equity is not in the source for this company yet (the stock-screener snapshot has no balance-sheet figure for it). Not a fail.' };
  const b = typeof basis === 'string' && basis ? ` (${basis})` : '';
  if (de >= DE_NEG_EQUITY) return { label, text: 'negative equity', tone: 'bad', title: `Shareholders' equity is negative${b} — debt ÷ equity has no meaning; a balance-sheet red flag.` };
  if (de <= DE_DEBT_FREE) return { label, text: 'debt-free', tone: 'good', title: `Debt ÷ equity ${de.toFixed(2)}×${b} — practically no borrowings.` };
  return { label, text: `${de.toFixed(2)}×`, tone: deTone(de), title: `Debt ÷ equity ${de.toFixed(2)}×${b}. Green ≤ 0.5×, amber 0.5–1×, red above 1×.` };
}

/** D/E MAX filter: lenders and unknown D/E pass (not a fail); a known D/E above the limit fails. */
export function passesDeMax(de: unknown, lender: boolean, max: number | null | undefined): boolean {
  if (max == null || lender) return true;
  if (!fin(de) || de < 0) return true;
  return de <= max;
}

/** ROCE / ROE cell: green at the bar, amber above zero, red at or below zero. */
export function returnCell(label: 'ROCE' | 'ROE', v: unknown, bar: number): MetricCell {
  if (!fin(v)) return { label, text: '—', tone: 'none', title: `${label} is not in the source for this company yet. Not a fail.` };
  const tone: MetricTone = v >= bar ? 'good' : v > 0 ? 'warn' : 'bad';
  return { label, text: `${v.toFixed(1)}%`, tone, title: `${label} ${v.toFixed(1)}%. Green at ${bar}% or more, amber below, red at or below zero.` };
}

/** A growth figure (Sales / PAT / EPS YoY). A profit that turned from a loss reads "turned profitable". */
export function growthCell(label: string, yoy: unknown, curr: unknown, prev: unknown): MetricCell {
  if (fin(yoy)) return { label, text: `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`, tone: yoy >= 0 ? 'good' : 'bad', title: `${label} ${yoy.toFixed(1)}% year on year.` };
  if (fin(curr) && fin(prev)) {
    if (prev <= 0 && curr > 0) return { label, text: 'turned profitable', tone: 'good', title: `A loss (${prev}) a year ago, a profit (${curr}) now — a growth rate off a loss has no meaning.` };
    if (prev < 0 && curr <= 0) return { label, text: curr > prev ? 'loss narrowed' : 'loss widened', tone: curr > prev ? 'warn' : 'bad', title: `Still a loss: ${curr} now vs ${prev} a year ago.` };
  }
  return { label, text: '—', tone: 'none', title: `${label} growth is not in the source yet.` };
}

/** P/E cell on its own absolute bands (the sector comparison stays on the card's tooltip). */
export function peTone(pe: number): MetricTone {
  return pe > 100 ? 'bad' : pe > 60 ? 'warn' : pe > 30 ? 'warn' : 'good';
}
/** PEG tone: < 1 good, 1–2 amber, > 2 red (a PEG under 0.15 is a low-base artefact: amber). */
export function pegTone(peg: number): MetricTone {
  return peg < 0.15 ? 'warn' : peg < 1 ? 'good' : peg < 2 ? 'warn' : 'bad';
}
/** Cash conversion (CFO ÷ profit) tone: ≥ 0.8 good, 0.5–0.8 amber, below red. */
export function cashTone(r: number): MetricTone {
  return r >= 0.8 ? 'good' : r >= 0.5 ? 'warn' : 'bad';
}
