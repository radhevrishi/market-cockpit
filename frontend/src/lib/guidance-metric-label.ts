// zzz1117 / zzz1134 — the measure's own words ("Total revenue", "Core revenue", an OTHER measure's name), from the phrase the figure
// was read from. Pure, no imports (the guidance engine uses it and may import only pure modules).
export function measureLabel(metric: string, raw: string | null | undefined, base: string): string {
  const r = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!r) return base;
  if (metric === 'REVENUE' || metric === 'REVENUE_GROWTH') {
    const q = /\b(total|core|product|services?|subscription|recurring|platform|SPL|program-related|license|organic|net)\s+(?:[a-z]+\s+)?revenues?\b/i.exec(r);
    if (q && !/^net$/i.test(q[1])) return `${q[1].charAt(0).toUpperCase()}${q[1].slice(1).toLowerCase().replace(/^spl$/, 'SPL')} ${base.toLowerCase()}`;
    return base;
  }
  if (metric === 'OTHER') {
    const head = r.split(/[\d$₹€£(]/)[0].replace(/\bSG\s*&?\s*A\b/g, 'SGxANDxA').replace(/\b(?:a|an|as|of|to|is|at|be|in|for|its|between|from|range|guidance|expected|expects?|we|our|the|now|raised?|raising|approximately|about|around)\b/gi, ' ').replace(/[^A-Za-z&\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const w = head.split(' ').filter(Boolean).slice(-4).join(' ').replace(/SGxANDxA/g, 'SG&A');
    return w.length >= 4 ? w.charAt(0).toUpperCase() + w.slice(1) : base;
  }
  return base;
}
