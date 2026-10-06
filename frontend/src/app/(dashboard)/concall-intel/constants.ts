// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

export const KW_GROUP_COLORS: Record<string, string> = {
  RISK: '#EF4444',
  OPPORTUNITY: '#10B981',
  THEME: '#A78BFA',
  REGULATORY: '#F59E0B',
  SECTOR: '#22D3EE',
};

// ═══════════════════════════════════════════════════════════════════════════
// zzz432 — MULTIBAGGER TRANSFORMATION FRAMEWORK (Concall AI)
// "Find the company before the earnings fully reveal what it is becoming."
// The auto-radar (TransformationRadar) runs on every analysed transcript; the
// TransformationFrameworkTab is the full hunting playbook + case studies.
// ═══════════════════════════════════════════════════════════════════════════
export const TF = {
  card: 'var(--mc-bg-1)', card2: 'var(--mc-bg-2)', border: 'var(--mc-bg-4)',
  text: 'var(--mc-text-1)', text2: 'var(--mc-text-2)', muted: 'var(--mc-text-3)', dim: 'var(--mc-text-4)',
  green: 'var(--mc-bullish)', amber: 'var(--mc-warn)', red: 'var(--mc-bearish)', cyan: 'var(--mc-cyan)', purple: '#A78BFA', saffron: '#F0883E',
};

export const TFM = { fontFamily: 'ui-monospace,"SF Mono",Menlo,monospace' } as const;

export const TIER_COLOR: Record<string, string> = {
  ULTRA_BULLISH: '#F59E0B', BULLISH: '#10B981', MIXED_POSITIVE: '#60A5FA',
  NEUTRAL: '#94A3B8', MIXED_NEGATIVE: '#F0883E', BEARISH: '#EF4444',
};

export const CONV_TIER_COLOR: Record<string, string> = { BLOCKBUSTER: '#F59E0B', STRONG: '#10B981', MIXED: '#94A3B8', AVOID: '#EF4444' };
