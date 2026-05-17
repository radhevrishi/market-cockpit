// ═══════════════════════════════════════════════════════════════════════════
// CENTRAL TIME FORMATTERS — PATCH 0455 CLEANUP-2
//
// Audit found fragmented time-of-day formatting: /news used the deterministic
// ladder (now / Xm / Xh / Xd / date), /portfolio used `Date.toLocaleString`,
// /orders had its own variant, /earnings something else. One helper now,
// reused everywhere. Consistent UX, less maintenance surface.
// ═══════════════════════════════════════════════════════════════════════════

/** Deterministic "time ago" ladder.
 *  < 60s        → 'now'
 *  < 60m        → 'Xm ago'
 *  < 24h        → 'Xh ago'
 *  ≤ 7d         → 'Xd ago'
 *  else         → absolute date ('15 May 2026')
 *
 *  Returns '—' for invalid / undefined input. */
export function timeAgo(iso?: string | number | Date | null): string {
  if (iso == null) return '—';
  const t = typeof iso === 'number' ? iso : (iso instanceof Date ? iso.getTime() : Date.parse(String(iso)));
  if (!Number.isFinite(t)) return '—';
  const now = Date.now();
  const delta = now - t;
  if (delta < 0) {
    // Future timestamp — show absolute.
    return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
  }
  if (delta < 60_000) return 'now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  if (delta < 7 * 86_400_000) return `${Math.floor(delta / 86_400_000)}d ago`;
  return new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

/** Absolute timestamp formatter — '03 May 2026 · 14:32 IST'. Useful for
 *  tooltips that complement the timeAgo() short label. */
export function timeAbsolute(iso?: string | number | Date | null): string {
  if (iso == null) return '—';
  const t = typeof iso === 'number' ? iso : (iso instanceof Date ? iso.getTime() : Date.parse(String(iso)));
  if (!Number.isFinite(t)) return '—';
  const d = new Date(t);
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Short HH:MM stamp — for header chips like 'as of 15:18'. */
export function clockShort(iso?: string | number | Date | null): string {
  if (iso == null) return '—';
  const t = typeof iso === 'number' ? iso : (iso instanceof Date ? iso.getTime() : Date.parse(String(iso)));
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Compact age formatter without the 'ago' suffix — for chip slots. */
export function ageCompact(iso?: string | number | Date | null): string {
  const s = timeAgo(iso);
  return s.replace(/ ago$/, '');
}
