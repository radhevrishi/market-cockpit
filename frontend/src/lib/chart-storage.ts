// zzz937 — browser storage for /charts. Both keys are listed in user-vault-keys.ts, so they sync to the owner's database
// and come back on another device. Every read / write is guarded (private mode, full storage).
import { DEFAULT_SETTINGS, sanitizeDrawings, sanitizeSettings, type ChartSettings, type DrawingStore, type SavedDrawing } from './chart-math';

export const CHART_DRAWINGS_KEY = 'mc:chart-drawings:v1';
export const CHART_SETTINGS_KEY = 'mc:chart-settings:v1';

function readJson(key: string): unknown {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked */ }
}

export function loadSettings(): ChartSettings {
  const raw = readJson(CHART_SETTINGS_KEY);
  return raw ? sanitizeSettings(raw) : sanitizeSettings(DEFAULT_SETTINGS);
}
export function saveSettings(s: ChartSettings): void { writeJson(CHART_SETTINGS_KEY, sanitizeSettings(s)); }

export function loadDrawings(key: string): SavedDrawing[] {
  const all = readJson(CHART_DRAWINGS_KEY) as DrawingStore | null;
  return all && typeof all === 'object' ? sanitizeDrawings((all as any)[key]) : [];
}
export function saveDrawings(key: string, list: SavedDrawing[]): void {
  const all = (readJson(CHART_DRAWINGS_KEY) as DrawingStore | null) || {};
  const next: DrawingStore = { ...(typeof all === 'object' ? all : {}) };
  if (list.length) next[key] = sanitizeDrawings(list); else delete next[key];
  writeJson(CHART_DRAWINGS_KEY, next);
}
