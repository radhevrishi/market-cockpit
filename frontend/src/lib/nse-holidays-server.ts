// zzz905 — server side of the NSE holiday calendar. Registers the KV reader with lib/market-hours so the sync accessor
// (isNseHolidayDate / isNseHoliday / isIndianMarketOpen) uses the official list collected by
// .github/workflows/scrape-nse-holidays.yml for every year, not only the 2026 constant. Kept out of market-hours.ts so
// client components that import market-hours never pull the Redis client into the browser bundle.
import { kvGet } from '@/lib/kv';
import { setNseHolidayReader, loadNseHolidays, nseHolidayStatus, type NseHolidayBlob } from '@/lib/market-hours';

export const NSE_HOLIDAYS_KV_KEY = 'nse-holidays:v1';

setNseHolidayReader(() => kvGet<NseHolidayBlob>(NSE_HOLIDAYS_KV_KEY));

let loggedMissing = false;

/** Load (or reuse, 12 h) the collected holiday list. Never throws; logs once when the current year has no list. */
export async function warmNseHolidays(): Promise<ReturnType<typeof nseHolidayStatus>> {
  try { await loadNseHolidays(); } catch { /* keep fallback */ }
  const status = nseHolidayStatus();
  if (status.missingFor && !loggedMissing) {
    loggedMissing = true;
    console.warn(`[nse-holidays] holidays missing for ${status.missingFor} — run the scrape-nse-holidays workflow`);
  }
  return status;
}
