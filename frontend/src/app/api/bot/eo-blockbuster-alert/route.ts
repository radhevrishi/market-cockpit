// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0521 — EO BLOCKBUSTER + STRONG → Telegram Channel
//
// Sends top-tier earnings cards (BLOCKBUSTER + STRONG) to a Telegram channel
// (MC Street Pulse). Runs 3× daily via Vercel Cron:
//   • 11:00 IST (05:30 UTC) — pre-market scan
//   • 14:00 IST (08:30 UTC) — mid-session refresh
//   • 21:00 IST (15:30 UTC) — post-close summary
//
// Data: reads from /api/v1/earnings/graded for today + yesterday and filters
// to BLOCKBUSTER + STRONG tiers only. KV-deduped so the same ticker is sent
// at most once per 48h regardless of how many crons fire.
//
// Setup (env vars in Vercel — REQUIRED, no hardcoded fallbacks):
//   • TELEGRAM_BOT_TOKEN_EARNINGS or TELEGRAM_BOT_TOKEN — bot token
//   • TELEGRAM_CHAT_ID_BLOCKBUSTER or TELEGRAM_CHAT_ID_EARNINGS or
//     TELEGRAM_CHAT_ID — destination chat ID
//     (numeric like -1001234567890 for private supergroup, or @handle
//     for a public channel)
//   • CRON_SECRET — auth gate; Vercel cron header also accepted
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from 'next/server';
import { kvGet, kvSet, isRedisAvailable } from '@/lib/kv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BOT_TOKEN =
  process.env.TELEGRAM_BOT_TOKEN_EARNINGS ||
  process.env.TELEGRAM_BOT_TOKEN ||
  '';

// CHAT_ID for the broadcast channel — must be set in Vercel env.
// No hardcoded personal-chat fallback (security hygiene).
const CHAT_ID =
  process.env.TELEGRAM_CHAT_ID_BLOCKBUSTER ||
  process.env.TELEGRAM_CHAT_ID_EARNINGS ||
  process.env.TELEGRAM_CHAT_ID ||
  '';

const API_BASE = 'https://market-cockpit.vercel.app';
const DEDUP_TTL_S = 48 * 60 * 60; // 48h — covers all 3 daily cron firings + next day

// ─── Types (mirror /api/v1/earnings/graded shape) ──────────────────────────

interface GradedCard {
  ticker: string;
  company: string;
  filing_date: string;
  quarter?: string;
  sector?: string;
  market_cap_bucket?: string;
  pe?: number | null;
  price?: number | null;
  sales_yoy_pct?: number | null;
  net_profit_yoy_pct?: number | null;
  eps_yoy_pct?: number | null;
  sales_curr_cr?: number | null;
  sales_prev_cr?: number | null;
  pat_curr_cr?: number | null;
  pat_prev_cr?: number | null;
  eps_curr?: number | null;
  eps_prev?: number | null;
  move_pct?: number | null;
  gap_pct?: number | null;
  d1_pct?: number | null;
  stage?: number | null;
  rs_rating?: number | null;
  composite_score: number;
  tier: 'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID';
  methodology_tags?: string[];
  caveat_tags?: string[];
  narrative?: string;
}

interface GradedResponse {
  filing_date: string;
  by_tier: Record<'BLOCKBUSTER' | 'STRONG' | 'MIXED' | 'AVOID', GradedCard[]>;
  candidates_total: number;
}

// ─── Formatters ────────────────────────────────────────────────────────────

function pctStr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

function crStr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 10000) return `₹${(v / 1000).toFixed(1)}K Cr`;
  return `₹${v.toFixed(0)} Cr`;
}

function epsStr(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `₹${v.toFixed(2)}`;
}

// HTML escape — Telegram HTML mode only needs <, >, & escaped.
// Much more robust than MarkdownV2 (which trips on every period in a %).
function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatCard(card: GradedCard): string {
  const tierEmoji = card.tier === 'BLOCKBUSTER' ? '⭐' : '🟢';
  const tierLabel = card.tier === 'BLOCKBUSTER' ? '<b>BLOCKBUSTER</b>' : '<b>STRONG</b>';
  const sectorBit = card.sector ? ` · ${escHtml(card.sector)}` : '';
  const mcapBit = card.market_cap_bucket ? ` · ${escHtml(card.market_cap_bucket)}` : '';
  const peBit = card.pe != null ? ` · PE ${card.pe.toFixed(1)}` : '';
  const priceBit = card.price != null ? ` · ₹${card.price.toFixed(0)}` : '';

  const lines: string[] = [];
  lines.push(`${tierEmoji} ${tierLabel} · <b>${escHtml(card.ticker)}</b>`);
  lines.push(`<i>${escHtml(card.company || card.ticker)}</i>`);
  lines.push(`${escHtml(card.quarter || 'Q4')}${mcapBit}${sectorBit}${peBit}${priceBit}`);
  lines.push('');

  if (card.sales_yoy_pct != null) {
    lines.push(
      `📊 Sales ${pctStr(card.sales_yoy_pct)} · ${escHtml(crStr(card.sales_curr_cr))} vs ${escHtml(crStr(card.sales_prev_cr))}`
    );
  }
  if (card.net_profit_yoy_pct != null) {
    lines.push(
      `💰 PAT ${pctStr(card.net_profit_yoy_pct)} · ${escHtml(crStr(card.pat_curr_cr))} vs ${escHtml(crStr(card.pat_prev_cr))}`
    );
  }
  if (card.eps_yoy_pct != null) {
    lines.push(
      `📈 EPS ${pctStr(card.eps_yoy_pct)} · ${escHtml(epsStr(card.eps_curr))} vs ${escHtml(epsStr(card.eps_prev))}`
    );
  }

  lines.push('');
  const scoreBit = `Score <b>${card.composite_score}</b>`;
  const moveBit = card.move_pct != null ? ` · Move ${pctStr(card.move_pct)}` : '';
  const gapBit = card.gap_pct != null ? ` · Gap ${pctStr(card.gap_pct)}` : '';
  const stageBit = card.stage != null ? ` · Stage ${card.stage}` : '';
  const rsBit = card.rs_rating != null ? ` · RS ${card.rs_rating}` : '';
  lines.push(`${scoreBit}${moveBit}${gapBit}${stageBit}${rsBit}`);

  if (card.methodology_tags && card.methodology_tags.length) {
    lines.push(`✓ ${card.methodology_tags.map(escHtml).join(' ✓ ')}`);
  }
  if (card.caveat_tags && card.caveat_tags.length) {
    lines.push(`⚠ ${card.caveat_tags.slice(0, 4).map(escHtml).join(' ⚠ ')}`);
  }

  // Filing date + EO deeplink
  const eoUrl = `${API_BASE}/earnings-opportunities?date=${card.filing_date}`;
  lines.push('');
  lines.push(`📅 Filed: ${escHtml(card.filing_date)}`);
  lines.push(`🌐 <a href="${escHtml(eoUrl)}">Open in EO</a>`);

  return lines.join('\n');
}

// ─── Telegram sender ───────────────────────────────────────────────────────

async function sendTelegram(
  text: string,
  targetChatId?: string,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  if (!BOT_TOKEN) return { ok: false, error: 'TELEGRAM_BOT_TOKEN_EARNINGS not set' };
  const chatId = targetChatId || CHAT_ID;
  if (!chatId) return { ok: false, error: 'TELEGRAM_CHAT_ID_BLOCKBUSTER not set' };

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: body.slice(0, 200) };
    }
    return { ok: true, status: 200 };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const provided = searchParams.get('secret') || '';
  const expected = process.env.CRON_SECRET || '';
  const vercelHeader = req.headers.get('x-vercel-cron') || req.headers.get('x-vercel-signature') || '';

  if (!vercelHeader && expected && provided !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Compute today + yesterday in IST so 'last 2 days' aligns with the
  // user's expectation (Indian filing calendar).
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const todayIst = istNow.toISOString().slice(0, 10);
  const yIst = new Date(istNow.getTime() - 86_400_000).toISOString().slice(0, 10);
  const dates = [todayIst, yIst];

  // Allow caller-override for backfill: ?dates=2026-05-19,2026-05-18
  const datesParam = searchParams.get('dates');
  const targetDates = datesParam ? datesParam.split(',').map((s) => s.trim()).filter(Boolean) : dates;

  // Allow tier override: ?tiers=BLOCKBUSTER (default: BLOCKBUSTER + STRONG)
  const tiersParam = searchParams.get('tiers');
  const tiersFilter = tiersParam
    ? new Set(tiersParam.split(',').map((s) => s.trim().toUpperCase()))
    : new Set(['BLOCKBUSTER', 'STRONG']);

  const origin = new URL(req.url).origin;
  const dryRun = searchParams.get('dry') === '1';
  // override_chat_id routes responses to a specific chat (e.g. webhook DM)
  // instead of the default broadcast channel. When set, also implies
  // force=1 (skip dedup) since on-demand pulls should always show data.
  const overrideChatId = searchParams.get('override_chat_id') || '';
  const targetChatId = overrideChatId || CHAT_ID;
  const force = searchParams.get('force') === '1' || !!overrideChatId; // bypass dedup

  // Fetch graded for each date
  const allCards: GradedCard[] = [];
  for (const date of targetDates) {
    try {
      const res = await fetch(`${origin}/api/v1/earnings/graded?date=${date}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) continue;
      const data: GradedResponse = await res.json();
      for (const t of ['BLOCKBUSTER', 'STRONG', 'MIXED', 'AVOID'] as const) {
        if (!tiersFilter.has(t)) continue;
        const cards = data.by_tier?.[t] || [];
        for (const c of cards) {
          allCards.push({ ...c, filing_date: c.filing_date || date });
        }
      }
    } catch {}
  }

  // Dedup against KV — skip cards already sent within DEDUP_TTL_S
  const toSend: GradedCard[] = [];
  const skipped: string[] = [];
  for (const card of allCards) {
    if (!card.ticker || !card.filing_date) continue;
    const dedupKey = `tg:sent:eo:${card.ticker}:${card.filing_date}`;
    if (!force && isRedisAvailable()) {
      try {
        const seen = await kvGet(dedupKey);
        if (seen) { skipped.push(card.ticker); continue; }
      } catch {}
    }
    toSend.push(card);
  }

  // Sort: BLOCKBUSTER first, then by composite score descending
  toSend.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier === 'BLOCKBUSTER' ? -1 : 1;
    return b.composite_score - a.composite_score;
  });

  // Send one message per card, with light rate-limiting (Telegram allows
  // ~30 messages/sec to bots but channels prefer slower). 300ms between
  // = ~3/sec — safe.
  const sentTickers: string[] = [];
  const failed: Array<{ ticker: string; error: string }> = [];
  let sentCount = 0;

  if (!dryRun) {
    // Pre-flight: send a header message if there's anything to broadcast
    if (toSend.length > 0) {
      const headerLines = overrideChatId
        ? [
            `🔥 <b>EARNINGS PULSE — ON-DEMAND</b>`,
            `<i>${escHtml(String(toSend.length))} cards across last 2 days</i>`,
            `<i>Filed: ${escHtml(targetDates.join(', '))}</i>`,
          ]
        : [
            `🔥 <b>EARNINGS PULSE — TOP TIER</b>`,
            `<i>${escHtml(String(toSend.length))} new fresh prints across last 2 days</i>`,
            `<i>Filed: ${escHtml(targetDates.join(', '))}</i>`,
          ];
      await sendTelegram(headerLines.join('\n'), targetChatId);
      await new Promise((r) => setTimeout(r, 400));
    } else if (overrideChatId) {
      // On-demand pulls deserve a clear empty-state message
      await sendTelegram(
        `📭 <i>No ${escHtml(Array.from(tiersFilter).join(' / '))} cards found for ${escHtml(targetDates.join(', '))}</i>`,
        targetChatId,
      );
    }

    for (const card of toSend) {
      const text = formatCard(card);
      const result = await sendTelegram(text, targetChatId);
      if (result.ok) {
        sentCount++;
        sentTickers.push(card.ticker);
        // Mark as sent in KV — only for default broadcast channel, not
        // on-demand pulls (those shouldn't burn the dedup budget).
        if (!overrideChatId && isRedisAvailable()) {
          try {
            const dedupKey = `tg:sent:eo:${card.ticker}:${card.filing_date}`;
            await kvSet(dedupKey, { sent_at: new Date().toISOString(), tier: card.tier }, DEDUP_TTL_S);
          } catch {}
        }
      } else {
        failed.push({ ticker: card.ticker, error: result.error || `HTTP ${result.status}` });
      }
      // Rate-limit between sends
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  return NextResponse.json({
    status: 'ok',
    dates: targetDates,
    bot_configured: !!BOT_TOKEN,
    chat_id: targetChatId,
    override_chat_id: overrideChatId || null,
    cards_found: allCards.length,
    cards_to_send: toSend.length,
    cards_skipped: skipped.length,
    cards_sent: sentCount,
    failures: failed,
    dry_run: dryRun,
    force: force,
    completed_at: new Date().toISOString(),
  });
}
