import { NextResponse } from 'next/server';
import { ImageResponse } from 'next/og';

export const dynamic = 'force-dynamic';
export const maxDuration = 55;

// ══════════════════════════════════════════════
// EARNINGS ALERT BOT — Telegram Image Cards
// SINGLE SOURCE OF TRUTH: Consumes /api/market/earnings-cards (same as UI)
// Never uses a different data pipeline than the earnings page.
// ══════════════════════════════════════════════

const BOT_TOKEN = '8681784264:AAG7OV3ibS4r89Lbrta50NkWnJSCTrtoS80';
const API_BASE = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://market-cockpit.vercel.app';

const WATCHLIST_CHAT_ID = '5057319640';
const INDEX_CHAT_ID = '5057319640';

const sentEarnings = new Set<string>();

// ── Types (must match /api/market/earnings-cards v4 schema) ──

type DataQuality = 'FULL' | 'PARTIAL' | 'NONE';

interface CardFromAPI {
  symbol: string;
  company: string;
  period: string;
  resultDate: string;
  reportType: string;
  sector: string;
  marketCap: string;
  qualityScore: number;
  grade: 'STRONG' | 'GOOD' | 'OK' | 'BAD';
  gradeColor: string;
  price: {
    cmp: number;
    prevClose: number | null;
    changePct: number;
    excessReturn: number | null;
    indexReturn: number | null;
  };
  financials: {
    revenue: number | null;
    operatingProfit: number | null;
    opm: number | null;
    pat: number | null;
    npm: number | null;
    eps: number | null;
    revenueYoY: number | null;
    opProfitYoY: number | null;
    patYoY: number | null;
    epsYoY: number | null;
    revenueQoQ: number | null;
    opProfitQoQ: number | null;
    patQoQ: number | null;
    epsQoQ: number | null;
  };
  dataQuality: DataQuality;
  mcap: number | null;
  pe: number | null;
  resultLink: string | null;
  nseLink: string;
  source: string;
}

// ══════════════════════════════════════════════
// GENERATE EARNINGS IMAGE CARD
// ══════════════════════════════════════════════

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

function fmtNum(n: number | null): string {
  if (n === null || n === 0) return '—';
  if (Math.abs(n) >= 1000) return n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return n.toFixed(1);
}

const DATA_QUALITY_LABEL: Record<DataQuality, { emoji: string; text: string }> = {
  FULL: { emoji: '🟢', text: 'Full Data' },
  PARTIAL: { emoji: '🟡', text: 'Partial' },
  NONE: { emoji: '🔴', text: 'Price Only' },
};

async function generateEarningsImage(card: CardFromAPI): Promise<ArrayBuffer> {
  const hasFin = card.dataQuality !== 'NONE';
  const fin = card.financials;
  const dq = DATA_QUALITY_LABEL[card.dataQuality];
  const gradeEmoji = card.grade === 'STRONG' ? '🟢' : card.grade === 'GOOD' ? '🟢' : card.grade === 'OK' ? '🟡' : '🔴';
  const exRet = card.price.excessReturn;

  // Build rows for the financial table
  const rows = hasFin ? [
    { label: 'Revenue Cr', yoy: fin.revenueYoY, qoq: fin.revenueQoQ, val: fin.revenue },
    { label: 'Op. Profit Cr', yoy: fin.opProfitYoY, qoq: fin.opProfitQoQ, val: fin.operatingProfit },
    { label: 'OPM %', yoy: null, qoq: null, val: fin.opm, isPercent: true },
    { label: 'PAT Cr', yoy: fin.patYoY, qoq: fin.patQoQ, val: fin.pat },
    { label: 'NPM %', yoy: null, qoq: null, val: fin.npm, isPercent: true },
    { label: 'EPS ₹', yoy: fin.epsYoY, qoq: fin.epsQoQ, val: fin.eps },
  ] : null;

  const cardHeight = hasFin ? 340 : 240;

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
          padding: '14px 20px', borderBottom: '1px solid #1A2540',
        }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '17px', fontWeight: 700 }}>{card.company}</span>
              <span style={{
                padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700,
                background: `${card.gradeColor}25`, color: card.gradeColor,
                border: `1px solid ${card.gradeColor}60`,
              }}>{gradeEmoji} {card.grade}</span>
              <span style={{
                padding: '2px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 600,
                background: card.dataQuality === 'FULL' ? '#00C85315' : card.dataQuality === 'PARTIAL' ? '#FFD60015' : '#F4433615',
                color: card.dataQuality === 'FULL' ? '#00C853' : card.dataQuality === 'PARTIAL' ? '#FFD600' : '#F44336',
              }}>{dq.emoji} {dq.text}</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', marginTop: '4px', alignItems: 'center' }}>
              <span style={{
                padding: '1px 6px', borderRadius: '3px', fontSize: '11px',
                background: '#0F7ABF20', color: '#0F7ABF',
              }}>{card.reportType}</span>
              <span style={{ fontSize: '11px', color: '#8899AA' }}>{card.period}</span>
              {exRet !== null && (
                <span style={{
                  padding: '1px 6px', borderRadius: '3px', fontSize: '10px',
                  background: exRet > 0 ? '#00C85315' : exRet < 0 ? '#F4433615' : '#FFD60015',
                  color: exRet > 0 ? '#00C853' : exRet < 0 ? '#F44336' : '#FFD600',
                }}>vs Nifty: {exRet > 0 ? '+' : ''}{exRet.toFixed(1)}%</span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <span style={{ fontSize: '13px', color: '#8899AA' }}>{card.resultDate}</span>
            <span style={{ fontSize: '11px', color: '#0F7ABF' }}>Score: {card.qualityScore}/100</span>
          </div>
        </div>

        {/* Financial Table (when available) */}
        {rows && (
          <>
            <div style={{
              display: 'flex', padding: '8px 20px', background: '#0A1628',
              fontSize: '11px', color: '#8899AA', fontWeight: 500,
            }}>
              <span style={{ flex: '1' }}></span>
              <span style={{ width: '80px', textAlign: 'right' }}>YoY</span>
              <span style={{ width: '80px', textAlign: 'right' }}>QoQ</span>
              <span style={{ width: '80px', textAlign: 'right' }}>Value</span>
            </div>
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
                }}>{pctStr(row.yoy)}</span>
                <span style={{
                  width: '80px', textAlign: 'right', fontSize: '13px', fontWeight: 600,
                  color: pctColor(row.qoq),
                }}>{pctStr(row.qoq)}</span>
                <span style={{
                  width: '80px', textAlign: 'right', fontSize: '13px', fontWeight: 600,
                  color: '#E8ECF1',
                }}>
                  {row.isPercent
                    ? (row.val !== null ? `${row.val.toFixed(1)}%` : '—')
                    : fmtNum(row.val)}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Price Reaction (when no financials) */}
        {!rows && (
          <div style={{
            display: 'flex', padding: '16px 20px', gap: '12px',
          }}>
            <div style={{
              flex: 1, background: '#0A1628', borderRadius: '8px', padding: '12px',
              border: '1px solid #1A2540', textAlign: 'center',
            }}>
              <div style={{ fontSize: '11px', color: '#8899AA', marginBottom: '4px' }}>Price Move</div>
              <div style={{
                fontSize: '22px', fontWeight: 700,
                color: card.price.changePct > 0 ? '#00C853' : card.price.changePct < 0 ? '#F44336' : '#E8ECF1',
              }}>{card.price.changePct > 0 ? '+' : ''}{card.price.changePct.toFixed(1)}%</div>
            </div>
            <div style={{
              flex: 1, background: '#0A1628', borderRadius: '8px', padding: '12px',
              border: '1px solid #1A2540', textAlign: 'center',
            }}>
              <div style={{ fontSize: '11px', color: '#8899AA', marginBottom: '4px' }}>vs Nifty 50</div>
              <div style={{
                fontSize: '22px', fontWeight: 700,
                color: (exRet ?? 0) > 0 ? '#00C853' : (exRet ?? 0) < 0 ? '#F44336' : '#E8ECF1',
              }}>{(exRet ?? 0) > 0 ? '+' : ''}{(exRet ?? 0).toFixed(1)}%</div>
            </div>
            <div style={{
              flex: 1, background: '#0A1628', borderRadius: '8px', padding: '12px',
              border: '1px solid #1A2540', textAlign: 'center',
            }}>
              <div style={{ fontSize: '11px', color: '#8899AA', marginBottom: '4px' }}>CMP</div>
              <div style={{ fontSize: '20px', fontWeight: 700, color: '#E8ECF1' }}>
                ₹{card.price.cmp.toLocaleString('en-IN')}
              </div>
            </div>
          </div>
        )}

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
    { width: 600, height: cardHeight }
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
// FORMAT TEXT ALERT (fallback + same data pipeline)
// ══════════════════════════════════════════════

function formatEarningsText(card: CardFromAPI): string {
  const gradeEmoji = card.grade === 'STRONG' ? '🟢' : card.grade === 'GOOD' ? '🟢' : card.grade === 'OK' ? '🟡' : '🔴';
  const dq = DATA_QUALITY_LABEL[card.dataQuality];
  const p = (v: number | null) => v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const fin = card.financials;
  const exRet = card.price.excessReturn;

  let text = `<b>${card.company} – ${card.period}</b>\n`;
  text += `${dq.emoji} ${dq.text}\n\n`;

  if (card.dataQuality !== 'NONE') {
    text += `Revenue: ${p(fin.revenueYoY)} YoY | ${p(fin.revenueQoQ)} QoQ\n`;
    text += `Op. Profit: ${p(fin.opProfitYoY)} YoY | ${p(fin.opProfitQoQ)} QoQ\n`;
    text += `PAT: ${p(fin.patYoY)} YoY | ${p(fin.patQoQ)} QoQ\n`;
    text += `EPS: ${p(fin.epsYoY)} YoY | ${p(fin.epsQoQ)} QoQ\n`;
    if (fin.opm !== null) text += `\nOPM: ${fin.opm.toFixed(1)}%`;
    if (fin.npm !== null) text += ` | NPM: ${fin.npm.toFixed(1)}%`;
    text += '\n';
  } else {
    text += `Price Move: ${p(card.price.changePct)}\n`;
    if (exRet !== null) text += `vs Nifty 50: ${p(exRet)}\n`;
    text += `CMP: ₹${card.price.cmp.toLocaleString('en-IN')}\n`;
  }

  if (card.mcap) text += `\nMCap: ₹${card.mcap.toLocaleString('en-IN')} Cr`;
  if (card.pe) text += ` | PE: ${card.pe}`;

  text += `\n\nGrade: ${gradeEmoji} <b>${card.grade}</b> (Score: ${card.qualityScore}/100)`;

  return text;
}

// ══════════════════════════════════════════════
// CRON HANDLER — Fetch from SAME pipeline as UI
// ══════════════════════════════════════════════

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const secret = searchParams.get('secret');
  const forceSymbol = searchParams.get('symbol');
  const testMode = searchParams.get('test') === 'true';

  if (secret !== 'mc-bot-2026' && !testMode) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch from the SAME canonical pipeline the UI uses
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const res = await fetch(`${API_BASE}/api/market/earnings-cards?month=${monthStr}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch earnings', status: res.status });
    }

    const data = await res.json();
    const cards: CardFromAPI[] = data.cards || [];

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
      const dedupKey = `${card.symbol}-${card.period}-${card.resultDate}`;
      if (sentEarnings.has(dedupKey) && !testMode) continue;
      if (forceSymbol && card.symbol !== forceSymbol.toUpperCase()) continue;

      const isWatchlist = watchlistSymbols.has(card.symbol);

      // Only send if grade is STRONG/GOOD or it's a watchlist stock, or test mode
      if (!testMode && !isWatchlist && card.grade !== 'STRONG' && card.grade !== 'GOOD') continue;

      const chatId = isWatchlist ? WATCHLIST_CHAT_ID : INDEX_CHAT_ID;
      const prefix = isWatchlist ? '⭐ WATCHLIST EARNINGS' : '📊 INDEX EARNINGS';
      const caption = `${prefix}\n\n${formatEarningsText(card)}\n\n🔗 market-cockpit.vercel.app/earnings`;

      try {
        const imageBuffer = await generateEarningsImage(card);
        const result = await sendTelegramPhoto(chatId, imageBuffer, caption);

        if (result.ok) {
          sentEarnings.add(dedupKey);
          sent.push(card.symbol);
        } else {
          const textResult = await sendTelegramText(chatId, caption);
          if (textResult.ok) {
            sentEarnings.add(dedupKey);
            sent.push(`${card.symbol}(text)`);
          } else {
            failed.push(card.symbol);
          }
        }
      } catch (err) {
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
      schemaVersion: 2,
    });

  } catch (error) {
    console.error('[Earnings Alert] Error:', error);
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

// ══════════════════════════════════════════════
// IMAGE CARD ENDPOINT — Generate standalone image
// Accepts a card object matching the canonical schema
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
