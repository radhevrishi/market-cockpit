// zzz1018 — chart drawings: the default colour follows the theme (white on dark, blue on white); a picked colour is kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { drawingAutoColor, isAutoDrawingColor } from '../chart-drawing-color';

test('default drawing colour: white on dark, blue on white; old default blue and no colour follow the theme', () => {
  assert.equal(drawingAutoColor(false), '#FFFFFF');
  assert.equal(drawingAutoColor(true), '#2962FF');
  assert.equal(isAutoDrawingColor(undefined), true);
  assert.equal(isAutoDrawingColor('#2962ff'), true);
  assert.equal(isAutoDrawingColor('#F23645'), false);
});

test('chart wiring: new drawings use the theme colour until one is picked; saved without a colour; recoloured on theme switch', () => {
  const ws = readFileSync(new URL('../../components/charts/ChartWorkspace.tsx', import.meta.url), 'utf8');
  assert.match(ws, /const drawColor = pickedColor \?\? autoDrawColor;/);
  assert.match(ws, /!autoIdsRef\.current\.has\(o\.id\) && \(o\.styles as any\)\?\.line\?\.color/);
  assert.match(ws, /chart\.overrideOverlay\(\{ id, styles: \{ line: \{ color: autoDrawColor \}/);
  assert.match(ws, /onDoubleClick=\{\(e\) => \{ e\.preventDefault\(\); setPickedColor\(null\); \}\}/);
  assert.doesNotMatch(ws, /useState\('#2962FF'\)/);
});
