// zzz1045b — when the Stock Screener data is rebuilt on the server (the app scheduler's build-screener-us / build-screener-in jobs,
// lib/app-scheduler.ts — a test checks the crons below still match), and the next time that happens. Pure. The page's "Refresh"
// only loads the stored snapshot again; it never starts a rebuild.
import type { ScreenMarket } from './types';

/** Copied from lib/app-scheduler.ts (that module is server-only). All times UTC. */
export const SCREENER_REBUILD_CRONS: Record<ScreenMarket, readonly string[]> = {
  US: ['45 14,18,22 * * 1-5', '45 2 * * 2-6'],
  IN: ['5,25,45 * * * *'],
};

/** Plain words for the schedule. */
export const SCREENER_REBUILD_TEXT: Record<ScreenMarket, string> = {
  US: 'USA data is rebuilt on weekdays at 14:45, 18:45 and 22:45 UTC, and at 02:45 UTC the night after',
  IN: 'India data is rebuilt every 20 minutes (at :05, :25 and :45 past each hour) — prices each time, company pages a slice at a time',
};

function field(spec: string, lo: number, hi: number): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [range, stepS] = part.split('/');
    const step = stepS ? Number(stepS) : 1;
    if (!Number.isInteger(step) || step < 1) return null;
    let a: number, b: number;
    if (range === '*') { a = lo; b = hi; } else if (range.includes('-')) { const [x, y] = range.split('-').map(Number); a = x; b = y; } else { a = Number(range); b = stepS ? hi : a; }
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < lo || b > hi || a > b) return null;
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return out;
}
interface Parsed { min: Set<number>; hour: Set<number>; dom: Set<number>; mon: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean }
/** A 5-field cron (minute hour day-of-month month day-of-week; numbers, lists, ranges, steps). null when it cannot be read. */
export function parseCron(expr: string): Parsed | null {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  const min = field(p[0], 0, 59), hour = field(p[1], 0, 23), dom = field(p[2], 1, 31), mon = field(p[3], 1, 12), dowRaw = field(p[4], 0, 7);
  if (!min || !hour || !dom || !mon || !dowRaw) return null;
  const dow = new Set(Array.from(dowRaw, (d) => d % 7));
  return { min, hour, dom, mon, dow, domStar: p[2] === '*', dowStar: p[4] === '*' };
}
function hits(c: Parsed, d: Date): boolean {
  if (!c.min.has(d.getUTCMinutes()) || !c.hour.has(d.getUTCHours()) || !c.mon.has(d.getUTCMonth() + 1)) return false;
  const domOk = c.dom.has(d.getUTCDate()), dowOk = c.dow.has(d.getUTCDay());
  // standard cron: when both day fields are limited, either may match
  return c.domStar && c.dowStar ? true : c.domStar ? dowOk : c.dowStar ? domOk : domOk || dowOk;
}

/** The first scheduled minute strictly after `now` (UTC), across the market's crons; null if none within 8 days. */
export function nextRebuild(market: ScreenMarket, now: Date = new Date()): Date | null {
  const parsed = SCREENER_REBUILD_CRONS[market].map(parseCron).filter((x): x is Parsed => !!x);
  if (!parsed.length) return null;
  const t = new Date(now.getTime());
  t.setUTCSeconds(0, 0);
  for (let i = 0; i < 8 * 24 * 60; i++) {
    t.setUTCMinutes(t.getUTCMinutes() + 1);
    if (parsed.some((c) => hits(c, t))) return new Date(t.getTime());
  }
  return null;
}

/** 'HH:MM' UTC. */
export const hhmmUtc = (d: Date): string => d.toISOString().slice(11, 16);

/** Tooltip words for the Refresh button and the build time. */
export function refreshExplain(market: ScreenMarket, builtAt: Date | null, now: Date = new Date()): string {
  const next = nextRebuild(market, now);
  return [
    'Refresh loads the stored snapshot again (quick). It does not rebuild the data.',
    builtAt ? `This snapshot was built ${builtAt.toLocaleString()}.` : 'Build time not known.',
    `${SCREENER_REBUILD_TEXT[market]}.`,
    next ? `Next scheduled rebuild: about ${next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} your time (${hhmmUtc(next)} UTC); a rebuild takes a few minutes.` : '',
  ].filter(Boolean).join('\n');
}

/** zzz1047 — when a figure that no company has yet will arrive: "next USA build about 20:45 your time (18:45 UTC); a build reads
 *  as many companies as it can in a few minutes, the rest at the build after". */
export function nextFillText(market: ScreenMarket, now: Date = new Date()): string {
  const next = nextRebuild(market, now);
  const m = market === 'US' ? 'USA' : 'India';
  if (!next) return `filled by the next ${m} screener build`;
  return `filled by the next ${m} screener build, about ${next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} your time (${hhmmUtc(next)} UTC); a build reads as many companies as it can in a few minutes, the rest at the build after`;
}
/** Short form for a card: "next build ~20:45". */
export function nextFillShort(market: ScreenMarket, now: Date = new Date()): string {
  const next = nextRebuild(market, now);
  return next ? `not built yet · next build ~${next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'not built yet';
}
