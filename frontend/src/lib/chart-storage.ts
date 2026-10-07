// zzz937 / zzz944 — browser storage for /charts. Drawings (per ticker, with a save time each) and layouts are listed in
// user-vault-keys.ts, so they sync to the owner's database; the vault MERGES them (lib/chart-sync), so another device can
// never wipe them. Every read / write is guarded (private mode, full storage).
import { DEFAULT_SETTINGS, sanitizeSettings, type ChartSettings, type SavedDrawing } from './chart-math';
import { CHART_DRAWINGS_KEY, drawingsFor, readDrawingStore, rescueFromBackup, setDrawings, type DrawingStoreV2 } from './chart-sync';
import { CHART_LAYOUTS_KEY, cleanLayout, sanitizeLayoutStore, seedLayoutStore, type LayoutStore } from './chart-layouts';

export { CHART_DRAWINGS_KEY, CHART_LAYOUTS_KEY };
export const CHART_SETTINGS_KEY = 'mc:chart-settings:v1';   // zzz937 settings — read once to carry them into a layout
const RESCUE_FLAG = 'mc:chart-drawings:rescued:v1';

function readJson(key: string): unknown {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function writeJson(key: string, value: unknown): boolean {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; /* storage full or blocked */ }
}

export function loadSettings(): ChartSettings {
  const raw = readJson(CHART_SETTINGS_KEY);
  return raw ? sanitizeSettings(raw) : sanitizeSettings(DEFAULT_SETTINGS);
}

/** The whole drawings store, upgraded to v2. The first time on a device, drawings an older sync replaced are brought back. */
export function loadDrawingStore(): DrawingStoreV2 {
  let s = readDrawingStore(readJson(CHART_DRAWINGS_KEY));
  try {
    if (!localStorage.getItem(RESCUE_FLAG)) {
      const rescued = rescueFromBackup(s, readJson(`mc:vault:backup:${CHART_DRAWINGS_KEY}`));
      if (rescued !== s) { s = rescued; writeJson(CHART_DRAWINGS_KEY, s); }
      localStorage.setItem(RESCUE_FLAG, '1');
    }
  } catch { /* storage blocked */ }
  return s;
}
export function loadDrawings(key: string): SavedDrawing[] { return drawingsFor(loadDrawingStore(), key); }

/** Save one ticker's drawings. Returns the time saved, or null when nothing changed / storage refused. */
export function saveDrawings(key: string, list: SavedDrawing[], now = Date.now()): number | null {
  const cur = loadDrawingStore();
  const next = setDrawings(cur, key, list, now);
  if (next === cur) return null;
  return writeJson(CHART_DRAWINGS_KEY, next) ? next.items[key].at : null;
}

/** Layouts: seeded with his two TradingView layouts the first time. If he had zzz937 settings that differ from the
 *  defaults, they are kept as a third layout "My earlier settings". */
export function loadLayoutStore(): LayoutStore {
  const raw = readJson(CHART_LAYOUTS_KEY);
  if (raw) return sanitizeLayoutStore(raw);
  const seeded = seedLayoutStore();
  const old = readJson(CHART_SETTINGS_KEY);
  if (old) {
    const s = sanitizeSettings(old);
    if (JSON.stringify(s) !== JSON.stringify(sanitizeSettings(DEFAULT_SETTINGS))) {
      seeded.layouts.push(cleanLayout({
        name: 'My earlier settings', updatedAt: Date.now(),
        lines: s.emas.map((e) => ({ kind: 'EMA', period: e.period, color: e.color, on: e.on })),
        volume: { on: s.showVolume, avg: s.volAvg }, extras: [],
      }));
    }
  }
  writeJson(CHART_LAYOUTS_KEY, seeded);
  return seeded;
}
export function saveLayoutStore(s: LayoutStore): boolean { return writeJson(CHART_LAYOUTS_KEY, s); }
