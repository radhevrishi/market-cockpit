import { NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ══════════════════════════════════════════════
// EARNINGS ALERT BOT — Telegram Image Cards
// Sends earnings results as formatted image cards
// ══════════════════════════════════════════════

const BOT_TOKEN = '8681784264:AAG7OV3ibS4r89Lbrta50NkWnJSCTrtoS80';
const API_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://market-cockpit.vercel.app';

// Chat IDs for different channels
const WATCHLIST_CHAT_ID = '5057319640'; // User's watchlist chat
const INDEX_CHAT_ID = '5057319640';     // Index earnings (same user for now)

// Dedup: track sent earnings
const sentEarnings = new Set<string>();

// ══════════════════════════════════════════════
// GENERATE EARNINGS IMAGE CARD
// ══════════════════════════════════════════════

interface CardData {
  symbol: string;
  company: string;
  resultDate: string;
  quarter: string;
  reportType: string;
  revenueYoY: number | null;
  revenueQoQ: number | null;
  opProfitYoY: number | null;
  opProfitQoQ: number | null;
  patYoY: number | null;
  patQoQ: number | null;
  epsYoY: number | null;
  epsQoQ: number | null;
  revenue: number;
  operatingProfit: number;
  opm: number;
  pat: number;
  npm: number;
  eps: number;
  mcap: number | null;
  pe: number | null;
  grade: string;
  gradeColor: string;
  signalScore: number;
}

function fmtNum(n: number): string {
  if (n === 0) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n.toFixed(1);
}

function pctStr(val: number | null): string {
  if (val === null || val === undefined) return '—';
  return `${val > 0 ? '+' : ''}${val.toFixed(1)}%`;
}

function pctColor(val: number | null): string {
  if (val === null) return '#8899AA';
  if (val > 0) return '#00C853';
  if (val < 0) return '#F44336';
  return '#FFD600';
}

async function generateEarningsImage(card: CardData): Promise<ArrayBuffer> {
  const rows = [
    { label: 'Revenue Cr', yoy: card.revenueYoY, qoq: card.revenueQoQ, val: card.revenue },
    { label: 'Op. Profit Cr', yoy: card.opProfitYoY, qoq: card.opProfitQoQ, val: card.operatingProfit },
    { label: 'OPM %', yoy: null, qoq: null, val: card.opm, isPercent: true },
    { label: 'PAT Cr', yoy: card.patYoY, qoq: card.patQoQ, val: card.pat },
    { label: 'NPM %', yoy: null, qoq: null, val: card.npm, isPercent: true },
    { label: 'EPS ₹', yoy: card.epsYoY, qoq: card.epsQoQ, val: card.eps },
  ];

  const gradeEmoji = card.grade === 'STRONG' ? '🟢' : card.grade === 'GOOD' ? '🟢' : card.grade === 'OK' ? '🟡' : '🔴';

  const img = new ImageResponse(
    (
      <div style={{
        display: 'flex', flexDirection: 'column', width: '600px',
        background: '#0D1623', color: '#E8ECF1', fontFamily: 'system-ui',
        borderRadius: '12px', overflow: 'hidden',
        border: `2px solid ${card.gradeColor}`,
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '16px 20px', borderBottom: '1px solid #1A2540',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '18px', fontWeight: 700 }}>{card.company}</span>
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700,
                background: `${card.gradeColor}25`, color: card.gradeColor,
                border: `1px solid ${card.gradeColor}60`,
              }}>{gradeEmoji} {card.grade}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
              <span style={{
                padding: '1px 6px', borderRadius: '3px', fontSize: '11px',
                background: '#0F7ABF20', color: '#0F7ABF',
              }}>{card.reportType}</span>
              <span style={{ fontSize: '11px', color: '#8899AA' }}>{card.quarter}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: '13px', color: '#8899AA' }}>{card.resultDate}</span>
            <span style={{ fontSize: '11px', color: '#0F7ABF' }}>Score: {card.signalScore}/100</span>
          </div>
        </div>

        {/* Table header */}
        <div style={{
          display: 'flex', padding: '8px 20px', background: '#0A1628',
          fontSize: '11px', color: '#8899AA', fontWeight: 500,
        }}>
          <span style={{ flex: '1' }}></span>
          <span style={{ width: '80px', textAlign: 'right' }}>YoY</span>
          <span style={{ width: '80px', textAlign: 'right' }}>QoQ</span>
          <span style={{ width: '80px', textAlign: 'right' }}>Value</span>
        </div>

        {/* Rows */}
        {rows.map((row, i) => (
          <div key={i} style={{
            display: 'flex', padding: '8px 20px', alignItems: 'center',
            borderTop: '1px solid #1A2540',
            background: i % 2 === 0 ? 'transparent' : '#0A162810',
          }}>
            <span style={{ flex: '1', fontSize: '13px', fontWeight: 500 }}>{row.label}</span>
            <span style={{
              width: '80px', textAlign: 'right', fontSize: '13px', fontWeight: 600,
              color: pctColor(row.yoy),
            }}>
              {pctStr(row.yoy)}
            </span>
            <span style={{
              width: '80px', textAlign: 'right', fontSize: '13px', fontWeight: 600,
              color: pctColor(row.qoq),
            }}>
              {pctStr(row.qoq)}
            </span>
            <span style={{
              width: '80px', textAlign: 'right', fontSize: '13px', fontWeight: 600,
              color: '#E8ECF1',
            }}>
              {row.isPercent ? `${row.val.toFixed(1)}%` : fmtNum(row.val)}
            </span>
          </div>
        ))}

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', padding: '10px 20px',
          borderTop: '1px solid #1A2540', background: '#0A1628',
          fontSize: '11px', color: '#8899AA',
        }}>
          <span>Market Cockpit</span>
          <div style={{ display: 'flex', gap: '16px' }}>
            {card.mcap && <span>MCap: ₹{card.mcap.toLocaleString('en-IN')} Cr</span>}
            {card.pe && <span>PE: {card.pe}</span>}
          </div>
        </div>
      </div>
    ),
    { width: 600, height: 340 }
  );

  return img.arrayBuffer();
}

// ══════════════════════════════════════════════
// SEND TO TELEGRAM
// ══════════════════════════════════════════════

async function sendTelegramPhoto(chatId: string, imageBuffer: ArrayBuffer, caption: string) {
  const formData = new FormData();
  formData.append('chat_id', chatId);
  formData.append('photo', new Blob([imageBuffer], { type: 'image/png' }), 'earnings.png');
  formData.append('caption', caption);
  formData.append('parse_mode', 'HTML');

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
    method: 'POST',
    body: formData,
  });
  return res.json();
}

async function sendTelegramText(chatId: string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  return res.json();
}

// ══════════════════════════════════════════════
// FORMAT TEXT ALERT (fallback for image failures)
// ══════════════════════════════════════════════

function formatEarningsText(card: CardData): string {
  const gradeEmoji = card.grade === 'STRONG' ? '🟢' : card.grade === 'GOOD' ? '🟢' : card.grade === 'OK' ? '🟡' : '🔴';
  const p = (v: number | null) => v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

  return `<b>${card.company} – ${card.quarter}</b>

Revenue: ${p(card.revenueYoY)} YoY | ${p(card.revenueQoQ)} QoQ
Op. Profit: ${p(card.opProfitYoY)} YoY | ${p(card.opProfitQoQ)} QoQ
PAT: ${p(card.patYoY)} YoY | ${p(card.patQoQ)} QoQ
EPS: ${p(card.epsYoY)} YoY | ${p(card.epsQoQ)} QoQ

OPM: ${card.opm.toFixed(1)}% | NPM: ${card.npm.toFixed(1)}%
${card.mcap ? `MCap: ₹${card.mcap.toLocaleString('en-IN')} Cr` : ''}${card.pe ? ` | PE: ${card.pe}` : ''}

Grade: ${gradeEmoji} <b>${card.grade}</b> (Score: ${card.signalScore}/100)`;
}

// ══════════════════════════════════════════════
// CRON HANDLER — Fetch earnings and send alerts
// ══════════════════════════════════════════════

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const forceSymbol = searchParams.get('symbol');
  const testMode = searchParams.get('test') === 'true';

  // Security check
  if (secret !== 'mc-bot-2026' && !testMode) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch earnings cards from our API
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const res = await fetch(`${API_BASE}/api/market/earnings-cards?month=${monthStr}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch earnings', status: res.status });
    }

    const data = await res.json();
    const cards = data.cards || [];

    if (cards.length === 0) {
      return NextResponse.json({ status: 'no_earnings', message: 'No earnings data available' });
    }

    // Get user watchlist
    let watchlistSymbols = new Set<string>();
    try {
      const wlRes = await fetch(`${API_BASE}/api/watchlist?chatId=${WATCHLIST_CHAT_ID}`);
      if (wlRes.ok) {
        const wlData = await wlRes.json();
        watchlistSymbols = new Set((wlData.watchlist || []).map((s: string) => s.toUpperCase()));
      }
    } catch {}

    const sent: string[] = [];
    const failed: string[] = [];

    for (const card of cards) {
      // Filter: only send if not already sent
      const dedupKey = `${card.symbol}-${card.quarter}-${card.resultDate}`;
      if (sentEarnings.has(dedupKey) && !testMode) continue;

      // Filter: only send for specific symbol if requested
      if (forceSymbol && card.symbol !== forceSymbol.toUpperCase()) continue;

      // Determine which channel
      const isWatchlist = watchlistSymbols.has(card.symbol);

      // Only send if grade is STRONG/GOOD or it's a watchlist stock, or test mode
      if (!testMode && !isWatchlist && card.grade !== 'STRONG' && card.grade !== 'GOOD') continue;

      // Build card data for image
      const cardData: CardData = {
        symbol: card.symbol,
        company: card.company,
        resultDate: card.resultDate,
        quarter: card.quarter,
        reportType: card.reportType || 'Standalone',
        revenueYoY: card.revenueYoY,
        revenueQoQ: card.revenueQoQ,
        opProfitYoY: card.opProfitYoY,
        opProfitQoQ: card.opProfitQoQ,
        patYoY: card.patYoY,
        patQoQ: card.patQoQ,
        epsYoY: card.epsYoY,
        epsQoQ: card.epsQoQ,
        revenue: card.current?.revenue || 0,
        operatingProfit: card.current?.operatingProfit || 0,
        opm: card.current?.opm || 0,
        pat: card.current?.pat || 0,
        npm: card.current?.npm || 0,
        eps: card.current?.eps || 0,
        mcap: card.mcap,
        pe: card.pe,
        grade: card.grade,
        gradeColor: card.gradeColor,
        signalScore: card.signalScore,
      };

      const chatId = isWatchlist ? WATCHLIST_CHAT_ID : INDEX_CHAT_ID;
      const prefix = isWatchlist ? '⭐ WATCHLIST EARNINGS' : '📊 INDEX EARNINGS';
      const caption = `${prefix}\n\n${formatEarningsText(cardData)}\n\n🔗 market-cockpit.vercel.app/earnings`;

      try {
        // Try image card first
        const imageBuffer = await generateEarningsImage(cardData);
        const result = await sendTelegramPhoto(chatId, imageBuffer, caption);

        if (result.ok) {
          sentEarnings.add(dedupKey);
          sent.push(card.symbol);
        } else {
          // Fallback to text
          const textResult = await sendTelegramText(chatId, caption);
          if (textResult.ok) {
            sentEarnings.add(dedupKey);
            sent.push(`${card.symbol}(text)`);
          } else {
            failed.push(card.symbol);
          }
        }
      } catch (err) {
        // Fallback to text on image generation error
        try {
          const textResult = await sendTelegramText(chatId, caption);
          if (textResult.ok) {
            sentEarnings.add(dedupKey);
            sent.push(`${card.symbol}(text)`);
          } else {
            failed.push(card.symbol);
          }
        } catch {
          failed.push(card.symbol);
        }
      }

      // Rate limit: 100ms between sends
      await new Promise(r => setTimeout(r, 100));
    }

    return NextResponse.json({
      status: 'ok',
      totalCards: cards.length,
      sent: sent.length,
      sentSymbols: sent,
      failed: failed.length,
      failedSymbols: failed,
      watchlistSize: watchlistSymbols.size,
    });

  } catch (error) {
    console.error('[Earnings Alert] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ══════════════════════════════════════════════
// IMAGE CARD ENDPOINT — Generate standalone image
// ══════════════════════════════════════════════

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { card } = body;

    if (!card) {
      return NextResponse.json({ error: 'No card data provided' }, { status: 400 });
    }

    const imageBuffer = await generateEarningsImage(card);

    return new Response(imageBuffer, {
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (error) {
    console.error('[Earnings Image] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
