// zzz987 / zzz1023 — the KLineChart indicators of "Stage Analysis (TheWrap method)". Browser-only (imported from inside an effect).
//  • MC_STAGE      price pane, BEHIND the candles (zLevel −1): a very light background tint per stage (sub-stage B lighter).
//  • MC_STAGE_LINE price pane, in front: the stage line (30-week average; the 150-day average on a daily chart) coloured by its
//                  slope (rising green / flat grey / falling red), a thin stage strip along the bottom edge, a small label pill
//                  where each stage began ("S2 · Advancing · 3 Aug 26") placed clear of the candles, and the dashed base-high /
//                  support level with a ▲ / ▼ marker where a breakout / breakdown started.
//  • MC_MRS        its own pane: Mansfield RS as a histogram + line, green above zero and red below, with a zero line.
// All read [timestamp, …] points from extendData (stage-view stagePointsFor / stageMarksFor), matched by timestamp, so a reload
// of the candles never shows another symbol's stages.
import type * as KC from 'klinecharts';
import { CHART_BG, slopeColor, stageColor, stageFill, stageStrip, type StageMark, type StagePoint } from './stage-view';
import { readableOn } from '@/lib/readable-color';
import type { Stage } from '@/lib/stage-analysis';

interface StageExtend { points: StagePoint[]; marks?: StageMark[]; light: boolean }
type Res = { s?: number; b?: number; ma?: number; sl?: number };
let registered = false;

const STRIP_H = 4;
const PILL_H = 16;

function byTime<T>(points: StagePoint[] | undefined, pick: (p: StagePoint) => T): Map<number, T> {
  const m = new Map<number, T>();
  for (const p of points || []) m.set(p[0], pick(p));
  return m;
}
/** index of the first candle at or after `t` (dataList is ascending) */
function indexAt(list: ReadonlyArray<{ timestamp: number }>, t: number): number {
  let lo = 0, hi = list.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (list[m].timestamp < t) lo = m + 1; else hi = m; }
  return lo;
}
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function registerStageIndicators(kc: typeof KC): void {
  if (registered) return;
  registered = true;
  const noLegend = () => ({ name: '', calcParamsText: '', features: [], legends: [] });

  // ── background tint (behind the candles) ─────────────────────────────────────
  kc.registerIndicator<Res, number, StageExtend>({
    name: 'MC_STAGE', shortName: 'Stage', series: 'price', precision: 0, calcParams: [], shouldOhlc: false, figures: [], zLevel: -1,
    createTooltipDataSource: noLegend,   // the status line at the top of the chart says the stage
    calc: (dataList, indicator) => {
      const map = byTime(indicator.extendData?.points, (p) => [p[1], p[5]] as const);
      return dataList.map((d) => { const v = map.get(d.timestamp); return v && v[0] ? { s: v[0], b: v[1] } : {}; });
    },
    draw: ({ ctx, chart, indicator, bounding, xAxis }) => {
      const res = (indicator.result || []) as Res[];
      const light = !!indicator.extendData?.light;
      const vr = chart.getVisibleRange();
      const half = chart.getBarSpace().bar / 2;
      const from = Math.max(0, vr.from - 1), to = Math.min(res.length, vr.to + 1);
      let i = from;
      while (i < to) {
        const s = res[i]?.s, b = res[i]?.b;
        let j = i;
        while (j + 1 < to && res[j + 1]?.s === s && res[j + 1]?.b === b) j++;
        if (s) {
          const x0 = Math.max(0, xAxis.convertToPixel(i) - half), x1 = Math.min(bounding.width, xAxis.convertToPixel(j) + half);
          ctx.fillStyle = stageFill(s as Stage, light, b === 1);
          ctx.fillRect(x0, 0, x1 - x0, bounding.height);
        }
        i = j + 1;
      }
      return true;
    },
  });

  // ── stage line, strip, pills, levels (in front) ──────────────────────────────
  kc.registerIndicator<Res, number, StageExtend>({
    name: 'MC_STAGE_LINE', shortName: 'Stage line', series: 'price', precision: 2, calcParams: [], shouldOhlc: false,
    // a figure so the price axis keeps the line in range; drawn by hand below (the colour follows the slope)
    figures: [{ key: 'ma', title: '', type: 'line' }],
    createTooltipDataSource: noLegend,
    calc: (dataList, indicator) => {
      const map = byTime(indicator.extendData?.points, (p) => p);
      return dataList.map((d) => {
        const p = map.get(d.timestamp);
        if (!p) return {};
        const r: Res = {};
        if (p[1]) { r.s = p[1]; r.b = p[5]; }
        if (p[3] != null && Number.isFinite(p[3])) { r.ma = p[3]; r.sl = p[4] ?? 0; }
        return r;
      });
    },
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const res = (indicator.result || []) as Res[];
      const light = !!indicator.extendData?.light;
      const marks = indicator.extendData?.marks || [];
      const list = chart.getDataList();
      const vr = chart.getVisibleRange();
      const half = chart.getBarSpace().bar / 2;
      const from = Math.max(0, vr.from - 1), to = Math.min(res.length, vr.to + 1);
      const X = (i: number) => xAxis.convertToPixel(i);
      const Y = (v: number) => yAxis.convertToPixel(v);
      const H = bounding.height, W = bounding.width;

      // 1 · the stage line, one path per slope run
      ctx.lineWidth = 1.75; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      let i = from;
      while (i < to) {
        if (res[i]?.ma == null) { i++; continue; }
        const sl = res[i].sl as -1 | 0 | 1;
        ctx.beginPath(); ctx.strokeStyle = slopeColor(sl, light);
        if (i > 0 && res[i - 1]?.ma != null) ctx.moveTo(X(i - 1), Y(res[i - 1].ma!)); else ctx.moveTo(X(i), Y(res[i].ma!));
        let j = i;
        while (j < to && res[j]?.ma != null && res[j].sl === sl) { ctx.lineTo(X(j), Y(res[j].ma!)); j++; }
        ctx.stroke();
        i = j;
      }

      // 2 · the strip along the bottom edge
      i = from;
      while (i < to) {
        const s = res[i]?.s, b = res[i]?.b;
        let j = i;
        while (j + 1 < to && res[j + 1]?.s === s && res[j + 1]?.b === b) j++;
        if (s) {
          const x0 = Math.max(0, X(i) - half), x1 = Math.min(W, X(j) + half);
          ctx.fillStyle = stageStrip(s as Stage, light, b === 1);
          ctx.fillRect(x0, H - STRIP_H, x1 - x0, STRIP_H);
        }
        i = j + 1;
      }

      // 3 · breakout / breakdown levels (dashed) and their markers
      for (const m of marks) {
        if (m.level == null || m.levelFrom == null || m.levelTo == null || !list.length) continue;
        const a = indexAt(list, m.levelFrom), z = Math.min(list.length - 1, indexAt(list, m.levelTo));
        if (z < from - 1 || a > to + 1) continue;
        const col = stageColor(m.stage, light);
        const y = Y(m.level);
        if (y < 0 || y > H) continue;
        ctx.save();
        ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.strokeStyle = col; ctx.globalAlpha = 0.85;
        ctx.beginPath(); ctx.moveTo(X(a), y); ctx.lineTo(X(z), y); ctx.stroke();
        ctx.restore();
        const k = indexAt(list, m.t);
        const bar = list[k];
        if (!bar || k < from || k >= to) continue;
        const x = X(k);
        ctx.fillStyle = col;
        ctx.beginPath();
        if (m.kind === 'breakout') { const yy = Y(bar.low) + 8; ctx.moveTo(x, yy); ctx.lineTo(x - 5, yy + 8); ctx.lineTo(x + 5, yy + 8); }
        else { const yy = Y(bar.high) - 8; ctx.moveTo(x, yy); ctx.lineTo(x - 5, yy - 8); ctx.lineTo(x + 5, yy - 8); }
        ctx.closePath(); ctx.fill();
      }

      // 4 · label pills where each stage began: just above the strip when the candles leave room there, else at the top
      const page = CHART_BG(light);
      ctx.font = '600 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      ctx.textBaseline = 'middle';
      const placed: Array<[number, number, number, number]> = [];
      const clash = (x: number, y: number, w: number) => placed.some(([px, py, pw]) => x < px + pw + 6 && px < x + w + 6 && Math.abs(py - y) < PILL_H + 2);
      for (const m of marks) {
        const k = indexAt(list, m.t);
        if (k >= list.length || k < from || k >= to) continue;
        const x = X(k) - half;
        const w = Math.ceil(ctx.measureText(m.label).width) + 12;
        const xs = Math.min(Math.max(2, x), W - w - 2);
        // the candles under the pill
        let lo = -Infinity, hi = Infinity;
        for (let q = k; q < Math.min(list.length, to); q++) {
          if (X(q) - half > xs + w) break;
          lo = Math.max(lo, Y(list[q].low)); hi = Math.min(hi, Y(list[q].high));
        }
        const yBottom = H - STRIP_H - 4 - PILL_H;
        const yTop = 34;   // under the status line
        let y = lo + 4 <= yBottom ? yBottom : hi - 4 >= yTop + PILL_H ? yTop : yBottom;
        if (clash(xs, y, w)) { const alt = y === yBottom ? yBottom - PILL_H - 3 : yTop + PILL_H + 3; if (clash(xs, alt, w)) continue; y = alt; }
        placed.push([xs, y, w, PILL_H]);
        const col = stageColor(m.stage, light);
        ctx.save();
        ctx.globalAlpha = 0.94; ctx.fillStyle = page; roundRect(ctx, xs, y, w, PILL_H, 8); ctx.fill();
        ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeStyle = col; roundRect(ctx, xs + 0.5, y + 0.5, w - 1, PILL_H - 1, 7.5); ctx.stroke();
        ctx.fillStyle = readableOn(col, page); ctx.fillText(m.label, xs + 6, y + PILL_H / 2 + 0.5);
        // a hairline tick from the pill down to the strip (bottom pills only)
        if (y >= yBottom - PILL_H - 3) { ctx.strokeStyle = col; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(X(k), y + PILL_H); ctx.lineTo(X(k), H - STRIP_H); ctx.stroke(); }
        ctx.restore();
      }
      return true;
    },
  });

  // ── Mansfield RS pane ────────────────────────────────────────────────────────
  kc.registerIndicator<{ m?: number; z?: number }, number, StageExtend>({
    name: 'MC_MRS', shortName: 'Mansfield RS', series: 'normal', precision: 1, calcParams: [],
    figures: [{ key: 'm', title: 'Mansfield RS: ', type: 'line' }, { key: 'z', title: '', type: 'line' }],
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const list = indicator.result as Array<{ m?: number }>;
      const i = typeof crosshair.dataIndex === 'number' ? crosshair.dataIndex : list.length - 1;
      const v = list[i]?.m;
      const light = !!(indicator.extendData as StageExtend | undefined)?.light;
      const color = v == null ? (light ? '#475569' : '#B2B5BE') : readableOn(stageColor(v >= 0 ? 2 : 4, light), CHART_BG(light));
      return { name: 'Mansfield RS (weekly, vs index)', calcParamsText: '', features: [], legends: [{ title: '', value: { text: v != null ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}` : '—', color } }] };
    },
    calc: (dataList, indicator) => {
      const map = byTime(indicator.extendData?.points, (p) => p[2]);
      return dataList.map((d) => { const m = map.get(d.timestamp); return m != null && Number.isFinite(m) ? { m, z: 0 } : { z: 0 }; });
    },
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const res = (indicator.result || []) as Array<{ m?: number }>;
      const light = !!indicator.extendData?.light;
      const vr = chart.getVisibleRange();
      const bar = chart.getBarSpace().bar;
      const from = Math.max(0, vr.from - 1), to = Math.min(res.length, vr.to + 1);
      const X = (i: number) => xAxis.convertToPixel(i);
      const y0 = yAxis.convertToPixel(0);
      const up = stageColor(2, light), dn = stageColor(4, light);
      // zero line
      ctx.save();
      ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = light ? '#9AA1AC' : '#5D6472';
      ctx.beginPath(); ctx.moveTo(0, Math.round(y0) + 0.5); ctx.lineTo(bounding.width, Math.round(y0) + 0.5); ctx.stroke();
      ctx.restore();
      // histogram (soft) …
      const w = Math.max(1, bar * 0.8);
      ctx.globalAlpha = light ? 0.28 : 0.35;
      for (let i = from; i < to; i++) {
        const v = res[i]?.m;
        if (v == null) continue;
        const y = yAxis.convertToPixel(v);
        ctx.fillStyle = v >= 0 ? up : dn;
        ctx.fillRect(X(i) - w / 2, Math.min(y, y0), w, Math.max(1, Math.abs(y - y0)));
      }
      ctx.globalAlpha = 1;
      // … and the line, green above zero and red below
      ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
      for (let i = Math.max(from, 1); i < to; i++) {
        const a = res[i - 1]?.m, b = res[i]?.m;
        if (a == null || b == null) continue;
        const xa = X(i - 1), xb = X(i), ya = yAxis.convertToPixel(a), yb = yAxis.convertToPixel(b);
        if ((a >= 0) === (b >= 0)) { ctx.strokeStyle = b >= 0 ? up : dn; ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke(); continue; }
        const xm = xa + ((xb - xa) * a) / (a - b);   // where the line crosses zero
        ctx.strokeStyle = a >= 0 ? up : dn; ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xm, y0); ctx.stroke();
        ctx.strokeStyle = b >= 0 ? up : dn; ctx.beginPath(); ctx.moveTo(xm, y0); ctx.lineTo(xb, yb); ctx.stroke();
      }
      return true;
    },
  });
}
