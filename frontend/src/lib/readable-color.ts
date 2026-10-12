// zzz967 (UI-01) — legend numbers must be readable whatever colour the user picked for the line. The swatch keeps the
// user's colour; the number is darkened (white theme) or lightened (dark theme) just enough to reach 4.5:1 contrast.
function parse(hex: string): [number, number, number] | null {
  const m = String(hex || '').trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) { const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1]; return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]; }
  const r = String(hex || '').match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  return r ? [Number(r[1]), Number(r[2]), Number(r[3])] : null;
}
const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
export function relLum(rgb: [number, number, number]): number { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
export function contrast(a: string, b: string): number | null {
  const x = parse(a), y = parse(b); if (!x || !y) return null;
  const l1 = relLum(x), l2 = relLum(y); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
const hex = (rgb: number[]) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
/** The colour itself when it already reads at `min`:1 on `bg`; otherwise the same hue moved toward black or white until it does. */
export function readableOn(color: string, bg: string, min = 4.5): string {
  const c = parse(color), b = parse(bg);
  if (!c || !b) return color;
  if ((contrast(color, bg) ?? 0) >= min) return color;
  const toward = relLum(b) > 0.5 ? [0, 0, 0] : [255, 255, 255];
  for (let t = 0.05; t <= 1.0001; t += 0.05) {
    const mix = c.map((v, i) => v + (toward[i] - v) * t);
    const h = hex(mix);
    if ((contrast(h, bg) ?? 0) >= min) return h;
  }
  return hex(toward);
}
