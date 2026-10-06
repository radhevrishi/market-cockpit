// zzz797 — where the owner's US scan criteria live (KV). Kept apart from the
// pure us-scan-criteria.ts so tests never touch KV.
import { kvGet, kvSet } from '@/lib/kv';
import { DEFAULT_US_SCAN_CRITERIA, US_SCAN_CRITERIA_KV_KEY, parseUsScanCriteria, type UsScanCriteria } from './us-scan-criteria';

export interface LoadedCriteria { criteria: UsScanCriteria; stored: boolean; problems: string[] }

/** The saved criteria, or the defaults. A KV failure never breaks the scan. */
export async function loadUsScanCriteria(): Promise<LoadedCriteria> {
  try {
    const raw = await kvGet(US_SCAN_CRITERIA_KV_KEY);
    if (raw && typeof raw === 'object') {
      const { criteria, problems } = parseUsScanCriteria(raw);
      return { criteria, stored: true, problems };
    }
  } catch { /* fall through to defaults */ }
  return { criteria: { ...DEFAULT_US_SCAN_CRITERIA, exchanges: [...DEFAULT_US_SCAN_CRITERIA.exchanges] }, stored: false, problems: [] };
}

/** Saved without expiry: these are settings, not cache. */
export async function saveUsScanCriteria(c: UsScanCriteria): Promise<void> {
  await kvSet(US_SCAN_CRITERIA_KV_KEY, c); // no TTL: the user's saved US scan criteria (a setting)
}
