// zzz1022 — the two KLineChart indicators of "Trader setups". Browser-only (imported from inside an effect).
//  • MC_SETUPS — price pane, no lines of its own: short tags above (upward setups) / below (downward) the candles where a setup
//    fired, the latest Darvas boxes as rectangles and, when asked, the Donchian 20 channel.
//  • MC_SQZ — its own pane: the TTM squeeze momentum histogram with dots on the zero line (red = squeeze on, green = off).
// Both read points keyed by timestamp from extendData (components/charts/setup-view), so a reload of the candles never shows
// another symbol's setups.
import type * as KC from 'klinecharts';
import { SETUP_NEUTRAL, setupColor, tagOf, type DonchianPoint, type SetupBox, type SetupPoint, type SqueezePoint } from './setup-view';

interface SetupExtend { points: SetupPoint[]; boxes: SetupBox[]; dc: DonchianPoint[] | null; light: boolean }
interface SqzExtend { points: SqueezePoint[]; light: boolean }
type Tag = [string, string];
interface SetupRes { u?: Tag[]; d?: Tag[]; dh?: number; dl?: number }
let registered = false;

/** index of the first candle at or after `t` (candles sorted by time); -1 when none */
function indexAtOrAfter(list: ReadonlyArray<{ timestamp: number }>, t: number): number {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].timestamp >= t) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans;
}
const rgba = (hex: string, a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;
const BOX_COLOR = { inside: '#2962FF', up: '#089981', down: '#F23645' } as const;

export function registerSetupIndicators(kc: typeof KC): void {
  if (registered) return;
  registered = true;
  kc.registerIndicator<SetupRes, number, SetupExtend>({
    name: 'MC_SETUPS', shortName: 'Setups', series: 'price', precision: 2, calcParams: [], shouldOhlc: false, figures: [],
    // the status line at the top of the chart says what fired; no legend row from the library
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    calc: (dataList, indicator) => {
      const ext = indicator.extendData;
      const light = !!ext?.light;
      const byT = new Map<number, SetupRes>();
      const at = (t: number) => { let r = byT.get(t); if (!r) { r = {}; byT.set(t, r); } return r; };
      for (const [t, code, dir] of ext?.points || []) {
        const r = at(t);
        const tag: Tag = [tagOf(code, dir), setupColor(code, dir, light)];
        // neutral setups (squeeze on, quiet bars) sit below the candle; upward above, downward below
        if (dir === 1 && !SETUP_NEUTRAL.has(code)) (r.u ||= []).push(tag); else (r.d ||= []).push(tag);
      }
      for (const [t, hi, lo] of ext?.dc || []) { if (hi == null && lo == null) continue; const r = at(t); if (hi != null) r.dh = hi; if (lo != null) r.dl = lo; }
      return dataList.map((d) => byT.get(d.timestamp) || {});
    },
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const res = (indicator.result || []) as SetupRes[];
      const ext = indicator.extendData;
      const light = !!ext?.light;
      const data = chart.getDataList();
      const vr = chart.getVisibleRange();
      const from = Math.max(0, vr.from - 1), to = Math.min(res.length, data.length, vr.to + 1);
      ctx.save();
      // Darvas boxes (latest few): a thin outline with a light fill, in the box's state colour
      for (const b of ext?.boxes || []) {
        const i0 = indexAtOrAfter(data, b.fromT), i1 = indexAtOrAfter(data, b.toT);
        if (i0 < 0 || i1 < 0 || i1 < from - 1 || i0 > to) continue;
        const half = chart.getBarSpace().bar / 2;
        const x0 = xAxis.convertToPixel(i0) - half, x1 = xAxis.convertToPixel(i1) + half;
        const y0 = yAxis.convertToPixel(b.top), y1 = yAxis.convertToPixel(b.bottom);
        const c = BOX_COLOR[b.state];
        ctx.fillStyle = rgba(c, light ? 0.06 : 0.1);
        ctx.fillRect(x0, Math.min(y0, y1), x1 - x0, Math.abs(y1 - y0));
        ctx.strokeStyle = rgba(c, light ? 0.75 : 0.85);
        ctx.lineWidth = 1;
        ctx.setLineDash(b.state === 'inside' ? [] : [4, 3]);
        ctx.strokeRect(x0 + 0.5, Math.min(y0, y1) + 0.5, x1 - x0 - 1, Math.abs(y1 - y0) - 1);
      }
      ctx.setLineDash([]);
      // Donchian 20 channel (when asked)
      if (ext?.dc?.length) {
        ctx.strokeStyle = light ? 'rgba(41,98,255,0.55)' : 'rgba(130,160,255,0.6)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        for (const key of ['dh', 'dl'] as const) {
          ctx.beginPath();
          let pen = false;
          for (let i = from; i < to; i++) {
            const v = res[i]?.[key];
            if (v == null) { pen = false; continue; }
            const x = xAxis.convertToPixel(i), y = yAxis.convertToPixel(v);
            if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
          }
          ctx.stroke();
        }
        ctx.setLineDash([]);
      }
      // tags: above the high (upward) / below the low (downward, neutral), stacked when several fire on one bar
      const fs = chart.getBarSpace().bar >= 6 ? 10 : 9;
      ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineJoin = 'round';
      const halo = light ? 'rgba(255,255,255,0.92)' : 'rgba(10,14,26,0.92)';
      const step = fs + 3;
      for (let i = from; i < to; i++) {
        const r = res[i], k = data[i];
        if (!r || !k || (!r.u && !r.d)) continue;
        const x = xAxis.convertToPixel(i);
        const put = (tags: Tag[] | undefined, y0: number, dirUp: boolean) => {
          (tags || []).forEach(([txt, col], n) => {
            const y = dirUp ? y0 - 6 - n * step : y0 + 6 + fs + n * step;
            if (y < 2 || y > bounding.height - 2) return;
            ctx.textBaseline = 'alphabetic';
            ctx.lineWidth = 3; ctx.strokeStyle = halo; ctx.strokeText(txt, x, y);
            ctx.fillStyle = col; ctx.fillText(txt, x, y);
          });
        };
        put(r.u, yAxis.convertToPixel(k.high), true);
        put(r.d, yAxis.convertToPixel(k.low), false);
      }
      ctx.restore();
      return false;
    },
  });
  kc.registerIndicator<{ m?: number; z?: number; on?: number }, number, SqzExtend>({
    name: 'MC_SQZ', shortName: 'Squeeze', series: 'normal', precision: 2, calcParams: [],
    figures: [
      { key: 'm', title: 'Momentum: ', type: 'bar', baseValue: 0,
        styles: ({ data }) => {
          const v = (data.current as any)?.m as number | undefined, p = (data.prev as any)?.m as number | undefined;
          if (v == null) return { color: 'rgba(0,0,0,0)' };
          const rising = p == null || v >= p;
          return { color: v >= 0 ? (rising ? 'rgba(8,153,129,0.85)' : 'rgba(8,153,129,0.4)') : (rising ? 'rgba(242,54,69,0.4)' : 'rgba(242,54,69,0.85)') };
        } },
      { key: 'z', title: '', type: 'line' },
    ],
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const list = indicator.result as Array<{ m?: number; on?: number }>;
      const i = typeof crosshair.dataIndex === 'number' ? crosshair.dataIndex : list.length - 1;
      const r = list[i];
      const v = r?.m;
      const state = r?.on == null ? '' : r.on ? ' · squeeze on' : ' · squeeze off';
      return { name: 'Squeeze momentum (TTM, our own version)', calcParamsText: '', features: [], legends: [{ title: '', value: { text: `${v != null ? v.toFixed(2) : '—'}${state}`, color: v != null && v < 0 ? '#F23645' : '#089981' } }] };
    },
    calc: (dataList, indicator) => {
      const map = new Map<number, SqueezePoint>();
      for (const p of indicator.extendData?.points || []) map.set(p[0], p);
      return dataList.map((d) => {
        const p = map.get(d.timestamp);
        if (!p) return { z: 0 };
        return { z: 0, ...(p[2] != null && Number.isFinite(p[2]) ? { m: p[2] } : {}), ...(p[1] != null ? { on: p[1] } : {}) };
      });
    },
    draw: ({ ctx, chart, indicator, xAxis, yAxis }) => {
      const res = (indicator.result || []) as Array<{ on?: number }>;
      const vr = chart.getVisibleRange();
      const y = yAxis.convertToPixel(0);
      const r = Math.max(1.5, Math.min(3, chart.getBarSpace().bar / 3));
      ctx.save();
      for (let i = Math.max(0, vr.from - 1); i < Math.min(res.length, vr.to + 1); i++) {
        const on = res[i]?.on;
        if (on == null) continue;
        ctx.fillStyle = on ? '#F23645' : '#089981';
        ctx.beginPath(); ctx.arc(xAxis.convertToPixel(i), y, r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      return false;
    },
  });
}
