// zzz1116 (guidance audit G04) — the Focus list's "held back for review" decision (a worked-out revenue growth that does not match
// the revenue the company reports — Dhanuka: ₹65 Cr "vs ₹50 Cr" while yearly revenue is about ₹2,020 Cr) needs the company figures
// the Focus list reads. Other rankings on the same page (Highest Active / Derived) read the held keys from here, so one questionable
// growth is never "held back" in one list and ranked in another. Client-only store; pure helpers below.
import { useSyncExternalStore } from 'react';
import type { GuHighGrowthGroups, GuHgGroupRow } from './guidance-universe-types';
import { keyOf } from './gu-focus';

const EV = 'gu-held-updated';
let held: ReadonlySet<string> = new Set();
let sig = '';
export function setHeldKeys(keys: readonly string[]): void {
  const s = Array.from(new Set(keys)).sort().join(',');
  if (s === sig) return;
  sig = s; held = new Set(s ? s.split(',') : []);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(EV));
}
const subscribe = (cb: () => void) => { if (typeof window === 'undefined') return () => {}; window.addEventListener(EV, cb); return () => window.removeEventListener(EV, cb); };
export function useHeldKeys(): ReadonlySet<string> { return useSyncExternalStore(subscribe, () => held, () => held); }

/** The groups without the held REVENUE growths (a row whose headline is that growth leaves; another metric of the row stays). Pure. */
export function withoutHeld(groups: GuHighGrowthGroups | null | undefined, keys: ReadonlySet<string>): GuHighGrowthGroups | null | undefined {
  if (!groups?.cohorts || !keys.size) return groups;
  const clean = (l: GuHgGroupRow[] = []) => l.flatMap((r) => {
    if (!keys.has(keyOf(r.market, r.ticker, r.company))) return [r];
    if (r.headline?.metric === 'REVENUE') return [];
    const metrics = (r.metrics || []).filter((x) => x.metric !== 'REVENUE');
    return metrics.length ? [{ ...r, metrics }] : [];
  }).map((r, i) => ({ ...r, rank: i + 1 }));
  return {
    ...groups,
    cohorts: Object.fromEntries(Object.entries(groups.cohorts).map(([c, l]) => [c, clean(l)])) as GuHighGrowthGroups['cohorts'],
    trust: Object.fromEntries(Object.entries(groups.trust || {}).map(([t, byC]) => [t, Object.fromEntries(Object.entries(byC).map(([c, l]) => [c, clean(l)]))])) as GuHighGrowthGroups['trust'],
  };
}
