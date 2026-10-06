'use client';
// zzz883 — the browser side of lib/fx.ts: the last known rate at once (localStorage), refreshed from /api/v1/fx in the background.
const LS = 'mc:fx:usdinr:v1';
let cur: { usdInr: number; live: boolean; asOf: string | null } | null = null;
let started = false;
export function usdInrNow(): { usdInr: number; live: boolean; asOf: string | null } {
  if (!cur) { try { const j = JSON.parse(localStorage.getItem(LS) || 'null'); if (j && j.usdInr > 50 && j.usdInr < 200) cur = j; } catch { /* none */ } }
  if (!started && typeof window !== 'undefined') {
    started = true;
    fetch('/api/v1/fx', { signal: AbortSignal.timeout(10_000) }).then((r) => r.json()).then((j) => {
      if (j?.usdInr > 50 && j.usdInr < 200) { cur = { usdInr: j.usdInr, live: !!j.live, asOf: j.asOf || null }; try { localStorage.setItem(LS, JSON.stringify(cur)); } catch { /* quota */ } window.dispatchEvent(new CustomEvent('mc:fx:updated')); }
    }).catch(() => {});
  }
  return cur || { usdInr: 85, live: false, asOf: null };
}
