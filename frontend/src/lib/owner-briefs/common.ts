// zzz914 — shared pieces of the two scheduled owner briefs (conviction-catalyst-brief, portfolio-thesis-watch).
//
// The briefs used to run as Claude scheduled tasks that needed the owner's Mac awake (they read the book out of his browser).
// The book now lives on the server (/api/v1/user-state), so the app composes and sends them itself. Everything here is pure.
// Personal data (holdings, bench, theses) only ever passes through these functions — it is never logged and never in source.

/** A /api/v1/user-state value is what the browser vault pushed: `{ __raw, parsed }` (see lib/user-vault-client). Older
 *  writers may have stored the parsed value or the raw string. Returns the parsed value, or null. */
export function vaultValue(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') { try { return JSON.parse(v); } catch { return null; } }
  if (typeof v === 'object' && v && ('__raw' in (v as any) || 'parsed' in (v as any))) {
    const o = v as { __raw?: unknown; parsed?: unknown };
    if (o.parsed !== undefined) return o.parsed;
    if (typeof o.__raw === 'string') { try { return JSON.parse(o.__raw); } catch { return null; } }
    return null;
  }
  return v;
}

/** Upper case, exchange prefix and suffix removed. Never merges two different companies. */
export const bareTicker = (t: unknown): string =>
  String(t ?? '').trim().toUpperCase().replace(/^(NSE|BSE|BOM|NASDAQ|NYSE|AMEX):/, '').replace(/\.(NS|BO|BSE|NSE)$/, '');

/** True for a symbol written as a US listing (exchange prefix or .US suffix). Plain symbols are India. */
export const looksUsListed = (t: unknown): boolean => /^(NASDAQ|NYSE|AMEX|OTC):/i.test(String(t ?? '').trim()) || /\.US$/i.test(String(t ?? '').trim());

export const num = (v: unknown): number | null => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') { const n = Number(v.replace(/[, %]/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
};

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "06 Oct 2026" in the given time zone (default Europe/Berlin, where the owner reads the mail). */
export function briefDate(d: Date, timeZone = 'Europe/Berlin'): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value || '';
  return `${get('day')} ${MON[Number(get('month')) - 1]} ${get('year')}`;
}
/** "2026-10-06" in the given time zone — the send-once key. */
export function briefDayKey(d: Date, timeZone = 'Europe/Berlin'): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p;
}

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

/** A real anchor — never a bare URL in visible text (Gmail rewrites bare URLs into long tracking links). */
export function link(url: unknown, label: string): string {
  const u = String(url ?? '');
  return /^https:\/\//.test(u) ? `<a href="${esc(u)}" style="color:#1d4ed8">${esc(label)}</a>` : esc(label);
}

/** Plain text must not carry markup (the 17 Sep brief arrived as raw HTML in the text part). */
export function plainText(s: string): string {
  return s.replace(/<[^>]*>/g, '').replace(/[<>]/g, '');
}

/** White page, dark text, no dark fills — the owner prints these. Static HTML, no script. */
export function emailShell(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;padding:16px;background:#ffffff;color:#111827;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.45">`
    + `<div style="max-width:980px;margin:0 auto;background:#ffffff">`
    + `<h2 style="margin:0 0 8px;font-size:18px;color:#111827">${esc(title)}</h2>${bodyHtml}</div></body></html>`;
}

export const TABLE = 'border-collapse:collapse;width:100%;margin:6px 0 14px;font-size:13px';
export const TH = 'text-align:left;border-bottom:2px solid #d1d5db;padding:4px 6px;background:#f9fafb;color:#111827';
export const TD = 'border-bottom:1px solid #e5e7eb;padding:4px 6px;vertical-align:top';

/** Words the briefs must never use as advice. Tests scan every composed brief for them. */
export const ADVICE_WORDS = /\b(buy|sell|strong buy|target price|price target)\b/i;
