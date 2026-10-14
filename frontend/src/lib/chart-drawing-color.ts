// zzz1018 — the default colour of chart drawings follows the chart theme (owner: "by default trendline white on a dark
// background and blue on a white background"). A drawing saved without a colour, or in the old default blue, is a "default
// colour" drawing: it is drawn white on dark and blue on white, and changes when the theme is switched. A picked colour is kept.
export const DRAWING_BLUE = '#2962FF';
export const DRAWING_WHITE = '#FFFFFF';
export const drawingAutoColor = (light: boolean): string => (light ? DRAWING_BLUE : DRAWING_WHITE);
/** true when a saved drawing should take the theme's default colour */
export function isAutoDrawingColor(color: string | null | undefined): boolean {
  if (!color) return true;
  return color.trim().toUpperCase() === DRAWING_BLUE;
}
