// zzz1025 — the KLineChart indicator of "Auto trendlines & levels" (MC_ALINES). Browser-only (imported from inside an effect).
// Price pane, no figures of its own (so it never changes the price axis): it draws, from extendData (auto-lines-view
// alnPayload, keyed by timestamps):
//  • trendlines from their first touch to the right edge (intact) or a few bars past the break (broken, grey, dashed)
//  • small rings on every touch
//  • horizontal levels from their first touch to the right edge
//  • right-edge tags "×N" (trendlines) and "×N 123.45" (levels), stacked so they never overlap; "· provisional" added when the
//    latest price (a candle still forming) is through the line before the period closes
// Width / dash by strength; the hovered line drawn a little heavier.
import type * as KC from 'klinecharts';
import { CLEAN_MAX_EDGE_TAGS, levelPriorities, mergeLevelTags, placeEdgeTags, type ChartDisplay, type LevelTag } from '@/lib/chart-display';
import { alnColors, alnLinePrice, dedupeAlnTags, fmtAlnPrice, type AlnPayload } from './auto-lines-view';

// zzz1029 — display preset (Clean merges nearby tags and caps them; Research shows every tag) and prices whose right-edge tags are
// drawn by others (a picked pattern's pivot): the tags here keep clear of those and of the last-price tag
type Ext = AlnPayload & { hover?: string | null; display?: ChartDisplay; avoid?: number[] };
let registered = false;

function indexAtOrAfter(list: ReadonlyArray<{ timestamp: number }>, t: number): number {
  let lo = 0, hi = list.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (list[m].timestamp >= t) { ans = m; hi = m - 1; } else lo = m + 1; }
  return ans;
}
const rgba = (hex: string, a: number) => `rgba(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(',')},${a})`;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

export function registerAutoLinesIndicator(kc: typeof KC): void {
  if (registered) return;
  registered = true;
  kc.registerIndicator<Record<string, never>, number, Ext>({
    name: 'MC_ALINES', shortName: 'Auto lines', series: 'price', precision: 2, calcParams: [], shouldOhlc: false, figures: [],
    // the status line at the top of the chart says what is drawn; no legend row from the library
    createTooltipDataSource: () => ({ name: '', calcParamsText: '', features: [], legends: [] }),
    calc: (dataList) => dataList.map(() => ({})),
    draw: ({ ctx, chart, indicator, bounding, xAxis, yAxis }) => {
      const ext = indicator.extendData;
      if (!ext) return false;
      const data = chart.getDataList();
      if (!data.length) return false;
      const col = alnColors(!!ext.light);
      const vr = chart.getVisibleRange();
      const rightIdx = xAxis.convertFromPixel(bounding.width);
      const barSpace = chart.getBarSpace().bar;
      const dotR = barSpace >= 5 ? 3 : 2.5;
      const tags: Array<Omit<LevelTag, 'priority'>> = [];
      const fontSize = 10.5;
      ctx.save();
      ctx.lineCap = 'round';

      const ring = (x: number, y: number, c: string, alpha: number) => {
        ctx.beginPath();
        ctx.arc(x, y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = col.halo; ctx.fill();
        ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(c, alpha); ctx.stroke();
      };

      // ── horizontal levels (under the trendlines) ──────────────────────────────
      for (const lv of ext.levels || []) {
        const kA = indexAtOrAfter(data, lv.tA);
        if (kA < 0) continue;
        const c = col.level;   // zzz1034 — every level one colour (yellow on dark, deep amber on white)
        const hov = ext.hover === lv.id;
        const y = yAxis.convertToPixel(lv.price);
        if (y < -2 || y > bounding.height + 2) continue;
        const x0 = Math.max(0, xAxis.convertToPixel(kA));
        ctx.setLineDash(lv.strength >= 55 ? [] : [5, 4]);
        ctx.lineWidth = hov ? 2 : lv.strength >= 70 ? 1.4 : 1;
        ctx.strokeStyle = rgba(c, hov ? 1 : 0.72);
        ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(bounding.width, Math.round(y) + 0.5); ctx.stroke();
        ctx.setLineDash([]);
        for (const [t, p] of lv.touches) {
          const k = indexAtOrAfter(data, t);
          if (k < vr.from - 1 || k > vr.to + 1) continue;
          ring(xAxis.convertToPixel(k), yAxis.convertToPixel(p), c, hov ? 1 : 0.8);
        }
        tags.push({ id: lv.id, y, price: lv.price, n: lv.n, kind: lv.kind, prov: !!lv.prov, text: `×${lv.n}  ${fmtAlnPrice(lv.price, ext.decimals)}${lv.prov ? ' · provisional' : ''}`, color: c });
      }

      // ── trendlines ────────────────────────────────────────────────────────────
      for (const ln of ext.lines || []) {
        const kA = indexAtOrAfter(data, ln.tA);
        if (kA < 0) continue;
        const c = ln.broken ? col.broken : col.trend;   // zzz1034 — every trendline one colour (white on dark, charcoal on white)
        const hov = ext.hover === ln.id;
        let kEnd = rightIdx;
        if (ln.tEnd != null) { const kb = indexAtOrAfter(data, ln.tEnd); kEnd = kb < 0 ? rightIdx : Math.min(rightIdx, kb + 3); }
        const from = Math.max(kA, vr.from - 2), to = Math.min(kEnd, Math.max(vr.to + 2, rightIdx));
        if (to <= from) continue;
        ctx.setLineDash(ln.broken ? [3, 4] : ln.strength >= 45 ? [] : [7, 5]);
        ctx.lineWidth = hov ? 2.4 : ln.strength >= 60 ? 1.7 : 1.3;
        ctx.strokeStyle = rgba(c, hov ? 1 : ln.broken ? 0.7 : 0.88);
        ctx.beginPath();
        // sampled per bar: a line drawn in % terms stays right on a normal price scale (and the other way round)
        let first = true;
        const step = Math.max(1, Math.floor((to - from) / 400));
        for (let k = from; ; k += step) {
          const kk = Math.min(k, to);
          const x = xAxis.convertToPixel(kk), y = yAxis.convertToPixel(alnLinePrice(ln, kk, kA));
          if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
          if (kk >= to) break;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [t, p] of ln.touches) {
          const k = indexAtOrAfter(data, t);
          if (k < vr.from - 1 || k > vr.to + 1) continue;
          ring(xAxis.convertToPixel(k), yAxis.convertToPixel(p), c, hov ? 1 : 0.9);
        }
        const endX = xAxis.convertToPixel(to), endY = yAxis.convertToPixel(alnLinePrice(ln, to, kA));
        if (ln.tEnd == null) tags.push({ id: ln.id, y: endY, price: alnLinePrice(ln, to, kA), n: ln.n, kind: ln.kind, prov: !!ln.prov, text: `×${ln.n}${ln.prov ? ' · provisional' : ''}`, color: c });
        else if (endX > 0 && endX < bounding.width - 30 && endY > 0 && endY < bounding.height) {
          ctx.font = `600 ${fontSize}px ${FONT}`;
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.lineWidth = 3; ctx.strokeStyle = col.halo; ctx.strokeText(`×${ln.n} broken`, endX + 4, endY);
          ctx.fillStyle = c; ctx.fillText(`×${ln.n} broken`, endX + 4, endY);
        }
      }

      // ── right-edge tags: merged when close (Clean), the nearest support / resistance first, clear of the last-price tag and a
      // picked pattern's pivot tag (zzz1029), stacked ─────────────────────────────
      const mode: ChartDisplay = ext.display === 'research' ? 'research' : 'clean';
      // zzz1030 — one level = one tag (a level that reached the list twice was drawn as two identical stacked tags)
      const inside = dedupeAlnTags(tags, ext.decimals).filter((t) => t.y > -8 && t.y < bounding.height + 8);
      const lastClose = data[data.length - 1]?.close;
      const pri = levelPriorities(inside, typeof lastClose === 'number' ? lastClose : null);
      const reqs = mergeLevelTags(inside.map((t) => ({ ...t, priority: pri.get(t.id) ?? 0 })), { mode, fmt: (n) => fmtAlnPrice(n, ext.decimals) });
      const reserved = [lastClose, ...(ext.avoid || [])].filter((p): p is number => typeof p === 'number' && Number.isFinite(p)).map((p) => yAxis.convertToPixel(p));
      const { placed } = placeEdgeTags(reqs, { mode, gap: fontSize + 6, min: 8, max: Math.max(8, bounding.height - 8), reserved, maxTags: CLEAN_MAX_EDGE_TAGS, maxShift: 3 * (fontSize + 6) });
      if (placed.length) {
        ctx.font = `600 ${fontSize}px ${FONT}`;
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        placed.forEach((t) => {
          const y = t.yPlaced;
          const w = ctx.measureText(t.text).width + 10, h = fontSize + 5;
          const x1 = bounding.width - 4, x0 = x1 - w;
          ctx.fillStyle = rgba(t.color, 0.9);
          const r = 3;
          ctx.beginPath();
          ctx.moveTo(x0 + r, y - h / 2); ctx.lineTo(x1 - r, y - h / 2); ctx.quadraticCurveTo(x1, y - h / 2, x1, y - h / 2 + r);
          ctx.lineTo(x1, y + h / 2 - r); ctx.quadraticCurveTo(x1, y + h / 2, x1 - r, y + h / 2);
          ctx.lineTo(x0 + r, y + h / 2); ctx.quadraticCurveTo(x0, y + h / 2, x0, y + h / 2 - r);
          ctx.lineTo(x0, y - h / 2 + r); ctx.quadraticCurveTo(x0, y - h / 2, x0 + r, y - h / 2);
          ctx.fill();
          ctx.fillStyle = col.tagText;
          ctx.fillText(t.text, x1 - 5, y + 0.5);
        });
      }
      ctx.restore();
      return false;
    },
  });
}
