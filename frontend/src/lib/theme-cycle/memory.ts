// zzz1290 — per-browser weekly record of theme cycle states (moved out of CyclePanel so Market Leadership & Risk shares it).
import type { Market } from '../theme-rotation/types';
import type { CycleRead, CycleState } from './classify';

// ── the week's states, kept per browser so a failed transition can be recognised ──
const MEM_KEY = (r: Market) => `mc:theme-cycle:states:v1:${r}`;
function weekOf(d = new Date()) { const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day); const y = new Date(Date.UTC(t.getUTCFullYear(), 0, 1)); return `${t.getUTCFullYear()}-W${String(Math.ceil(((+t - +y) / 86400000 + 1) / 7)).padStart(2, '0')}`; }
function readMem(r: Market): Record<string, Record<string, CycleState>> { try { return JSON.parse(localStorage.getItem(MEM_KEY(r)) || '{}') || {}; } catch { return {}; } }
export function previousStates(r: Market): Map<string, CycleState> {
  const mem = readMem(r), cur = weekOf();
  const weeks = Object.keys(mem).filter((w) => w < cur).sort().slice(-8);
  const out = new Map<string, CycleState>();
  for (const w of weeks) for (const [id, s] of Object.entries(mem[w] || {})) if (s === 'EARLY_ROTATION' || s === 'EMERGING_LEADER') out.set(id, s);
  return out;
}
export function saveStates(r: Market, reads: Map<string, CycleRead>) {
  try {
    const mem = readMem(r); const cur = weekOf();
    mem[cur] = Object.fromEntries([...reads.values()].map((x) => [x.id, x.state === 'FAILED_TRANSITION' ? 'NEUTRAL' : x.state]));
    const keep = Object.keys(mem).sort().slice(-12);
    localStorage.setItem(MEM_KEY(r), JSON.stringify(Object.fromEntries(keep.map((k) => [k, mem[k]]))));
  } catch { /* storage full / blocked — the panel still works */ }
}

