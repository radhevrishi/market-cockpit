// PATCH 1058 — Alert dispatcher infrastructure (Slack / SMTP / webhook / Telegram).
//
// Reads env vars at call time and routes an AlertPayload to up to four
// channels. Each channel independently:
//   - returns 'skipped' when its env vars are missing (no log noise),
//   - returns 'sent' on success,
//   - returns 'error' on failure (with errors[channel] = msg).
//
// Env vars consumed:
//   SLACK_WEBHOOK_URL                          - Slack incoming webhook URL
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
//   SMTP_FROM, SMTP_TO                         - SMTP relay (needs nodemailer
//                                                installed; gracefully skips
//                                                when the dep is missing)
//   GENERIC_WEBHOOK_URL                        - POST raw AlertPayload JSON
//   TELEGRAM_BOT_TOKEN (or TELEGRAM_BOT_TOKEN_ALERTS / _EARNINGS) +
//   TELEGRAM_CHAT_ID (or TELEGRAM_CHAT_ID_ALERTS / _EARNINGS) - Telegram Bot API
//
// Each channel call uses an 8s AbortController timeout so a stuck endpoint
// never wedges the dispatcher.

export interface AlertPayload {
  rule: { id: string; name: string };
  article: {
    title?: string;
    url?: string;
    source?: string;
    published_at?: string;
    ticker_symbols?: string[];
    importance_score?: number;
  };
  triggeredAt: string; // ISO
}

export interface DispatchResult {
  slack: 'sent' | 'skipped' | 'error';
  email: 'sent' | 'skipped' | 'error';
  webhook: 'sent' | 'skipped' | 'error';
  telegram: 'sent' | 'skipped' | 'error';
  errors?: Record<string, string>;
}

const CHANNEL_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(id); resolve(v); },
      (e) => { clearTimeout(id); reject(e); },
    );
  });
}

// ────────────────────────────────────────────────────────────────────────
// SLACK
// ────────────────────────────────────────────────────────────────────────
async function dispatchSlack(
  payload: AlertPayload,
): Promise<'sent' | 'skipped' | 'error'> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return 'skipped';

  const { rule, article } = payload;
  const title = article.title || '(no title)';
  const articleUrl = article.url || '';
  const contextLine = [article.source || 'unknown source', article.published_at || '']
    .filter(Boolean).join(' · ');

  const body = {
    text: `🚨 ${rule.name}: ${title}`,
    blocks: [
      { type: 'header', text: { type: 'plain_text', text: `🚨 ${rule.name}` } },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${title}*${articleUrl ? `\n${articleUrl}` : ''}`,
        },
      },
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `Source: ${contextLine}` }],
      },
    ],
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), CHANNEL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`slack ${res.status}: ${txt.slice(0, 200)}`);
    }
    return 'sent';
  } finally {
    clearTimeout(id);
  }
}

// ────────────────────────────────────────────────────────────────────────
// SMTP (nodemailer if installed; skip otherwise)
// ────────────────────────────────────────────────────────────────────────
async function dispatchEmail(
  payload: AlertPayload,
): Promise<'sent' | 'skipped' | 'error'> {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM, SMTP_TO } = process.env;
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM || !SMTP_TO) {
    return 'skipped';
  }

  let nodemailer: any;
  try {
    // Webpack-opaque require so the bundler does NOT try to resolve nodemailer
    // at build time. The package is genuinely optional — user installs it only
    // when they wire up SMTP. Without this trick, `require('nodemailer')` is
    // statically analysed by Next/webpack and the build fails with "Module not
    // found: Can't resolve 'nodemailer'" even though the call is inside try/catch.
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-eval
    const dynamicRequire: NodeRequire = eval('require');
    nodemailer = dynamicRequire('nodemailer');
  } catch {
    // Don't add nodemailer as a dependency — user can install it. Until
    // then this channel is a no-op even when SMTP env vars are set.
    console.warn('[alert-dispatcher] email channel needs nodemailer install (npm i nodemailer); skipping');
    return 'skipped';
  }

  const { rule, article } = payload;
  const title = article.title || '(no title)';
  const subject = `[Market Cockpit] ${rule.name}: ${title}`.slice(0, 180);
  const lines: string[] = [
    `Rule: ${rule.name}`,
    `Triggered: ${payload.triggeredAt}`,
    '',
    `Title: ${title}`,
    article.url ? `URL: ${article.url}` : '',
    article.source ? `Source: ${article.source}` : '',
    article.published_at ? `Published: ${article.published_at}` : '',
    typeof article.importance_score === 'number' ? `Importance: ${article.importance_score}` : '',
    article.ticker_symbols?.length ? `Tickers: ${article.ticker_symbols.join(', ')}` : '',
  ].filter(Boolean);
  const text = lines.join('\n');
  const html = `<div style="font-family:system-ui,sans-serif;font-size:13px">
    <h2 style="margin:0 0 8px 0">🚨 ${rule.name}</h2>
    <p style="margin:0 0 8px 0;font-size:15px;font-weight:600">${title}</p>
    ${article.url ? `<p style="margin:0 0 8px 0"><a href="${article.url}">${article.url}</a></p>` : ''}
    <p style="margin:8px 0;color:#555;font-size:12px">
      ${[article.source, article.published_at].filter(Boolean).join(' · ')}
    </p>
    ${article.ticker_symbols?.length ? `<p style="margin:8px 0;font-family:monospace">${article.ticker_symbols.join(', ')}</p>` : ''}
  </div>`;

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await withTimeout(
    transporter.sendMail({
      from: SMTP_FROM,
      to: SMTP_TO,
      subject,
      text,
      html,
    }),
    CHANNEL_TIMEOUT_MS,
    'smtp',
  );
  return 'sent';
}

// ────────────────────────────────────────────────────────────────────────
// GENERIC WEBHOOK
// ────────────────────────────────────────────────────────────────────────
async function dispatchWebhook(
  payload: AlertPayload,
): Promise<'sent' | 'skipped' | 'error'> {
  const url = process.env.GENERIC_WEBHOOK_URL;
  if (!url) return 'skipped';

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), CHANNEL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`webhook ${res.status}: ${txt.slice(0, 200)}`);
    }
    return 'sent';
  } finally {
    clearTimeout(id);
  }
}

// ────────────────────────────────────────────────────────────────────────
// TELEGRAM (PATCH 1058 — added in HANDOFF4)
// ────────────────────────────────────────────────────────────────────────
// Resolves token + chat from the same env-var fallbacks the per-channel
// bot routes use, so this dispatcher works out of the box if you've
// already configured TELEGRAM_BOT_TOKEN_EARNINGS or TELEGRAM_BOT_TOKEN
// for the existing /api/bot/* endpoints.
//
// Precedence (first non-empty wins):
//   token:  TELEGRAM_BOT_TOKEN_ALERTS → TELEGRAM_BOT_TOKEN_EARNINGS → TELEGRAM_BOT_TOKEN
//   chat:   TELEGRAM_CHAT_ID_ALERTS  → TELEGRAM_CHAT_ID_EARNINGS  → TELEGRAM_CHAT_ID
//
// Message uses MarkdownV2 with all reserved chars escaped (Telegram rejects
// unescaped `_`, `*`, `[`, `]`, `(`, `)`, `~`, `` ` ``, `>`, `#`, `+`, `-`,
// `=`, `|`, `{`, `}`, `.`, `!`).
function escapeMdV2(s: string): string {
  return s.replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, (m) => `\\${m}`);
}

async function dispatchTelegram(
  payload: AlertPayload,
): Promise<'sent' | 'skipped' | 'error'> {
  const token =
    process.env.TELEGRAM_BOT_TOKEN_ALERTS ||
    process.env.TELEGRAM_BOT_TOKEN_EARNINGS ||
    process.env.TELEGRAM_BOT_TOKEN ||
    '';
  const chat =
    process.env.TELEGRAM_CHAT_ID_ALERTS ||
    process.env.TELEGRAM_CHAT_ID_EARNINGS ||
    process.env.TELEGRAM_CHAT_ID ||
    '';
  if (!token || !chat) return 'skipped';

  const { rule, article } = payload;
  const title = article.title || '(no title)';
  const sourceLine = [article.source, article.published_at].filter(Boolean).join(' · ');
  const tickerLine = article.ticker_symbols?.length
    ? article.ticker_symbols.join(', ')
    : '';
  const importance =
    typeof article.importance_score === 'number'
      ? String(article.importance_score)
      : '';

  // Build MarkdownV2 message body. Each user-supplied string is escaped;
  // formatting characters (`*`, `_`, link syntax) are written raw outside
  // the escaped runs.
  const lines: string[] = [];
  lines.push(`🚨 *${escapeMdV2(rule.name)}*`);
  lines.push('');
  lines.push(`*${escapeMdV2(title)}*`);
  if (article.url) {
    // Inline link: [text](url) — escape link text but keep URL raw (Telegram
    // only requires `)` and `\` to be escaped inside link URLs).
    const linkText = escapeMdV2(article.source || 'open article');
    const safeUrl = article.url.replace(/[)\\]/g, (m) => `\\${m}`);
    lines.push(`[${linkText}](${safeUrl})`);
  }
  if (sourceLine) lines.push(`_${escapeMdV2(sourceLine)}_`);
  if (tickerLine) lines.push(`\`${escapeMdV2(tickerLine)}\``);
  if (importance) lines.push(`Importance: *${escapeMdV2(importance)}*`);
  lines.push('');
  lines.push(`_triggered ${escapeMdV2(payload.triggeredAt)}_`);
  const text = lines.join('\n').slice(0, 4000); // Telegram caps at 4096

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const body = {
    chat_id: chat,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: false,
  };

  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), CHANNEL_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`telegram ${res.status}: ${txt.slice(0, 200)}`);
    }
    // Telegram returns { ok: true, result: {...} } even on 200; fail closed
    // if ok=false.
    const j: any = await res.json().catch(() => ({}));
    if (j && j.ok === false) {
      throw new Error(`telegram ok=false: ${String(j.description || '').slice(0, 200)}`);
    }
    return 'sent';
  } finally {
    clearTimeout(id);
  }
}

// ────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ────────────────────────────────────────────────────────────────────────
export async function dispatchAlert(payload: AlertPayload): Promise<DispatchResult> {
  const errors: Record<string, string> = {};

  const settle = async (
    name: 'slack' | 'email' | 'webhook' | 'telegram',
    fn: () => Promise<'sent' | 'skipped' | 'error'>,
  ): Promise<'sent' | 'skipped' | 'error'> => {
    try {
      return await fn();
    } catch (e: any) {
      errors[name] = String(e?.message || e).slice(0, 300);
      return 'error';
    }
  };

  const [slack, email, webhook, telegram] = await Promise.all([
    settle('slack', () => dispatchSlack(payload)),
    settle('email', () => dispatchEmail(payload)),
    settle('webhook', () => dispatchWebhook(payload)),
    settle('telegram', () => dispatchTelegram(payload)),
  ]);

  const result: DispatchResult = { slack, email, webhook, telegram };
  if (Object.keys(errors).length > 0) result.errors = errors;
  return result;
}
