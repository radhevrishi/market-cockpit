'use client';

// ════════════════════════════════════════════════════════════════════════════
// Sparkline (zzz527) — a tiny inline price line for cards. Pure SVG, no deps.
// Colors itself by net direction; marks the last point with a dot. Theme-safe:
// stroke colors come from the mc CSS variables.
// ════════════════════════════════════════════════════════════════════════════

export default function Sparkline({ data, width = 64, height = 18, strokeWidth = 1.5 }: {
  data: number[] | null | undefined; width?: number; height?: number; strokeWidth?: number;
}) {
  if (!Array.isArray(data) || data.length < 3) return null;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pad = 2;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2);
    const y = pad + (1 - (v - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });
  const up = data[data.length - 1] >= data[0];
  const color = up ? 'var(--mc-bullish)' : 'var(--mc-bearish)';
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: 'block', flexShrink: 0 }} aria-hidden>
      <path d={d} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
      <circle cx={lx} cy={ly} r={1.8} fill={color} />
    </svg>
  );
}
