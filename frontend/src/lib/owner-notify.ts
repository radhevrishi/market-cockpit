// zzz910 — one way for the app to tell the owner something: Telegram and/or email, with "send only once" memory.
//
// Channels (each is used only when its settings exist in Railway; none is required):
//   Telegram — TELEGRAM_BOT_TOKEN_<TOPIC> or TELEGRAM_BOT_TOKEN, and TELEGRAM_CHAT_ID_<TOPIC> or TELEGRAM_CHAT_ID
//   Email    — RESEND_API_KEY + NOTIFY_EMAIL_TO (+ optional NOTIFY_EMAIL_FROM), sent over HTTPS (no extra package), or
//              SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO via nodemailer (e.g. a Gmail app password)
// Nothing secret is ever logged or returned. A channel without settings is reported as 'skipped', never as an error.
import { kvSetNX, kvDel } from '@/lib/kv';

export type NotifyTopic = 'EARNINGS' | 'ALERTS' | 'BRIEF' | 'PORTFOLIO';
export type ChannelState = 'sent' | 'skipped' | 'error';
export interface NotifyResult { telegram: ChannelState; email: ChannelState; errors: string[] }
export interface NotifyMessage {
  subject: string;           // email subject and the first (bold) line on Telegram
  text: string;              // plain text body (Telegram, and the email text part)
  html?: string;             // optional email HTML body
  topic?: NotifyTopic;
}

const TIMEOUT_MS = 10_000;
const TG_LIMIT = 3900;       // Telegram's limit is 4096 characters per message

function env(name: string): string { return (process.env[name] || '').trim(); }

function tgCreds(topic?: NotifyTopic): { token: string; chat: string } {
  const t = topic ? env(`TELEGRAM_BOT_TOKEN_${topic}`) : '';
  const c = topic ? env(`TELEGRAM_CHAT_ID_${topic}`) : '';
  return { token: t || env('TELEGRAM_BOT_TOKEN') || env('TELEGRAM_BOT_TOKEN_ALERTS'), chat: c || env('TELEGRAM_CHAT_ID') || env('TELEGRAM_CHAT_ID_ALERTS') };
}

/** Splits long text on line breaks into Telegram-sized pieces. Exported for tests. */
export function splitForTelegram(text: string, limit = TG_LIMIT): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    const piece = line.length > limit ? line.slice(0, limit - 1) + '…' : line;
    if (cur && cur.length + 1 + piece.length > limit) { out.push(cur); cur = piece; } else cur = cur ? `${cur}\n${piece}` : piece;
  }
  if (cur) out.push(cur);
  return out.length ? out : [''];
}

async function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try { return await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal }); }
  finally { clearTimeout(id); }
}

/** zzz1062 — the provider's own reason for a refusal (Telegram "description", Resend "message"), with any secret removed. */
export async function providerReason(r: Response, secrets: string[] = []): Promise<string> {
  let s = '';
  try {
    const t = await r.text();
    try { const j = JSON.parse(t); s = String(j?.description ?? j?.message ?? j?.error?.message ?? j?.error ?? t); } catch { s = t; }
  } catch { /* body unreadable */ }
  for (const x of secrets) if (x) s = s.split(x).join('***');
  return s.replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function sendTelegram(m: NotifyMessage): Promise<[ChannelState, string?]> {
  const { token, chat } = tgCreds(m.topic);
  if (!token || !chat) return ['skipped'];
  try {
    for (const part of splitForTelegram(`${m.subject}\n\n${m.text}`)) {
      const r = await post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text: part, disable_web_page_preview: true });
      if (!r.ok) { const why = await providerReason(r, [token]); return ['error', `telegram HTTP ${r.status}${why ? ` — ${why}` : ''}`]; }
    }
    return ['sent'];
  } catch (e: any) { return ['error', `telegram ${e?.name === 'AbortError' ? 'timeout' : 'failed'}`]; }
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
function htmlOf(m: NotifyMessage): string {
  return m.html || `<div style="font-family:system-ui,sans-serif;font-size:14px;white-space:pre-wrap">${escapeHtml(m.text)}</div>`;
}

async function sendEmail(m: NotifyMessage): Promise<[ChannelState, string?]> {
  const resend = env('RESEND_API_KEY');
  const to = env('NOTIFY_EMAIL_TO') || env('SMTP_TO');
  if (resend && to) {
    try {
      const r = await post('https://api.resend.com/emails', { from: env('NOTIFY_EMAIL_FROM') || 'Market Cockpit <onboarding@resend.dev>', to: to.split(',').map((s) => s.trim()).filter(Boolean), subject: m.subject.slice(0, 180), text: m.text, html: htmlOf(m) }, { Authorization: `Bearer ${resend}` });
      if (r.ok) return ['sent'];
      const why = await providerReason(r, [resend]);
      return ['error', `email HTTP ${r.status}${why ? ` — ${why}` : ''}`];
    } catch (e: any) { return ['error', `email ${e?.name === 'AbortError' ? 'timeout' : 'failed'}`]; }
  }
  const host = env('SMTP_HOST'), user = env('SMTP_USER'), pass = env('SMTP_PASS'), from = env('SMTP_FROM') || user;
  if (!host || !user || !pass || !to) return ['skipped'];
  try {
    const nodemailer: any = await import('nodemailer');
    const port = Number(env('SMTP_PORT') || 465);
    const tx = (nodemailer.default || nodemailer).createTransport({ host, port, secure: port === 465, auth: { user, pass }, connectionTimeout: TIMEOUT_MS, greetingTimeout: TIMEOUT_MS, socketTimeout: TIMEOUT_MS });
    await tx.sendMail({ from, to, subject: m.subject.slice(0, 180), text: m.text, html: htmlOf(m) });
    return ['sent'];
  } catch (e: any) { return ['error', `smtp send failed${e?.code ? ` (${String(e.code).slice(0, 40)})` : ''}`]; }
}

/** Which channels are set up (names only — never values). */
export function notifyChannels(topic?: NotifyTopic): { telegram: boolean; email: boolean } {
  const { token, chat } = tgCreds(topic);
  const emailTo = env('NOTIFY_EMAIL_TO') || env('SMTP_TO');
  return { telegram: !!(token && chat), email: !!emailTo && (!!env('RESEND_API_KEY') || !!(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'))) };
}

/** zzz1062 — which settings are present / missing, by NAME only (never values), so the page can say exactly what to fix. */
export function notifyDiagnosis(topic?: NotifyTopic): { telegram: { ready: boolean; missing: string[] }; email: { ready: boolean; via: 'resend' | 'smtp' | null; missing: string[]; toMasked: string | null } } {
  const { token, chat } = tgCreds(topic);
  const tgMissing = [!token ? 'TELEGRAM_BOT_TOKEN' : '', !chat ? 'TELEGRAM_CHAT_ID' : ''].filter(Boolean);
  const to = env('NOTIFY_EMAIL_TO') || env('SMTP_TO');
  const resend = !!env('RESEND_API_KEY');
  const smtp = !!(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'));
  const emMissing = [!to ? 'NOTIFY_EMAIL_TO' : '', !resend && !smtp ? 'RESEND_API_KEY' : ''].filter(Boolean);
  const first = to.split(',')[0]?.trim() || '';
  const toMasked = first ? first.replace(/^(.)(.*)(@.*)$/, (_m, a, b, c) => `${a}${'•'.repeat(Math.min(6, b.length))}${c}`) : null;
  return {
    telegram: { ready: tgMissing.length === 0, missing: tgMissing },
    email: { ready: emMissing.length === 0, via: !to ? null : resend ? 'resend' : smtp ? 'smtp' : null, missing: emMissing, toMasked },
  };
}

/** Sends on every configured channel. Never throws. */
export async function notifyOwner(m: NotifyMessage): Promise<NotifyResult> {
  const [[telegram, e1], [email, e2]] = await Promise.all([sendTelegram(m), sendEmail(m)]);
  return { telegram, email, errors: [e1, e2].filter((x): x is string => !!x) };
}

/** zzz1054 — send on the chosen channels only (price alerts let the owner pick Telegram and / or email). Never throws. */
export async function notifyOwnerVia(m: NotifyMessage, via: { telegram: boolean; email: boolean }): Promise<NotifyResult> {
  const [[telegram, e1], [email, e2]] = await Promise.all([
    via.telegram ? sendTelegram(m) : Promise.resolve<[ChannelState, string?]>(['skipped']),
    via.email ? sendEmail(m) : Promise.resolve<[ChannelState, string?]>(['skipped']),
  ]);
  return { telegram, email, errors: [e1, e2].filter((x): x is string => !!x) };
}

const ONCE_PREFIX = 'owner-notify:sent:v1';
/**
 * Sends only the first time this key is seen (kept 120 days). If no channel delivered, the key is released so the next run
 * tries again. Returns null when the key was already sent.
 */
export async function notifyOwnerOnce(key: string, m: NotifyMessage, ttlDays = 120): Promise<NotifyResult | null> {
  const k = `${ONCE_PREFIX}:${key}`;
  const fresh = await kvSetNX(k, new Date().toISOString(), Math.round(ttlDays * 86400)).catch(() => true);
  if (!fresh) return null;
  const r = await notifyOwner(m);
  if (r.telegram !== 'sent' && r.email !== 'sent') await kvDel(k).catch(() => undefined);
  return r;
}

/**
 * zzz911 — one message about several items, each item sent only once. Every key is reserved first (SET NX); `build`
 * gets only the keys this call reserved (another run may hold the rest) and returns the message, or null to send
 * nothing. If no channel delivered, the reserved keys are released so the next run tries again.
 * Returns null when there was nothing new.
 */
export async function notifyOwnerOnceMany(keys: readonly string[], build: (freshKeys: string[]) => NotifyMessage | null, ttlDays = 120): Promise<(NotifyResult & { keys: string[] }) | null> {
  const fresh: string[] = [];
  for (const key of keys) {
    const ok = await kvSetNX(`${ONCE_PREFIX}:${key}`, new Date().toISOString(), Math.round(ttlDays * 86400)).catch(() => true);
    if (ok) fresh.push(key);
  }
  if (!fresh.length) return null;
  const release = () => Promise.all(fresh.map((k) => kvDel(`${ONCE_PREFIX}:${k}`).catch(() => undefined)));
  const m = build(fresh);
  if (!m) { await release(); return null; }
  const r = await notifyOwner(m);
  if (r.telegram !== 'sent' && r.email !== 'sent') await release();
  return { ...r, keys: fresh };
}

/** Of the given keys, which have NOT been sent yet (does not reserve them). */
export async function unsentKeys(keys: readonly string[]): Promise<string[]> {
  if (!keys.length) return [];
  const { kvMGet } = await import('@/lib/kv');
  const got = await kvMGet<string>(keys.map((k) => `${ONCE_PREFIX}:${k}`)).catch(() => keys.map(() => null));
  return keys.filter((_, i) => !got[i]);
}

/**
 * zzz912 — one message for several "send once" keys (one ranked alert for several companies, keyed per company).
 * Reserves every key not sent yet; `build` gets the keys reserved by THIS call and returns the message (or null to send
 * nothing). If nothing was delivered, the reserved keys are released so the next run tries again.
 * Returns null when every key was already sent (or `build` returned null).
 */
export async function notifyOwnerOnceEach(
  keys: readonly string[],
  build: (freshKeys: string[]) => NotifyMessage | null,
  ttlDays = 120,
): Promise<{ result: NotifyResult; keys: string[] } | null> {
  const fresh: string[] = [];
  for (const key of Array.from(new Set(keys))) {
    const ok = await kvSetNX(`${ONCE_PREFIX}:${key}`, new Date().toISOString(), Math.round(ttlDays * 86400)).catch(() => true);
    if (ok) fresh.push(key);
  }
  if (!fresh.length) return null;
  const release = async () => { for (const k of fresh) await kvDel(`${ONCE_PREFIX}:${k}`).catch(() => undefined); };
  const m = build(fresh);
  if (!m) { await release(); return null; }
  const result = await notifyOwner(m);
  if (result.telegram !== 'sent' && result.email !== 'sent') await release();
  return { result, keys: fresh };
}
