// PATCH 0726 — Alert dispatcher infrastructure (Slack / SMTP / webhook).
//
// Reads env vars at call time and routes an AlertPayload to up to three
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
    // Dynamic import so the build doesn't fail when the dep is absent.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nodemailer = require('nodemailer');
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
// PUBLIC API
// ────────────────────────────────────────────────────────────────────────
export async function dispatchAlert(payload: AlertPayload): Promise<DispatchResult> {
  const errors: Record<string, string> = {};

  const settle = async (
    name: 'slack' | 'email' | 'webhook',
    fn: () => Promise<'sent' | 'skipped' | 'error'>,
  ): Promise<'sent' | 'skipped' | 'error'> => {
    try {
      return await fn();
    } catch (e: any) {
      errors[name] = String(e?.message || e).slice(0, 300);
      return 'error';
    }
  };

  const [slack, email, webhook] = await Promise.all([
    settle('slack', () => dispatchSlack(payload)),
    settle('email', () => dispatchEmail(payload)),
    settle('webhook', () => dispatchWebhook(payload)),
  ]);

  const result: DispatchResult = { slack, email, webhook };
  if (Object.keys(errors).length > 0) result.errors = errors;
  return result;
}
