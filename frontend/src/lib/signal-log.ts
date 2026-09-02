// ════════════════════════════════════════════════════════════════════════════
// signal-log.ts (zzz524) — the portal's track record. Every engine that fires
// a signal logs it here (once per signal per day); outcomes are scored later
// against live quotes at +1w / +1m / +3m. The Signal Scoreboard on Home reads
// the aggregates — turning the portal from a pile of opinions into a system
// with a measurable hit rate per engine.
// localStorage-backed (cap ~1200 rows), SSR-safe, all failures silent.
// ════════════════════════════════════════════════════════════════════════════

export interface SignalRecord {
  id: string;              // `${surface}:${ticker}:${yyyy-mm-dd}`
  surface: string;         // 'cockpit' | 'pullback' | 'cheat-entry' | 'conviction' | 'bounce' | ...
  ticker: string;
  note: string;            // short human label of what fired
  priceAt: number | null;  // price when the signal fired (null = score later on first quote seen)
  ts: number;              // epoch ms
  // outcomes, filled by scoreSignals()
  r1w?: number | null; r1m?: number | null; r3m?: number | null;
}

const KEY = 'mc:signal-log:v1';
const CAP = 1200;
const DAY = 86_400_000;

const today = () => new Date().toISOString().slice(0, 10);
const norm = (s: any) => String(s || '').toUpperCase().replace(/\.(NS|BO|NSE|BSE)$/i, '').trim();

function readAll(): SignalRecord[] {
  if (typeof window === 'undefined') return [];
  try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}
function writeAll(rows: SignalRecord[]) {
  try { localStorage.setItem(KEY, JSON.stringify(rows.slice(-CAP))); } catch { /* full */ }
}

/** Log one signal. Deduped per surface+ticker+day, so render loops are safe. */
export function logSignal(surface: string, ticker: string, note: string, priceAt?: number | null) {
  if (typeof window === 'undefined') return;
  const t = norm(ticker); if (!t) return;
  const id = `${surface}:${t}:${today()}`;
  const rows = readAll();
  if (rows.some((r) => r.id === id)) return;
  rows.push({ id, surface, ticker: t, note: String(note || '').slice(0, 90), priceAt: typeof priceAt === 'number' && isFinite(priceAt) ? priceAt : null, ts: Date.now() });
  writeAll(rows);
}

/** Batch version for signal builders (cockpit/pullbacks) — one write. */
export function logSignals(surface: string, items: Array<{ ticker: string; note: string; priceAt?: number | null }>) {
  if (typeof window === 'undefined' || !items.length) return;
  const rows = readAll(); const day = today(); let dirty = false;
  const have = new Set(rows.map((r) => r.id));
  for (const it of items) {
    const t = norm(it.ticker); if (!t) continue;
    const id = `${surface}:${t}:${day}`;
    if (have.has(id)) continue;
    rows.push({ id, surface, ticker: t, note: String(it.note || '').slice(0, 90), priceAt: typeof it.priceAt === 'number' && isFinite(it.priceAt) ? it.priceAt : null, ts: Date.now() });
    have.add(id); dirty = true;
  }
  if (dirty) writeAll(rows);
}

/** Score pending outcomes against a live price map (symbol → price).
 *  Fills priceAt for rows logged without one, then r1w/r1m/r3m once the
 *  window has elapsed. Call opportunistically wherever quotes are in hand. */
export function scoreSignals(live: Map<string, number>) {
  if (typeof window === 'undefined' || !live.size) return;
  const rows = readAll(); let dirty = false; const now = Date.now();
  for (const r of rows) {
    const px = live.get(r.ticker);
    if (px == null || !isFinite(px) || px <= 0) continue;
    if (r.priceAt == null) { r.priceAt = px; dirty = true; continue; }
    const age = now - r.ts;
    const ret = (px / r.priceAt - 1) * 100;
    if (r.r1w == null && age >= 5 * DAY) { r.r1w = ret; dirty = true; }
    if (r.r1m == null && age >= 21 * DAY) { r.r1m = ret; dirty = true; }
    if (r.r3m == null && age >= 63 * DAY) { r.r3m = ret; dirty = true; }
  }
  if (dirty) writeAll(rows);
}

export interface SurfaceStats {
  surface: string; total: number;
  scored1w: number; hit1w: number; avg1w: number | null;
  scored1m: number; hit1m: number; avg1m: number | null;
}

/** Aggregate hit rates per engine surface. */
export function getScoreboard(): SurfaceStats[] {
  const rows = readAll();
  const by = new Map<string, SignalRecord[]>();
  for (const r of rows) { if (!by.has(r.surface)) by.set(r.surface, []); by.get(r.surface)!.push(r); }
  const out: SurfaceStats[] = [];
  for (const [surface, rs] of by) {
    const w = rs.filter((r) => typeof r.r1w === 'number') as Array<SignalRecord & { r1w: number }>;
    const m = rs.filter((r) => typeof r.r1m === 'number') as Array<SignalRecord & { r1m: number }>;
    out.push({
      surface, total: rs.length,
      scored1w: w.length, hit1w: w.length ? w.filter((r) => r.r1w > 0).length / w.length * 100 : 0,
      avg1w: w.length ? w.reduce((s, r) => s + r.r1w, 0) / w.length : null,
      scored1m: m.length, hit1m: m.length ? m.filter((r) => r.r1m > 0).length / m.length * 100 : 0,
      avg1m: m.length ? m.reduce((s, r) => s + r.r1m, 0) / m.length : null,
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

export function getRecentSignals(limit = 40): SignalRecord[] {
  return readAll().slice(-limit).reverse();
}
