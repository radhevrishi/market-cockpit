// zzz937 — the custom pieces registered with KLineChart for /charts: the moving-average indicator (computed with
// lib/chart-math so it is unit-tested), a horizontal line with its price label on the right edge, a rectangle, a text
// note and the measure tool. Browser-only: this module is imported from inside a useEffect.
import * as kc from 'klinecharts';
import { barsBetween, ema, fmtPrice, measureLabel } from '@/lib/chart-math';

let registered = false;

const alpha = (hex: string, a: number) => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return `rgba(41,98,255,${a})`;
  return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
};
const pricePrecision = (chart: kc.Chart) => chart.getSymbol()?.pricePrecision ?? 2;
const lineColor = (o: kc.Overlay<any>) => String((o.styles as any)?.line?.color || '#2962FF');

export function registerChartExtras(): typeof kc {
  if (registered) return kc;
  registered = true;

  // Moving averages (EMA), one line per period; colours come from the indicator's styles.lines.
  kc.registerIndicator<Record<string, number>, number>({
    name: 'MC_EMA',
    shortName: 'EMA',
    series: 'price',
    precision: 2,
    calcParams: [21, 50, 89],
    shouldOhlc: false,
    figures: [],
    regenerateFigures: (params) => params.map((p, i) => ({ key: `e${i}`, title: `EMA ${p}: `, type: 'line' })),
    calc: (dataList, indicator) => {
      const closes = dataList.map((d) => d.close);
      const lines = indicator.calcParams.map((p) => ema(closes, Number(p)));
      return dataList.map((_, i) => {
        const row: Record<string, number> = {};
        lines.forEach((l, k) => { const v = l[i]; if (v != null) row[`e${k}`] = v; });
        return row;
      });
    },
  });

  // Horizontal support / resistance line, price label always shown on the right edge.
  kc.registerOverlay({
    name: 'mcHLine',
    totalStep: 2,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: ({ coordinates, bounding }) => [
      { type: 'line', attrs: { coordinates: [{ x: 0, y: coordinates[0].y }, { x: bounding.width, y: coordinates[0].y }] } },
    ],
    createYAxisFigures: ({ chart, overlay, coordinates, bounding, yAxis }) => {
      const v = overlay.points[0]?.value;
      if (typeof v !== 'number') return [];
      const fromZero = yAxis?.isFromZero() ?? false;
      const c = lineColor(overlay);
      return [{
        type: 'text',
        ignoreEvent: true,
        attrs: { x: fromZero ? 0 : bounding.width, y: coordinates[0].y, text: fmtPrice(v, pricePrecision(chart)), align: fromZero ? 'left' : 'right', baseline: 'middle' },
        styles: { color: '#ffffff', backgroundColor: c, borderColor: c, borderRadius: 2, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, size: 11 },
      }];
    },
  });

  // Rectangle (two corners).
  kc.registerOverlay({
    name: 'mcRect',
    totalStep: 3,
    needDefaultPointFigure: true,
    needDefaultXAxisFigure: true,
    needDefaultYAxisFigure: true,
    createPointFigures: ({ coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      const c = lineColor(overlay);
      return [{
        type: 'rect',
        attrs: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) },
        styles: { style: 'stroke_fill', color: alpha(c, 0.12), borderColor: c, borderSize: 1 },
      }];
    },
  });

  // Text note at one point; the text lives in extendData.
  kc.registerOverlay<string>({
    name: 'mcText',
    totalStep: 2,
    needDefaultPointFigure: false,
    createPointFigures: ({ coordinates, overlay }) => [{
      type: 'text',
      attrs: { x: coordinates[0].x, y: coordinates[0].y, text: String(overlay.extendData || 'Note'), align: 'left', baseline: 'bottom' },
      styles: { color: lineColor(overlay), backgroundColor: 'rgba(0,0,0,0)', size: 13, weight: 600 },
    }],
  });

  // Measure: drag A → B; shaded box plus "+112.63 (+17.76%) · 34 bars".
  kc.registerOverlay({
    name: 'mcMeasure',
    totalStep: 3,
    needDefaultPointFigure: false,
    createPointFigures: ({ chart, coordinates, overlay }) => {
      if (coordinates.length < 2) return [];
      const [a, b] = coordinates;
      const p0 = overlay.points[0]?.value, p1 = overlay.points[1]?.value;
      const t0 = overlay.points[0]?.timestamp, t1 = overlay.points[1]?.timestamp;
      if (typeof p0 !== 'number' || typeof p1 !== 'number') return [];
      const times = chart.getDataList().map((d) => d.timestamp);
      const bars = typeof t0 === 'number' && typeof t1 === 'number' ? barsBetween(times, t0, t1) : 0;
      const up = p1 >= p0;
      const c = up ? '#1E88E5' : '#E53935';
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      const label = measureLabel(p0, p1, bars, pricePrecision(chart));
      return [
        { type: 'rect', ignoreEvent: true, attrs: { x, y, width: w, height: h }, styles: { style: 'fill', color: alpha(c, 0.14) } },
        { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: a.x, y: (a.y + b.y) / 2 }, { x: b.x, y: (a.y + b.y) / 2 }] }, styles: { color: c, size: 1 } },
        { type: 'line', ignoreEvent: true, attrs: { coordinates: [{ x: (a.x + b.x) / 2, y: a.y }, { x: (a.x + b.x) / 2, y: b.y }] }, styles: { color: c, size: 1 } },
        {
          type: 'text', ignoreEvent: true,
          attrs: { x: x + w / 2, y: up ? y - 6 : y + h + 6, text: label, align: 'center', baseline: up ? 'bottom' : 'top' },
          styles: { color: '#ffffff', backgroundColor: c, borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, size: 12, weight: 600 },
        },
      ];
    },
  });

  return kc;
}
