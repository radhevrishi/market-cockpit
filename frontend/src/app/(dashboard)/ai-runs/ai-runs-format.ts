// zzz1050 — plain-English labels and number formats for the /ai-runs page (kept out of page.tsx: page files export only the page).

export const OUTCOME_LABEL: Record<string, string> = {
  ok: 'Worked',
  failed: 'Failed (no answer / error)',
  schema_fail: 'Answer in the wrong shape',
  quote_rejected: 'Quotes not found in the document',
  escalated: 'Sent to the stronger model',
  cap_reached: 'Stopped: spending cap reached',
};

export const OUTCOME_COLOR: Record<string, string> = {
  ok: '#047857', failed: '#b91c1c', schema_fail: '#b45309', quote_rejected: '#b45309', escalated: '#4338ca', cap_reached: '#6b7280',
};

export const ESCALATION_LABEL: Record<string, string> = {
  schema_fail: 'first answer had the wrong shape',
  quote_rejects: 'most quotes were not in the document',
  no_rows_but_guidance: 'no guidance found, but the text talks about guidance',
  long_document: 'very long document, little found',
  low_confidence: 'the model was unsure of its rows',
};

export const usd = (v: number | null | undefined, d = 4) => (v == null || !Number.isFinite(Number(v)) ? '—' : `$${Number(v).toFixed(d)}`);
export const secs = (ms: number | null | undefined) => (ms == null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
export const pct = (part: number, whole: number) => (whole > 0 ? Math.min(100, Math.round((part / whole) * 100)) : 0);
export const when = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
};
/** "ai-desk" → "AI desk", "guidance-extract" → "Guidance extract" */
export const jobLabel = (job: string) => {
  const s = String(job || '').replace(/-/g, ' ');
  return s.replace(/^ai\b/i, 'AI').replace(/^./, (c) => c.toUpperCase());
};
/** an escalation reason as stored ("long_document" or "long_document (not sent: sub_cap)") in plain words */
export const escalationText = (r: string | null | undefined) => {
  if (!r) return '';
  const m = /^([a-z_]+)(?: \(not sent: ([a-z_]+)\))?$/.exec(r);
  if (!m) return r;
  const base = ESCALATION_LABEL[m[1]] || m[1];
  if (!m[2]) return base;
  const why: Record<string, string> = { sub_cap: 'the daily stronger-model budget was used up', run_cap: 'this run’s budget was used up', run_limit: 'this run’s limit was reached', off: 'the stronger model is switched off', unpriced: 'the stronger model has no price' };
  return `${base} — not sent: ${why[m[2]] || m[2]}`;
};
