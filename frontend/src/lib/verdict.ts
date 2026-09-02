// ════════════════════════════════════════════════════════════════════════════
// verdict.ts (zzz524) — the Cockpit Verdict: cross-engine consensus for one
// symbol, with explicit CONFLICT detection. Conflicts are first-class output:
// when engines disagree (Multibagger says A-grade while Decay Watch says cash
// is rolling over) that is exactly where the owner's judgment is needed, so
// the verdict never papers over it.
// ════════════════════════════════════════════════════════════════════════════

import type { EngineView } from './engines';

export type VerdictKind = 'BUY' | 'ADD' | 'HOLD' | 'TRIM' | 'AVOID' | 'NO DATA';

export interface Verdict {
  kind: VerdictKind;
  score: number;            // -100..+100 net conviction
  chips: string[];          // supporting "why" chips
  conflicts: string[];      // explicit disagreements between engines
  engines: number;          // how many engines voted
}

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function computeVerdict(v: EngineView): Verdict {
  const chips: string[] = [];
  const conflicts: string[] = [];
  let score = 0; let engines = 0;

  // ── Fundamental engine ─────────────────────────────────────────────────────
  const fs = num(v.fundo?.score);
  if (fs != null) {
    engines++;
    if (fs >= 75) { score += 30; chips.push(`Fundo ${Math.round(fs)}${v.fundo?.grade ? ` (${v.fundo.grade})` : ''}`); }
    else if (fs >= 60) { score += 18; chips.push(`Fundo ${Math.round(fs)}`); }
    else if (fs >= 45) { score += 2; }
    else { score -= 25; chips.push(`Fundo weak ${Math.round(fs)}`); }
  }

  // ── Conviction bench ───────────────────────────────────────────────────────
  if (v.bench) {
    engines++;
    if (v.bench.tier === 'BLOCKBUSTER') { score += 25; chips.push('CB BLOCKBUSTER'); }
    else if (v.bench.tier === 'STRONG') { score += 15; chips.push('CB STRONG'); }
  }

  // ── Decay watch (quality rolling over) — a NEGATIVE engine ────────────────
  if (v.decay) {
    engines++;
    const sev = v.decay.severity;
    score -= sev === 'high' ? 30 : sev === 'med' ? 18 : 8;
    chips.push(`Decay: ${v.decay.reasons.slice(0, 2).join(' + ')}`);
    if (v.bench && (v.bench.tier === 'BLOCKBUSTER' || v.bench.tier === 'STRONG')) {
      conflicts.push(`Bench says ${v.bench.tier} but Decay Watch flags ${v.decay.reasons[0] || 'quality rollover'}`);
    }
    if (fs != null && fs >= 70) conflicts.push(`Fundo grade is strong (${Math.round(fs)}) while quality metrics roll over`);
  }

  // ── Technicals: trend position (uses last-sync MAs) ───────────────────────
  const t = v.tech;
  if (t && t.price != null && t.sma200 != null && t.sma200 > 0) {
    engines++;
    const above200 = t.price > t.sma200;
    const d50 = t.sma50 != null && t.sma50 > 0 ? (t.price - t.sma50) / t.sma50 * 100 : null;
    if (above200) { score += 12; chips.push('above 200DMA'); } else { score -= 15; chips.push('below 200DMA'); }
    if (d50 != null && Math.abs(d50) <= 4 && above200) { score += 8; chips.push('at 50DMA pivot'); }
    if (d50 != null && d50 > 25) { score -= 6; chips.push(`extended +${d50.toFixed(0)}% vs 50DMA`); }
    if (t.rs != null && t.rs >= 80) { score += 6; chips.push(`RS ${Math.round(t.rs)}`); }
    if (!above200 && fs != null && fs >= 70) conflicts.push('Strong fundamentals but broken chart (below 200DMA)');
    if (above200 && fs != null && fs < 45) conflicts.push('Chart fine but fundamentals graded weak — momentum without quality');
  }

  // ── Valuation save ────────────────────────────────────────────────────────
  const fair = num(v.valuation?.fairValue);
  const px = num(v.tech?.price);
  if (fair != null && px != null && px > 0) {
    engines++;
    const up = (fair / px - 1) * 100;
    if (up >= 25) { score += 12; chips.push(`valuation +${up.toFixed(0)}% upside`); }
    else if (up <= -15) { score -= 12; chips.push(`valuation ${up.toFixed(0)}% (rich)`); }
    if (up <= -15 && (v.bench || (fs != null && fs >= 70))) conflicts.push('Engines like the business but your own valuation says it is rich');
  }

  // ── Holding context (turns BUY into ADD, negatives into TRIM) ─────────────
  const held = !!v.holding;
  if (held) engines++;

  let kind: VerdictKind;
  if (engines === 0) kind = 'NO DATA';
  else if (score >= 45) kind = held ? 'ADD' : 'BUY';
  else if (score >= 15) kind = 'HOLD';
  else if (score >= -15) kind = held ? 'HOLD' : 'AVOID';
  else kind = held ? 'TRIM' : 'AVOID';

  return { kind, score: Math.round(score), chips: chips.slice(0, 6), conflicts, engines };
}

export const VERDICT_COLOR: Record<VerdictKind, string> = {
  BUY: 'var(--mc-bullish)', ADD: 'var(--mc-bullish)', HOLD: 'var(--mc-cyan)',
  TRIM: 'var(--mc-warn)', AVOID: 'var(--mc-bearish)', 'NO DATA': 'var(--mc-text-4)',
};
