// zzz987 — the two KLineChart indicators of "Stage Analysis (TheWrap method)". Browser-only (imported from inside an effect).
//  • MC_STAGE — price pane, no lines: a translucent background band per candle in its stage colour (1/3 blue, 2 green, 4 red).
//  • MC_MRS — its own pane: Mansfield RS line with a zero line.
// Both read [timestamp, stage, mrs] points from extendData (components/charts/stage-view stagePointsFor), matched by timestamp,
// so a reload of the candles never shows another symbol's stages.
import type * as KC from 'klinecharts';
import { STAGE_COLOR, stageFill, type StagePoint } from './stage-view';
import type { Stage } from '@/lib/stage-analysis';

interface StageExtend { points: StagePoint[]; light: boolean }
let registered = false;

export function registerStageIndicators(kc: typeof KC): void {
  if (registered) return;
  registered = true;
  kc.registerIndicator<{ s?: number; m?: number }, number, StageExtend>({
    name: 'MC_STAGE', shortName: 'Stage', series: 'price', precision: 0, calcParams: [], shouldOhlc: false, figures: [],
    // the status line at the top of the chart says the stage; no legend row from the library
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    calc: (dataList, indicator) => {
      const map = new Map<number, number>();
      for (const p of indicator.extendData?.points || []) map.set(p[0], p[1]);
      return dataList.map((d) => { const s = map.get(d.timestamp); return s ? { s } : {}; });
    },
    draw: ({ ctx, chart, indicator, bounding, xAxis }) => {
      const res = (indicator.result || []) as Array<{ s?: number }>;
      const light = !!indicator.extendData?.light;
      const vr = chart.getVisibleRange();
      const half = chart.getBarSpace().bar / 2;
      const from = Math.max(0, vr.from - 1), to = Math.min(res.length, vr.to + 1);
      let i = from;
      while (i < to) {
        const s = res[i]?.s;
        let j = i;
        while (j + 1 < to && res[j + 1]?.s === s) j++;
        if (s && STAGE_COLOR[s as Stage]) {
          const x0 = xAxis.convertToPixel(i) - half, x1 = xAxis.convertToPixel(j) + half;
          ctx.fillStyle = stageFill(s as Stage, light);
          ctx.fillRect(Math.max(0, x0), 0, Math.min(bounding.width, x1) - Math.max(0, x0), bounding.height);
        }
        i = j + 1;
      }
      return false;
    },
  });
  kc.registerIndicator<{ m?: number; z?: number }, number, StageExtend>({
    name: 'MC_MRS', shortName: 'Mansfield RS', series: 'normal', precision: 1, calcParams: [],
    figures: [{ key: 'm', title: 'Mansfield RS: ', type: 'line' }, { key: 'z', title: '', type: 'line' }],
    createTooltipDataSource: ({ indicator, crosshair }) => {
      const list = indicator.result as Array<{ m?: number }>;
      const i = typeof crosshair.dataIndex === 'number' ? crosshair.dataIndex : list.length - 1;
      const v = list[i]?.m;
      const color = String((indicator.styles as any)?.lines?.[0]?.color || '#7E57C2');
      return { name: 'Mansfield RS (weekly, vs index)', calcParamsText: '', features: [], legends: [{ title: '', value: { text: v != null ? `${v > 0 ? '+' : ''}${v.toFixed(1)}` : '—', color } }] };
    },
    calc: (dataList, indicator) => {
      const map = new Map<number, number | null>();
      for (const p of indicator.extendData?.points || []) map.set(p[0], p[2]);
      return dataList.map((d) => { const m = map.get(d.timestamp); return m != null && Number.isFinite(m) ? { m, z: 0 } : { z: 0 }; });
    },
  });
}
