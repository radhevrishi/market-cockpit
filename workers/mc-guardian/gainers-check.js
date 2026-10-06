// zzz912 — once-a-day gainers pipeline check (replaces the Claude "gainers pipeline heartbeat" task).
//
// Weekdays from 14:20 UTC (the old task's time): read the app's public /api/v1/cron/gainers-pulse. Healthy → silence.
// Broken (no India gainers research in the last two trading sessions) → one short Telegram, but only after the SAME
// verdict on two runs in a row (10 minutes apart), so one failed Redis read cannot raise a false alarm.
// The app not answering is retried every run until 17:20 UTC, then reported once ("could not check").
// Pure decisions are exported for tests (frontend/src/lib/__tests__/zzz912-*.test.ts).

export const GAINERS_CHECK_FROM_UTC_MIN = 14 * 60 + 20;
export const GAINERS_GIVE_UP_UTC_MIN = 17 * 60 + 20;

const utcDate = (now) => now.toISOString().slice(0, 10);
const utcMin = (now) => now.getUTCHours() * 60 + now.getUTCMinutes();

/** Is today's check still to do? `state` = { date, done, strikes } from KV (or null). */
export function gainersCheckDue(now, state) {
  const dow = now.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (utcMin(now) < GAINERS_CHECK_FROM_UTC_MIN) return false;
  return !(state && state.date === utcDate(now) && state.done);
}

/**
 * What to do with one reading. `reading` = { ok: true, body } when the app answered 200, else { ok: false, why }.
 * Returns { action: 'silent' | 'wait' | 'alert', state, text? }.
 */
export function decideGainers(now, state, reading) {
  const date = utcDate(now);
  const prev = state && state.date === date ? state : { date, done: false, strikes: 0 };
  if (!reading.ok || !reading.body || typeof reading.body.ok !== 'boolean') {
    if (utcMin(now) >= GAINERS_GIVE_UP_UTC_MIN) {
      return { action: 'alert', state: { date, done: true, strikes: 0 }, text: 'Gainers pipeline check could not run today\n\nThe app did not answer /api/v1/cron/gainers-pulse since 14:20 UTC (' + (reading.why || 'no verdict') + '). The guardian\'s other probes say whether the app itself is down.' };
    }
    return { action: 'wait', state: prev };
  }
  const b = reading.body;
  if (b.ok) return { action: 'silent', state: { date, done: true, strikes: 0 } };
  if ((prev.strikes || 0) < 1) return { action: 'wait', state: { date, done: false, strikes: 1 } };
  return { action: 'alert', state: { date, done: true, strikes: 2 }, text: gainersAlertText(b) };
}

/** Short and diagnostic: when output last appeared, the gainers jobs' last runs, the one likely cause. */
export function gainersAlertText(b) {
  const lines = ['Gainers pipeline has not run in 48h', ''];
  lines.push('No India gainers research for ' + (b.checked || []).join(' or ') + '.');
  lines.push(b.last_output ? 'Last research: the ' + b.last_output.date + ' session (' + b.last_output.researched + ' names' + (b.last_output.updated_at ? ', updated ' + b.last_output.updated_at : '') + ').' : 'No research found in the last ' + ((b.sessions || []).length) + ' sessions.');
  for (const h of b.heartbeats || []) {
    lines.push(h.name + ': last success ' + (h.last_ok_at || 'never') + (h.last_ok === false ? ' — last run FAILED' + (h.error ? ': ' + h.error : '') : ''));
  }
  if (b.likely_cause) lines.push('Most likely cause: ' + b.likely_cause + '.');
  return lines.join('\n');
}
