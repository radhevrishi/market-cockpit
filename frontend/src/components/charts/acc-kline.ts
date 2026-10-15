// zzz1046b — the two KLineChart indicators of "Volume & accumulation". Browser-only (imported from inside an effect).
//  • MC_ACC — no lines of its own. With Volume on it sits in the volume pane: a small mark just above each accumulation (▲),
//    volume-breakout (◆), distribution (▼) and stalling (●) bar, and those bars re-drawn in a stronger colour (tint). With Volume
//    off it sits on the price pane and the marks go just under the candles. The hovered bar's mark is named in the pane's top line
//    ("Volume breakout · vol 2.1×").
//  • MC_CMF — its own pane "Money flow": Chaikin Money Flow (21) as a green / red histogram around 0.
// Both read points keyed by timestamp from extendData (acc-view), so a reload of the candles never shows another symbol's marks.
import type * as KC from 'klinecharts';
import { accMarkColor, accMarkTitle, type AccPoint, type CmfPoint } from './acc-view';
import type { AccKind } from '@/lib/accumulation';

interface AccExtend { points: AccPoint[]; onVol: boolean; tint: boolean; light: boolean; bar: string }
interface CmfExtend { points: CmfPoint[]; light: boolean }
interface AccRes { k?: AccKind; x?: number | null }
let registered = false;

const rgba = (hex: string, a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;

/** a small filled shape centred on (x, y): ▲ ▼ ◆ ● */
function mark(ctx: CanvasRenderingContext2D, kind: AccKind, x: number, y: number, r: number) {
  ctx.beginPath();
  if (kind === 'acc') { ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); }
  else if (kind === 'dist') { ctx.moveTo(x, y + r); ctx.lineTo(x + r, y - r * 0.8); ctx.lineTo(x - r, y - r * 0.8); }
  else if (kind === 'vbo') { const q = r * 1.25; ctx.moveTo(x, y - q); ctx.lineTo(x + q, y); ctx.lineTo(x, y + q); ctx.lineTo(x - q, y); }
  else ctx.arc(x, y, r * 0.75, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
}

export function registerAccIndicators(kc: typeof KC): void {
  if (registered) return;
  registered = true;
  kc.registerIndicator<AccRes, number, AccExtend>({
    // shortName 'VOL': the volume pane keeps its "Volume" name on its collapse button whichever indicator is listed first
    name: 'MC_ACC', shortName: 'VOL', series: 'normal', precision: 0, calcParams: [], shouldOhlc: false, figures: [],
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const list = (indicator.result || []) as AccRes[];
      const i = typeof crosshair.dataIndex === 'number' ? crosshair.dataIndex : list.length - 1;
      const r = list[i];
      const ext = indicator.extendData as AccExtend | undefined;
      if (!r?.k) return { name: '', calcParamsText: '', features: [], legends: [] };
      return { name: '', calcParamsText: '', features: [], legends: [{ title: '', value: { text: accMarkTitle(r.k, r.x ?? null, ext?.bar || 'session'), color: accMarkColor(r.k, !!ext?.light) } }] };
    },
    calc: (dataList, indicator) => {
      const byT = new Map<number, AccRes>();
      for (const [t, k, x] of indicator.extendData?.points || []) byT.set(t, { k, x });
      return dataList.map((d) => byT.get(d.timestamp) || {});
    },
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const res = (indicator.result || []) as AccRes[];
      const ext = indicator.extendData;
      if (!ext) return false;
      const light = !!ext.light;
      const data = chart.getDataList();
      const vr = chart.getVisibleRange();
      const from = Math.max(0, vr.from - 1), to = Math.min(res.length, data.length, vr.to + 1);
      const space = chart.getBarSpace();
      const r = Math.max(2.2, Math.min(4, space.bar * 0.32));
      const halo = light ? 'rgba(255,255,255,0.9)' : 'rgba(10,14,26,0.9)';
      ctx.save();
      for (let i = from; i < to; i++) {
        const m = res[i], k = data[i];
        if (!m?.k || !k) continue;
        const x = xAxis.convertToPixel(i);
        const col = accMarkColor(m.k, light);
        let y: number;
        if (ext.onVol) {
          const vol = Number(k.volume) || 0;
          const top = yAxis.convertToPixel(vol), base = yAxis.convertToPixel(0);
          // tint: the bar again in the mark colour, stronger than the plain volume bars (half strength)
          if (ext.tint && vol > 0) {
            const w = Math.max(1, space.gapBar);
            ctx.fillStyle = rgba(col, light ? 0.75 : 0.8);
            ctx.fillRect(x - w / 2, Math.min(top, base), w, Math.max(1, Math.abs(base - top)));
          }
          y = Math.max(r + 2, top - r - 3);
        } else {
          y = Math.min(bounding.height - r - 2, yAxis.convertToPixel(k.low) + r + 5);
        }
        ctx.fillStyle = halo;
        mark(ctx, m.k, x, y, r + 1.2);
        ctx.fillStyle = col;
        mark(ctx, m.k, x, y, r);
      }
      ctx.restore();
      return false;
    },
  });
  kc.registerIndicator<{ cmf?: number; z?: number }, number, CmfExtend>({
    name: 'MC_CMF', shortName: 'CMF', series: 'normal', precision: 2, calcParams: [],
    figures: [
      { key: 'cmf', title: 'CMF 21: ', type: 'bar', baseValue: 0,
        styles: ({ data }) => {
          const v = (data.current as any)?.cmf as number | undefined;
          if (v == null) return { color: 'rgba(0,0,0,0)' };
          return { color: v >= 0 ? 'rgba(8,153,129,0.7)' : 'rgba(242,54,69,0.7)' };
        } },
      { key: 'z', title: '', type: 'line' },
    ],
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const list = (indicator.result || []) as Array<{ cmf?: number }>;
      const i = typeof crosshair.dataIndex === 'number' ? crosshair.dataIndex : list.length - 1;
      const v = list[i]?.cmf;
      const text = v != null ? `${v > 0 ? '+' : ''}${v.toFixed(2)}` : '—';
      return { name: 'Money flow (Chaikin Money Flow 21)', calcParamsText: '', features: [], legends: [{ title: '', value: { text, color: v != null && v < 0 ? '#F23645' : '#089981' } }] };
    },
    calc: (dataList, indicator) => {
      const map = new Map<number, number | null>();
      for (const [t, v] of indicator.extendData?.points || []) map.set(t, v);
      return dataList.map((d) => {
        const v = map.get(d.timestamp);
        return v != null && Number.isFinite(v) ? { z: 0, cmf: v } : { z: 0 };
      });
    },
  });
}
