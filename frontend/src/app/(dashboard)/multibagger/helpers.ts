// Moved verbatim out of page.tsx (pure refactor, no behaviour change).

// zzz412 — Weinstein 4-stage classification (ADDITIVE — sits alongside the
// existing binary `stage2` used elsewhere; does not replace it). Pure helper,
// module-scope, NOT exported (this is a Next.js page file). Guards against
// missing fields and never throws — returns Stage 1 (basing) as the safe
// default when the moving averages are absent.
//   Stage 2 (advancing): price>200DMA AND 50DMA>200DMA AND 3m perf up
//   Stage 4 (declining):  price<200DMA AND 50DMA<200DMA AND 3m perf down
//   Stage 3 (topping):    near/just-below the 200DMA with rolled-over 3m perf
//                         and elevated distance from a recent high, else the
//                         "above 200 but momentum broken / recently strong" bucket
//   Stage 1 (basing):     everything else (below/around 200, not breaking down)
export function classifyStage(r: any): 1 | 2 | 3 | 4 {
  if (!r) return 1;
  const price = typeof r.price === 'number' && Number.isFinite(r.price) ? r.price : null;
  const sma50 = typeof r.sma50 === 'number' && Number.isFinite(r.sma50) ? r.sma50 : null;
  const sma200raw = typeof r.sma200 === 'number' && Number.isFinite(r.sma200) ? r.sma200
    : (typeof r.sma150 === 'number' && Number.isFinite(r.sma150) ? r.sma150 : null);
  // Missing moving averages → can't classify a trend; safe default is Stage 1.
  if (price == null || sma50 == null || sma200raw == null) return 1;
  const sma200 = sma200raw;
  const p3 = typeof r.perf3m === 'number' && Number.isFinite(r.perf3m) ? r.perf3m : 0;
  const dist = typeof r.distFromHigh === 'number' && Number.isFinite(r.distFromHigh) ? r.distFromHigh : null;
  const relVol = typeof r.relVol1w === 'number' && Number.isFinite(r.relVol1w) ? r.relVol1w : null;

  // Stage 2 — advancing
  if (price > sma200 && sma50 > sma200 && p3 > 0) return 2;
  // Stage 4 — declining (the critical exit signal)
  if (price < sma200 && sma50 < sma200 && p3 < 0) return 4;
  // Stage 3 — topping: near/just-below the 200DMA with a negative-ish 3m perf
  // and elevated distance from a recent high (or a heavy-volume slip below 50DMA).
  const nearBelow200 = price <= sma200 * 1.05 && price >= sma200 * 0.90;
  if ((nearBelow200 && p3 <= 0)
      || (p3 < 0 && dist != null && dist <= -12)
      || (p3 <= 0 && relVol != null && relVol >= 1.5 && price < sma50)) {
    return 3;
  }
  // "not clearly 2 or 4 but was recently strong": above the 200 yet momentum
  // has rolled over → still a topping pattern.
  if (price > sma200 && p3 <= 0) return 3;
  // Stage 1 — basing.
  return 1;
}

// zzz412 — presentation metadata for the per-row stage badge.
export const STAGE_META: Record<1 | 2 | 3 | 4, { label: string; color: string; bg: string; title: string }> = {
  2: { label: 'St2',   color: '#10B981', bg: 'rgba(16,185,129,0.14)',  title: 'Weinstein Stage 2 · advancing (price>200DMA · 50>200DMA · 3m up)' },
  3: { label: 'St3',   color: '#F59E0B', bg: 'rgba(245,158,11,0.14)',  title: 'Weinstein Stage 3 · topping (momentum rolled over near/below the 200DMA)' },
  4: { label: 'St4 ⚠', color: '#EF4444', bg: 'rgba(239,68,68,0.16)',   title: 'Weinstein Stage 4 · declining (price<200DMA · 50<200DMA · 3m down) — technical EXIT signal' },
  1: { label: 'St1',   color: '#94A3B8', bg: 'rgba(148,163,184,0.14)', title: 'Weinstein Stage 1 · basing (below/around the 200DMA, not clearly breaking down)' },
};
