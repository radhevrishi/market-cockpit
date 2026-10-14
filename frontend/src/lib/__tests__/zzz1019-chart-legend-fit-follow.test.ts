// zzz1019 — Charts. Owner: "not possible to delete indicators in chart, not possible to do auto fit as in TradingView" and
// "changing to weekly but analysis is still daily … if I change daily / weekly / monthly the analysis should change automatically".
//  • every legend row has a × that removes the line / indicator from the working layout; Volume is a legend row too (× = off)
//  • a "fit" chip shows every loaded bar with the price axis on auto-fit (Alt+R still goes back to the chosen range)
//  • the chart-pattern analysis follows the chart's D / W / M (opening and switching); a pick in the banner lasts until the next switch
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seedLayoutStore, activeLayout, legendRowsWithVolume, removeRow, toggleRow, priceSeriesOf, VOLUME_ROW_ID, type ChartLayout } from '../chart-layouts';
import { analysisForChartTf } from '../../components/charts/pattern-view';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');

function layout(): ChartLayout {
  const l = activeLayout(seedLayoutStore(0));
  return { ...l, volume: { ...l.volume, on: true } };
}

test('legend × removes a line and an indicator; Volume is a row that × switches off', () => {
  const l = layout();
  const rows = legendRowsWithVolume(l);
  assert.ok(rows.some((r) => r.id === VOLUME_ROW_ID && r.pane && r.source === 'volume'));
  const first = l.lines[0];
  assert.ok(first, 'default layout has a line');
  const after = removeRow(l, first.id);
  assert.equal(after.lines.some((x) => x.id === first.id), false);
  assert.equal(after.lines.length, l.lines.length - 1);
  const noVol = removeRow(l, VOLUME_ROW_ID);
  assert.equal(noVol.volume.on, false);
  assert.equal(legendRowsWithVolume(noVol).some((r) => r.id === VOLUME_ROW_ID), false);
  // the volume row never becomes a price line
  assert.equal(priceSeriesOf(l).length, priceSeriesOf(noVol).length);
  assert.equal(toggleRow(l, VOLUME_ROW_ID).volume.on, false);
  const withRsi: ChartLayout = { ...l, extras: [...l.extras, { id: 'x1', type: 'RSI', on: false, params: [14], color: '#7E57C2' } as any] };
  assert.equal(removeRow(withRsi, 'x1').extras.some((e) => e.id === 'x1'), false);
});

test('legend renders the × and hides the eye for Volume; the chart passes onRemove', () => {
  const lc = read('../../components/charts/LayoutControls.tsx');
  assert.match(lc, /aria-label=\{`Remove \$\{r\.label\}`\}/);
  assert.match(lc, /r\.source !== 'volume' && <button/);
  const ws = read('../../components/charts/ChartWorkspace.tsx');
  assert.match(ws, /onRemove=\{\(id\) => L\.setWorking\(\(w\) => removeRow\(w, id\)\)\}/);
  assert.match(ws, /legendRowsWithVolume\(L\.working\)/);
});

test('fit chip shows every loaded bar and turns auto-fit on', () => {
  const ws = read('../../components/charts/ChartWorkspace.tsx');
  assert.match(ws, /const fitAll = useCallback/);
  assert.match(ws, /aria-label="Fit the whole chart" onClick=\{fitAll\}/);
  assert.match(ws, /\(width - 24\) \/ bars\.length/);
});

test('analysis follows the chart timeframe', () => {
  assert.deepEqual(analysisForChartTf('W', { tf: 'D', provisional: false }), { tf: 'W', provisional: false });
  assert.deepEqual(analysisForChartTf('M', { tf: 'A', provisional: true }), { tf: 'M', provisional: true });
  assert.deepEqual(analysisForChartTf('D', { tf: 'W', provisional: true }), { tf: 'D', provisional: false });
  assert.deepEqual(analysisForChartTf(undefined, { tf: 'A', provisional: false }), { tf: 'A', provisional: false });
  const pi = read('../../components/charts/PatternIndicator.tsx');
  assert.match(pi, /return analysisForChartTf\(displayTf, stored\)/);
  assert.match(pi, /setPref\(\(p\) => analysisForChartTf\(displayTf, p\)\)/);
  // a Pine hand-off still opens on its own analysis timeframe
  assert.match(pi, /if \(handoff\) return \{ tf: handoff\.atf, provisional: false \}/);
});
