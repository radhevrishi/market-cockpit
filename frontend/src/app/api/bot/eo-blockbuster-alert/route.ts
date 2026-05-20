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

function pctStr(v: number | null | undefined, decimals = 1): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(decimals)}%`;
}

// Compact percent for table cells: no decimal, sign always shown
function pctCompact(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '   —';
  const rounded = Math.round(v);
  const sign = rounded >= 0 ? '+' : '';
  return `${sign}${rounded}%`;
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

// Institutional padding: right-pad a label so values align in monospace
function rpad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

// Visual score bar — 10-block bar based on score / 100
function scoreBar(score: number): string {
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const filled = Math.round(pct * 10);
  return '█'.repeat(filled) + '░'.repeat(10 - filled);
}

function formatCard(card: GradedCard, rank?: number, total?: number): string {
  const tierEmoji = card.tier === 'BLOCKBUSTER' ? '⭐' : '🟢';
  const tierLabel = card.tier === 'BLOCKBUSTER' ? 'BLOCKBUSTER' : 'STRONG';
  const rankBit = rank && total ? `  ·  #${rank}/${total}` : '';
  const dividerThick = '━━━━━━━━━━━━━━━━━━━━━━━';
  const dividerThin = '─────────────────────';

  const lines: string[] = [];

  // ═════ HEADER — tier + ticker + score visual ═════
  lines.push(`${tierEmoji} <b>${tierLabel}</b>  ·  Score <b>${card.composite_score}</b>/100${rankBit}`);
  lines.push(`<code>${scoreBar(card.composite_score)}</code>`);
  lines.push(dividerThick);
  lines.push(`<b>${escHtml(card.ticker)}</b>  ·  <i>${escHtml(card.company || card.ticker)}</i>`);

  // ═════ META row — sector · mcap · price · PE ═════
  const metaBits: string[] = [];
  if (card.sector) metaBits.push(escHtml(card.sector));
  if (card.market_cap_bucket) metaBits.push(escHtml(card.market_cap_bucket));
  if (card.price != null) metaBits.push(`₹${card.price.toFixed(0)}`);
  if (card.pe != null) metaBits.push(`PE ${card.pe.toFixed(1)}x`);
  if (metaBits.length) lines.push(metaBits.join('  ·  '));
  lines.push('');

  // ═════ QUARTERLY YoY — aligned in <pre> for monospace tabular look ═════
  const hasSales = card.sales_yoy_pct != null;
  const hasPat = card.net_profit_yoy_pct != null;
  const hasEps = card.eps_yoy_pct != null;
  if (hasSales || hasPat || hasEps) {
    lines.push(`<b>📊 QUARTERLY (YoY)</b>`);
    const qLines: string[] = [];
    if (hasSales) {
      qLines.push(
        `${rpad('Sales', 7)}${rpad(pctStr(card.sales_yoy_pct), 9)}${crStr(card.sales_curr_cr)} ← ${crStr(card.sales_prev_cr)}`
      );
    }
    if (hasPat) {
      qLines.push(
        `${rpad('PAT', 7)}${rpad(pctStr(card.net_profit_yoy_pct), 9)}${crStr(card.pat_curr_cr)} ← ${crStr(card.pat_prev_cr)}`
      );
    }
    if (hasEps) {
      qLines.push(
        `${rpad('EPS', 7)}${rpad(pctStr(card.eps_yoy_pct), 9)}${epsStr(card.eps_curr)} ← ${epsStr(card.eps_prev)}`
      );
    }
    lines.push(`<pre>${escHtml(qLines.join('\n'))}</pre>`);
  }

  // ═════ MARGIN / OPERATING quality (if present in card payload) ═════
  // Not always populated; show only if meaningful
  // (Future enhancement: opm, op_profit_yoy)

  // ═════ POST-EARNINGS price action ═════
  if (card.move_pct != null || card.d1_pct != null || card.gap_pct != null) {
    lines.push(`<b>📈 POST-EARNINGS</b>`);
    const pBits: string[] = [];
    if (card.move_pct != null) pBits.push(`Cum ${pctStr(card.move_pct)}`);
    if (card.d1_pct != null) pBits.push(`D1 ${pctStr(card.d1_pct)}`);
    if (card.gap_pct != null) pBits.push(`Gap ${pctStr(card.gap_pct)}`);
    if (card.stage != null) pBits.push(`Stage ${card.stage}`);
    if (card.rs_rating != null) pBits.push(`RS ${card.rs_rating}`);
    lines.push(pBits.join('  ·  '));
  }

  // ═════ METHODOLOGY (why it qualified) ═════
  if (card.methodology_tags && card.methodology_tags.length) {
    lines.push(`<b>✅ METHODOLOGY</b>`);
    lines.push(card.methodology_tags.map((t) => `  ✓ ${escHtml(t)}`).join('\n'));
  }

  // ═════ CAVEATS (risk flags) ═════
  if (card.caveat_tags && card.caveat_tags.length) {
    lines.push(`<b>⚠️ RISK FLAGS</b>`);
    lines.push(card.caveat_tags.slice(0, 5).map((t) => `  ⚠ ${escHtml(t)}`).join('\n'));
  }

  // ═════ ACTION line — filing date + deep link ═════
  const eoUrl = `${API_BASE}/earnings-opportunities?date=${card.filing_date}`;
  lines.push(dividerThin);
  const quarter = card.quarter ? ` · ${escHtml(card.quarter)}` : '';
  lines.push(`📅 Filed <b>${escHtml(card.filing_date)}</b>${quarter}`);
  lines.push(`🔗 <a href="${escHtml(eoUrl)}">Open card in EO →</a>`);

  return lines.join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// SUMMARY VIEW — one consolidated message combining BLOCKBUSTER + STRONG.
// Compact institutional snapshot for a date window. Sent as a single
// Telegram message (no per-card spam).
// ═══════════════════════════════════════════════════════════════════════════

function formatSummary(cards: GradedCard[], dates: string[]): string {
  const bb = cards
    .filter((c) => c.tier === 'BLOCKBUSTER')
    .sort((a, b) => b.composite_score - a.composite_score);
  const strong = cards
    .filter((c) => c.tier === 'STRONG')
    .sort((a, b) => b.composite_score - a.composite_score);

  const windowLabel =
    dates.length === 1 ? dates[0] : `LAST ${dates.length} DAYS`;
  const dateRange =
    dates.length > 1 ? `${dates[dates.length - 1]} → ${dates[0]}` : dates[0];

  const lines: string[] = [];

  // ═════ HEADER STRIP ═════
  lines.push(`📊 <b>EARNINGS PULSE — SUMMARY</b>`);
  lines.push(`<i>${escHtml(windowLabel)}  ·  ${escHtml(dateRange)}</i>`);
  lines.push(`━━━━━━━━━━━━━━━━━━━━━━━`);
  lines.push(
    `Total <b>${cards.length}</b>  ·  ⭐ <b>${bb.length}</b> BB  ·  🟢 <b>${strong.length}</b> STRONG`,
  );

  // Tablet header for both lists
  const tableHeader = `  #  TICKER       SCR  SALES   PAT     MOVE`;

  // ═════ BLOCKBUSTER table ═════
  if (bb.length > 0) {
    lines.push('');
    lines.push(`<b>⭐ BLOCKBUSTER (${bb.length})</b>`);
    const rows = [tableHeader];
    for (let i = 0; i < Math.min(bb.length, 15); i++) {
      const c = bb[i];
      const rank = rpad(`${i + 1}.`, 3);
      const ticker = rpad(c.ticker.slice(0, 12), 12);
      const score = rpad(String(c.composite_score), 4);
      const sales = rpad(pctCompact(c.sales_yoy_pct), 7);
      const pat = rpad(pctCompact(c.net_profit_yoy_pct), 7);
      const move = c.move_pct != null ? pctCompact(c.move_pct) : '   —';
      rows.push(` ${rank} ${ticker} ${score} ${sales} ${pat} ${move}`);
    }
    if (bb.length > 15) rows.push(`  … +${bb.length - 15} more`);
    lines.push(`<pre>${escHtml(rows.join('\n'))}</pre>`);
  }

  // ═════ STRONG table ═════
  if (strong.length > 0) {
    lines.push('');
    lines.push(`<b>🟢 STRONG (${strong.length})</b>`);
    const rows = [tableHeader];
    for (let i = 0; i < Math.min(strong.length, 20); i++) {
      const c = strong[i];
      const rank = rpad(`${i + 1}.`, 3);
      const ticker = rpad(c.ticker.slice(0, 12), 12);
      const score = rpad(String(c.composite_score), 4);
      const sales = rpad(pctCompact(c.sales_yoy_pct), 7);
      const pat = rpad(pctCompact(c.net_profit_yoy_pct), 7);
      const move = c.move_pct != null ? pctCompact(c.move_pct) : '   —';
      rows.push(` ${rank} ${ticker} ${score} ${sales} ${pat} ${move}`);
    }
    if (strong.length > 20) rows.push(`  … +${strong.length - 20} more`);
    lines.push(`<pre>${escHtml(rows.join('\n'))}</pre>`);
  }

  // ═════ TOP MOVERS (post-earnings cumulative) ═════
  const withMoves = cards
    .filter((c) => c.move_pct != null && Number.isFinite(c.move_pct))
    .sort((a, b) => (b.move_pct as number) - (a.move_pct as number));
  if (withMoves.length > 0) {
    const upMovers = withMoves.slice(0, 5);
    const downMovers = withMoves.slice(-3).reverse().filter((c) => (c.move_pct as number) < 0);

    lines.push('');
    lines.push(`<b>📈 TOP MOVERS — since filing</b>`);
    if (upMovers.length > 0) {
      const upLine = upMovers
        .map((c, i) => `${i + 1}. ${escHtml(c.ticker)} ${pctCompact(c.move_pct)}`)
        .join('  ·  ');
      lines.push(`▲ ${upLine}`);
    }
    if (downMovers.length > 0) {
      const dnLine = downMovers
        .map((c, i) => `${i + 1}. ${escHtml(c.ticker)} ${pctCompact(c.move_pct)}`)
        .join('  ·  ');
      lines.push(`▼ ${dnLine}`);
    }
  }

  // ═════ SECTOR BREAKDOWN ═════
  const sectorMap: Record<string, number> = {};
  for (const c of cards) {
    const s = c.sector || 'Other';
    sectorMap[s] = (sectorMap[s] || 0) + 1;
  }
  const sectors = Object.entries(sectorMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  if (sectors.length > 0) {
    lines.push('');
    lines.push(`<b>🏢 SECTOR MIX</b>`);
    lines.push(
      sectors.map(([s, n]) => `${escHtml(s)} <b>${n}</b>`).join('  ·  '),
    );
  }

  // ═════ AVERAGE METRICS ═════
  if (cards.length > 0) {
    const meanOf = (arr: (number | null | undefined)[]): number | null => {
      const valid = arr.filter((v): v is number => v != null && Number.isFinite(v));
      if (valid.length === 0) return null;
      return valid.reduce((a, b) => a + b, 0) / valid.length;
    };
    const avgSales = meanOf(cards.map((c) => c.sales_yoy_pct));
    const avgPat = meanOf(cards.map((c) => c.net_profit_yoy_pct));
    const avgScore = meanOf(cards.map((c) => c.composite_score));
    const avgMove = meanOf(cards.map((c) => c.move_pct ?? null));
    if (avgSales != null || avgPat != null || avgScore != null) {
      lines.push('');
      lines.push(`<b>📊 COHORT AVERAGES</b>`);
      const bits: string[] = [];
      if (avgScore != null) bits.push(`Score ${avgScore.toFixed(0)}`);
      if (avgSales != null) bits.push(`Sales ${pctStr(avgSales, 0)}`);
      if (avgPat != null) bits.push(`PAT ${pctStr(avgPat, 0)}`);
      if (avgMove != null) bits.push(`Move ${pctStr(avgMove, 1)}`);
      lines.push(bits.join('  ·  '));
    }
  }

  // ═════ FOOTER ═════
  lines.push('');
  lines.push(`─────────────────────`);
  lines.push(`<i>Switch scope: /summary2 · /summary3 · /summary7</i>`);
  lines.push(
    `<i>🔗 <a href="${escHtml(API_BASE)}/earnings-opportunities">Full EO Dashboard →</a></i>`,
  );

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

  // Compute trailing N days in IST so 'last N days' aligns with the
  // user's expectation (Indian filing calendar). Default = 2.
  // ?days=3 → today + yesterday + day-before
  const daysParam = parseInt(searchParams.get('days') || '2', 10);
  const days = Number.isFinite(daysParam) && daysParam >= 1 && daysParam <= 14 ? daysParam : 2;
  const istNow = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(istNow.getTime() - i * 86_400_000);
    dates.push(d.toISOString().slice(0, 10));
  }

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

  // Compute window label like "last 3 days" or "1 day"
  const windowLabel = targetDates.length === 1
    ? `${escHtml(targetDates[0])}`
    : `last ${targetDates.length} days`;

  // ═════ SUMMARY MODE — one consolidated card, no per-stock spam ═════
  const renderMode = (searchParams.get('mode') || 'cards').toLowerCase();
  if (renderMode === 'summary' && !dryRun) {
    if (allCards.length === 0) {
      await sendTelegram(
        `📭 <i>No BLOCKBUSTER / STRONG cards for ${escHtml(windowLabel)}</i>`,
        targetChatId,
      );
    } else {
      // Summary uses ALL cards (no dedup) — it's a snapshot not a feed
      const sumText = formatSummary(allCards, targetDates);
      const sumResult = await sendTelegram(sumText, targetChatId);
      if (sumResult.ok) sentCount = 1;
      else failed.push({ ticker: 'SUMMARY', error: sumResult.error || 'unknown' });
    }
    return NextResponse.json({
      status: 'ok',
      mode: 'summary',
      window_days: targetDates.length,
      dates: targetDates,
      bot_configured: !!BOT_TOKEN,
      chat_id: targetChatId,
      override_chat_id: overrideChatId || null,
      cards_found: allCards.length,
      cards_sent: sentCount,
      failures: failed,
      completed_at: new Date().toISOString(),
    });
  }

  if (!dryRun) {
    // Pre-flight: send a header message if there's anything to broadcast
    if (toSend.length > 0) {
      // Compute tier breakdown for the header strip
      const bbCount = toSend.filter((c) => c.tier === 'BLOCKBUSTER').length;
      const strongCount = toSend.filter((c) => c.tier === 'STRONG').length;
      const tierStrip: string[] = [];
      if (bbCount > 0) tierStrip.push(`⭐ ${bbCount} BLOCKBUSTER`);
      if (strongCount > 0) tierStrip.push(`🟢 ${strongCount} STRONG`);

      const istHHMM = new Date(Date.now() + 5.5 * 60 * 60 * 1000)
        .toISOString().slice(11, 16) + ' IST';
      const titlePrefix = overrideChatId ? 'ON-DEMAND' : 'DAILY BROADCAST';

      const headerLines = [
        `🔥 <b>EARNINGS PULSE — ${titlePrefix}</b>`,
        `<i>${tierStrip.join('  ·  ')}  ·  ${windowLabel}</i>`,
        `<i>Filed: ${escHtml(targetDates.join(', '))}  ·  ${istHHMM}</i>`,
      ];
      await sendTelegram(headerLines.join('\n'), targetChatId);
      await new Promise((r) => setTimeout(r, 400));
    } else if (overrideChatId) {
      // On-demand pulls deserve a clear empty-state message
      await sendTelegram(
        `📭 <i>No ${escHtml(Array.from(tiersFilter).join(' / '))} cards found for ${escHtml(windowLabel)}</i>\n\n<i>Filed scope: ${escHtml(targetDates.join(', '))}</i>`,
        targetChatId,
      );
    }

    for (let i = 0; i < toSend.length; i++) {
      const card = toSend[i];
      const text = formatCard(card, i + 1, toSend.length);
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

    // ═════ Final summary message — institutional close-out ═════
    if (sentCount > 0) {
      const dashboardUrl = `${API_BASE}/earnings-opportunities`;
      const summary = [
        `<b>═══ SCAN COMPLETE ═══</b>`,
        `<b>${sentCount}</b> top-tier ${sentCount === 1 ? 'card' : 'cards'} delivered`,
        `Window: ${escHtml(windowLabel)}`,
        ``,
        `<i>Use /menu for more options · /last3 for 3-day scope</i>`,
        `<i>🔗 <a href="${escHtml(dashboardUrl)}">Full EO dashboard →</a></i>`,
      ];
      await sendTelegram(summary.join('\n'), targetChatId);
    }
  }

  return NextResponse.json({
    status: 'ok',
    window_days: targetDates.length,
    dates: targetDates,
    bot_configured: !!BOT_TOKEN,
    chat_id: targetChatId,
    override_chat_id: overrideChatId || null,
    cards_found: allCards.length,
    cards_to_send: toSend.length,
    cards_skipped: skipped.length,
    cards_sent: sentCount,
    sent_tickers: sentTickers,
    failures: failed,
    dry_run: dryRun,
    force: force,
    completed_at: new Date().toISOString(),
  });
}
