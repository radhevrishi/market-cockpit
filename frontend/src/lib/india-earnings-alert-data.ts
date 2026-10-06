// zzz911 — reads graded India days from KV for the earnings alerts (the pure rules are in india-earnings-alert.ts).
// Same namespace tolerance as the bench: current key first, then older ones, and a payload with no rows is not an answer.
import { kvGet } from '@/lib/kv';
import { gradedKeyCandidates } from '@/lib/graded-cache-key';
import { withCurrentIndiaRules } from '@/lib/india-regrade';
import { rowsOf, selectIndiaAlertHits, type GradedDay } from '@/lib/india-earnings-alert';

export async function readGradedDay(date: string): Promise<GradedDay> {
  for (const k of gradedKeyCandidates(date)) {
    try {
      const v = await kvGet(k);
      if (!v) continue;
      const parsed = typeof v === 'string' ? JSON.parse(v) : v;
      if (rowsOf(parsed).length > 0) return { date, key: k, payload: withCurrentIndiaRules(parsed, k) };   // zzz819
    } catch { /* try the next namespace */ }
  }
  return { date, key: null, payload: null };
}

export async function collectIndiaAlertHits(dates: string[], opts: { smallMidOnly?: boolean } = {}) {
  const days: GradedDay[] = [];
  for (const d of dates) days.push(await readGradedDay(d));
  return selectIndiaAlertHits(days, opts);
}
