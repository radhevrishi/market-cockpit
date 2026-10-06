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

async function sendTelegram(m: NotifyMessage): Promise<[ChannelState, string?]> {
  const { token, chat } = tgCreds(m.topic);
  if (!token || !chat) return ['skipped'];
  try {
    for (const part of splitForTelegram(`${m.subject}\n\n${m.text}`)) {
      const r = await post(`https://api.telegram.org/bot${token}/sendMessage`, { chat_id: chat, text: part, disable_web_page_preview: true });
      if (!r.ok) return ['error', `telegram HTTP ${r.status}`];
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
      return r.ok ? ['sent'] : ['error', `email HTTP ${r.status}`];
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
  } catch { return ['error', 'smtp send failed']; }
}

/** Which channels are set up (names only — never values). */
export function notifyChannels(topic?: NotifyTopic): { telegram: boolean; email: boolean } {
  const { token, chat } = tgCreds(topic);
  const emailTo = env('NOTIFY_EMAIL_TO') || env('SMTP_TO');
  return { telegram: !!(token && chat), email: !!emailTo && (!!env('RESEND_API_KEY') || !!(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'))) };
}

/** Sends on every configured channel. Never throws. */
export async function notifyOwner(m: NotifyMessage): Promise<NotifyResult> {
  const [[telegram, e1], [email, e2]] = await Promise.all([sendTelegram(m), sendEmail(m)]);
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

/** Of the given keys, which have NOT been sent yet (does not reserve them). */
export async function unsentKeys(keys: readonly string[]): Promise<string[]> {
  if (!keys.length) return [];
  const { kvMGet } = await import('@/lib/kv');
  const got = await kvMGet<string>(keys.map((k) => `${ONCE_PREFIX}:${k}`)).catch(() => keys.map(() => null));
  return keys.filter((_, i) => !got[i]);
}
