// zzz937 — the custom pieces registered with KLineChart for /charts: the moving-average indicator (computed with
// lib/chart-math so it is unit-tested), a horizontal line with its price label on the right edge, a rectangle, a text
// note and the measure tool. Browser-only: this module is imported from inside a useEffect.
import * as kc from 'klinecharts';
import { atr, barsBetween, ema, fitPriceRange, fmtPrice, macd, measureLabel, rsi, type Bar } from '@/lib/chart-math';
import { seriesValues, type PriceSeries } from '@/lib/chart-layouts';
import { textOnColor } from '@/lib/readable-color';

const toBars = (list: kc.KLineData[]): Bar[] => list.map((d) => ({ t: d.timestamp, o: d.open, h: d.high, l: d.low, c: d.close, v: d.volume ?? 0 }));
const rows = <T extends Record<string, number>>(n: number, cols: Record<string, (number | null)[]>): T[] => {
  const out: T[] = [];
  for (let i = 0; i < n; i++) { const r: Record<string, number> = {}; for (const [k, arr] of Object.entries(cols)) { const v = arr[i]; if (v != null && Number.isFinite(v)) r[k] = v; } out.push(r as T); }
  return out;
};

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

  // zzz944 — every price-pane line of a layout (EMA / SMA lines, Bollinger Bands, Supertrend) in one indicator; the series are
  // in extendData, colours in styles.lines. Its own legend is drawn by the page (with an eye toggle), so the library's is off.
  kc.registerIndicator<Record<string, number>, number, PriceSeries[]>({
    name: 'MC_LINES',
    shortName: 'Lines',
    series: 'price',
    precision: 2,
    calcParams: [],
    shouldOhlc: false,
    figures: [],
    regenerateFigures: (params) => params.map((_, i) => ({ key: `s${i}`, title: '', type: 'line' })),
    // the page draws this legend itself (values in the line colours + an eye toggle), so the library's row stays empty
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    calc: (dataList, indicator) => {
      const bars = toBars(dataList);
      const specs = indicator.extendData || [];
      const cols: Record<string, (number | null)[]> = {};
      specs.forEach((sp, i) => { cols[`s${i}`] = seriesValues(sp, bars); });
      return rows(dataList.length, cols);
    },
  });
  kc.registerIndicator<Record<string, number>, number>({
    name: 'MC_RSI', shortName: 'RSI', series: 'normal', precision: 2, calcParams: [14], minValue: 0, maxValue: 100,
    figures: [
      { key: 'rsi', title: 'RSI: ', type: 'line' },
      { key: 'r70', title: '', type: 'line' }, { key: 'r50', title: '', type: 'line' }, { key: 'r30', title: '', type: 'line' },
    ],
    // only the RSI value in the pane's top line (not the 70 / 50 / 30 guide lines)
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const list = indicator.result as Array<Record<string, number>>;
      const i = typeof crosshair.dataIndex === 'number' ? crosshair.dataIndex : list.length - 1;
      const v = list[i]?.rsi;
      const color = String((indicator.styles as any)?.lines?.[0]?.color || '#7E57C2');
      return { name: `RSI ${indicator.calcParams[0]}`, calcParamsText: '', features: [], legends: [{ title: '', value: { text: v != null ? v.toFixed(2) : '—', color } }] };
    },
    calc: (dataList, indicator) => {
      const r = rsi(dataList.map((d) => d.close), Number(indicator.calcParams[0]) || 14);
      return rows(dataList.length, { rsi: r, r70: dataList.map(() => 70), r50: dataList.map(() => 50), r30: dataList.map(() => 30) });
    },
  });
  kc.registerIndicator<Record<string, number>, number>({
    name: 'MC_MACD', shortName: 'MACD', series: 'normal', precision: 2, calcParams: [12, 26, 9],
    figures: [
      { key: 'hist', title: 'Hist: ', type: 'bar', baseValue: 0,
        styles: ({ data }) => { const v = (data.current as any)?.hist; return { color: v == null || v >= 0 ? 'rgba(8,153,129,0.6)' : 'rgba(242,54,69,0.6)' }; } },
      { key: 'macd', title: 'MACD: ', type: 'line' },
      { key: 'signal', title: 'Signal: ', type: 'line' },
    ],
    calc: (dataList, indicator) => {
      const [f, sl, sg] = indicator.calcParams.map(Number);
      const m = macd(dataList.map((d) => d.close), f || 12, sl || 26, sg || 9);
      return rows(dataList.length, { hist: m.hist, macd: m.macd, signal: m.signal });
    },
  });
  kc.registerIndicator<Record<string, number>, number>({
    name: 'MC_ATR', shortName: 'ATR', series: 'normal', precision: 2, calcParams: [14],
    figures: [{ key: 'atr', title: 'ATR: ', type: 'line' }],
    calc: (dataList, indicator) => rows(dataList.length, { atr: atr(toBars(dataList), Number(indicator.calcParams[0]) || 14) }),
  });

  // zzz946 — price axes that fit the candles on screen only (TradingView "A"), in normal and log scale. When the candles
  // cannot be read the library's own range (candles + indicators) is used.
  const fitRange = (chart: kc.Chart, fallback: kc.AxisRange): { min: number; max: number } => {
    const list = chart.getDataList();
    const vr = chart.getVisibleRange();
    const r = fitPriceRange(list.map((d) => d.low), list.map((d) => d.high), vr.from, vr.to);
    return r ?? { min: fallback.from, max: fallback.to };
  };
  kc.registerYAxis({
    name: 'mcFit',
    createRange: ({ chart, defaultRange }) => {
      const { min, max } = fitRange(chart, defaultRange);
      return { from: min, to: max, range: max - min, realFrom: min, realTo: max, realRange: max - min, displayFrom: min, displayTo: max, displayRange: max - min };
    },
  });
  const lg = (v: number) => (v < 0 ? -Math.log10(Math.abs(v)) : Math.log10(v));
  const ix = (v: number) => (v < 0 ? -(10 ** Math.abs(v)) : 10 ** v);
  const logTemplate = {
    minSpan: (precision: number) => 0.05 * 10 ** -precision,
    valueToRealValue: (v: number) => lg(v),
    realValueToDisplayValue: (v: number) => ix(v),
    displayValueToRealValue: (v: number) => lg(v),
    realValueToValue: (v: number) => ix(v),
  };
  const logRange = (min: number, max: number) => ({ from: min, to: max, range: max - min, realFrom: lg(min), realTo: lg(max), realRange: lg(max) - lg(min), displayFrom: min, displayTo: max, displayRange: max - min });
  kc.registerYAxis({ name: 'mcFitLog', ...logTemplate, createRange: ({ chart, defaultRange }) => { const { min, max } = fitRange(chart, defaultRange); return logRange(min, max); } });
  kc.registerYAxis({ name: 'mcLog', ...logTemplate, createRange: ({ defaultRange }) => logRange(defaultRange.from, defaultRange.to) });

  // N-06 — last-value tags on the price axis for every indicator line / bar in a pane. KLineChart's own indicator
  // lastValueMark uses ONE text colour for all lines (white), so a yellow EMA tag read at 1.41:1. This overlay draws the same
  // tags with black or white text chosen per tag from its background (lib/readable-color textOnColor); the line colours are
  // untouched. One instance per pane (extendData = the page background, for semi-transparent bar colours).
  kc.registerOverlay<string>({
    name: 'mcLastValues',
    totalStep: 2,
    lock: true,
    needDefaultPointFigure: false,
    needDefaultXAxisFigure: false,
    needDefaultYAxisFigure: false,
    createPointFigures: () => [],
    createYAxisFigures: ({ chart, overlay, bounding, yAxis }) => {
      if (!yAxis) return [];
      const page = typeof overlay.extendData === 'string' ? overlay.extendData : '#FFFFFF';
      const defaults = chart.getStyles().indicator as any;
      const fromZero = yAxis.isFromZero();
      const out: kc.OverlayFigure[] = [];
      for (const ind of chart.getIndicators({ paneId: overlay.paneId })) {
        if (!ind.visible) continue;
        const res = (ind.result || []) as Array<Record<string, number>>;
        const i = res.length - 1;
        const data = res[i];
        if (!data) continue;
        const st = (ind.styles || {}) as any;
        const lines = (st.lines?.length ? st.lines : defaults.lines) as any[];
        const barsSt = (st.bars?.length ? st.bars : defaults.bars) as any[];
        let li = 0, bi = 0;
        for (const fig of ind.figures as any[]) {
          let color: string | undefined;
          if (fig.type === 'line') { color = lines[li % lines.length]?.color; li++; }
          else if (fig.type === 'bar') { color = barsSt[bi % barsSt.length]?.noChangeColor; bi++; }
          else continue;
          try {
            const dyn = fig.styles?.({ data: { prev: res[i - 1], current: data, next: undefined }, indicator: ind, barSpace: chart.getBarSpace(), defaultStyles: defaults });
            if (dyn?.color) color = String(dyn.color);
          } catch { /* keep the default colour */ }
          const v = data[fig.key];
          if (typeof v !== 'number' || !Number.isFinite(v) || !color) continue;
          const text = ind.shouldFormatBigNumber ? kc.utils.formatBigNumber(String(Math.round(v))) : fmtPrice(v, ind.precision ?? 2);
          out.push({
            type: 'text', ignoreEvent: true,
            attrs: { x: fromZero ? 0 : bounding.width, y: yAxis.convertToNicePixel(v), text, align: fromZero ? 'left' : 'right', baseline: 'middle' },
            styles: { style: 'fill', color: textOnColor(color, page), backgroundColor: color, borderColor: 'transparent', borderSize: 0, borderRadius: 2, paddingLeft: 4, paddingRight: 4, paddingTop: 4, paddingBottom: 4, size: 12 },
          });
        }
      }
      return out;
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
        styles: { color: textOnColor(c), backgroundColor: c, borderColor: c, borderRadius: 2, paddingLeft: 4, paddingRight: 4, paddingTop: 2, paddingBottom: 2, size: 11 },   // N-06
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
          styles: { color: textOnColor(c), backgroundColor: c, borderRadius: 3, paddingLeft: 6, paddingRight: 6, paddingTop: 3, paddingBottom: 3, size: 12, weight: 600 },
        },
      ];
    },
  });

  return kc;
}
