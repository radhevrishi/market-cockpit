// PATCH 0715 — Centralized timezone + market-session helpers.
// Goal: eliminate scattered inline IST math (`5.5 * 60 * 60 * 1000`,
// `getUTCDay()`, hard-coded session windows) so timezone bugs have one
// place to live + fix. India is permanent +5:30 (no DST), US uses ET
// which DOES observe DST; we approximate ET as UTC-5 standard / UTC-4
// daylight via the same IANA shortcut used by `Intl.DateTimeFormat`.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // +05:30 fixed (no DST in India)

// NSE equity-segment weekday trading holidays (official NSE 2026 circular).
// zzz905 — this constant is now only the FALLBACK. The official list for every year is collected monthly by
// .github/workflows/scrape-nse-holidays.yml into KV `nse-holidays:v1`; server code warms it (lib/nse-holidays-server.ts)
// and every check goes through isNseHolidayDate(), which prefers the collected list and uses this constant only for 2026.
export const NSE_HOLIDAYS = new Set<string>([
  '2026-01-15', '2026-01-26', '2026-03-03', '2026-03-26', '2026-03-31',
  '2026-04-03', '2026-04-14', '2026-05-01', '2026-05-28', '2026-06-26',
  '2026-09-14', '2026-10-02', '2026-10-20', '2026-11-10', '2026-11-24',
  '2026-12-25',
]);
const FALLBACK_YEAR = '2026';

/** KV `nse-holidays:v1` — written by .github/scripts/scrape-nse-holidays.mjs. */
export interface NseHolidayBlob {
  updatedAt: string;
  source: string;
  years: Record<string, string[]>;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Keep only well-formed years and dates; anything else from KV is ignored rather than trusted. */
export function sanitizeNseHolidayBlob(raw: unknown): NseHolidayBlob | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as any;
  if (!r.years || typeof r.years !== 'object') return null;
  const years: Record<string, string[]> = {};
  for (const [y, list] of Object.entries(r.years)) {
    if (!/^\d{4}$/.test(y) || !Array.isArray(list)) continue;
    const dates = [...new Set(list.filter((d): d is string => typeof d === 'string' && YMD_RE.test(d) && d.startsWith(`${y}-`)))].sort();
    if (dates.length) years[y] = dates;
  }
  if (!Object.keys(years).length) return null;
  return { updatedAt: String(r.updatedAt || ''), source: String(r.source || ''), years };
}

// In-memory state. Loaded data wins for every year it covers; the constant covers 2026 only.
const NSE_HOLIDAY_TTL_MS = 12 * 3600_000;
let loaded: { blob: NseHolidayBlob; sets: Map<string, Set<string>>; at: number } | null = null;
let lastAttemptAt = 0;
let inflight: Promise<NseHolidayBlob | null> | null = null;
let reader: (() => Promise<unknown>) | null = null;
const warnedYears = new Set<string>();

/** Install loaded data (used by the loader; exported so tests and the client prime can call it directly). */
export function applyNseHolidayBlob(raw: unknown, nowMs: number = Date.now()): boolean {
  const blob = sanitizeNseHolidayBlob(raw);
  if (!blob) return false;
  const sets = new Map<string, Set<string>>();
  for (const [y, list] of Object.entries(blob.years)) sets.set(y, new Set(list));
  loaded = { blob, sets, at: nowMs };
  return true;
}

/** Test helper: forget loaded data and the registered reader. */
export function _resetNseHolidays(): void { loaded = null; lastAttemptAt = 0; inflight = null; reader = null; warnedYears.clear(); }

/** Server code registers how to read KV (lib/nse-holidays-server.ts); the browser registers an API fetch. */
export function setNseHolidayReader(fn: (() => Promise<unknown>) | null): void { reader = fn; }

/**
 * Async loader: reads `nse-holidays:v1` through the registered reader, cached in memory for 12 h. A failed or empty
 * read keeps whatever was loaded before (and the 2026 constant) and is retried after 10 min, never on every call.
 */
export async function loadNseHolidays(opts: { force?: boolean; read?: () => Promise<unknown>; nowMs?: number } = {}): Promise<NseHolidayBlob | null> {
  const now = opts.nowMs ?? Date.now();
  const read = opts.read ?? reader;
  if (!read) return loaded?.blob ?? null;
  if (!opts.force && loaded && now - loaded.at < NSE_HOLIDAY_TTL_MS) return loaded.blob;
  if (!opts.force && now - lastAttemptAt < 10 * 60_000) return loaded?.blob ?? null;
  if (inflight) return inflight;
  lastAttemptAt = now;
  inflight = (async () => {
    try {
      const raw = await read();
      if (applyNseHolidayBlob(raw, now)) return loaded!.blob;
    } catch (e) {
      console.warn('[nse-holidays] read failed:', (e as Error)?.message || e);
    } finally { inflight = null; }
    return loaded?.blob ?? null;
  })();
  return inflight;
}

function holidaySetForYear(year: string): Set<string> | null {
  const fromData = loaded?.sets.get(year);
  if (fromData) return fromData;
  if (year === FALLBACK_YEAR) return NSE_HOLIDAYS;
  return null;
}

/** Sync accessor: true when `ymd` ('YYYY-MM-DD', IST date) is an NSE equity holiday. Uses loaded data when present. */
export function isNseHolidayDate(ymd: string): boolean {
  // Stale data on a server that registered a reader → refresh in the background; this call answers from what is held.
  if (reader && (!loaded || Date.now() - loaded.at >= NSE_HOLIDAY_TTL_MS)) void loadNseHolidays();
  const year = ymd.slice(0, 4);
  const set = holidaySetForYear(year);
  if (!set) {
    if (!warnedYears.has(year) && reader) {
      warnedYears.add(year);
      console.warn(`[nse-holidays] no holiday list for ${year} — every weekday is treated as a trading day until scrape-nse-holidays runs`);
    }
    return false;
  }
  return set.has(ymd);
}

/** Every known holiday (loaded years + the 2026 fallback) as one Set, for code that takes a ReadonlySet. */
export function nseHolidaySet(): ReadonlySet<string> {
  const out = new Set<string>();
  const years = new Set<string>([FALLBACK_YEAR, ...(loaded ? loaded.sets.keys() : [])]);
  for (const y of years) for (const d of holidaySetForYear(y) || []) out.add(d);
  return out;
}

/** Health view: which year (if any) is running without a holiday list. */
export function nseHolidayStatus(now?: Date): {
  loaded: boolean; source: string; updatedAt: string | null; years: string[]; missingFor: number | null; nextYearMissing: boolean;
} {
  const y = Number(istToday(now).slice(0, 4));
  const has = (yr: number) => holidaySetForYear(String(yr)) !== null;
  return {
    loaded: !!loaded,
    source: loaded?.blob.source || (has(y) ? 'fallback-constant' : 'none'),
    updatedAt: loaded?.blob.updatedAt || null,
    years: [...new Set<string>([FALLBACK_YEAR, ...(loaded ? loaded.sets.keys() : [])])].sort(),
    missingFor: has(y) ? null : y,
    nextYearMissing: !has(y + 1),
  };
}

/**
 * Browser: register the public API as the reader and load once (12 h cache). Safe to call on every mount. On the server
 * this is a no-op — server code warms through lib/nse-holidays-server.ts instead.
 */
export function primeNseHolidaysInBrowser(): Promise<NseHolidayBlob | null> {
  if (typeof window === 'undefined') return Promise.resolve(loaded?.blob ?? null);
  if (!reader) {
    setNseHolidayReader(async () => {
      const r = await fetch('/api/v1/nse-holidays', { signal: AbortSignal.timeout(10_000) });
      if (!r.ok) return null;
      const j = await r.json();
      return { years: j?.years, updatedAt: j?.updatedAt, source: j?.source };
    });
  }
  return loadNseHolidays();
}

/** True when today (IST) is an NSE trading holiday. */
export function isNseHoliday(now?: Date): boolean {
  return isNseHolidayDate(istToday(now));
}

/** Current wall-clock as a Date shifted into IST. */
export function istNow(now?: Date): Date {
  const base = now ?? new Date();
  return new Date(base.getTime() + IST_OFFSET_MS);
}

/** Today's date in IST as 'YYYY-MM-DD'. */
export function istToday(now?: Date): string {
  const t = istNow(now);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** Last N IST weekdays (Mon-Fri), newest first, as 'YYYY-MM-DD'. */
export function istLastNWeekdays(n: number): string[] {
  const out: string[] = [];
  const t = istNow();
  const cursor = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  while (out.length < n) {
    const dow = cursor.getUTCDay(); // 0=Sun..6=Sat (already on IST-shifted Date)
    if (dow !== 0 && dow !== 6) {
      const y = cursor.getUTCFullYear();
      const m = String(cursor.getUTCMonth() + 1).padStart(2, '0');
      const d = String(cursor.getUTCDate()).padStart(2, '0');
      out.push(`${y}-${m}-${d}`);
    }
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return out;
}

/** Mon-Fri 09:15-15:30 IST. */
export function isIndianMarketOpen(now?: Date): boolean {
  const t = istNow(now);
  const dow = t.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (isNseHolidayDate(istToday(now))) return false; // exchange holiday
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  return minutes >= (9 * 60 + 15) && minutes <= (15 * 60 + 30);
}

/** Approx Mon-Fri 09:30-16:00 ET via Intl. Handles DST. */
export function isUSMarketOpen(now?: Date): boolean {
  const base = now ?? new Date();
  // Use Intl.DateTimeFormat to extract ET wall-clock fields.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  }).formatToParts(base);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const minuteStr = parts.find((p) => p.type === 'minute')?.value ?? '0';
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  // Intl 'en-US' with hour12:false occasionally emits '24' for midnight; normalize.
  const hour = parseInt(hourStr, 10) % 24;
  const minute = parseInt(minuteStr, 10);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return false;
  const minutes = hour * 60 + minute;
  return minutes >= (9 * 60 + 30) && minutes < (16 * 60);
}

/** Format a Date as 'HH:MM IST'. */
export function formatISTTime(d: Date): string {
  const t = istNow(d);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm} IST`;
}
