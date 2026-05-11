#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// scrape-nse-earnings.mjs — patch 0133
//
// Run by GitHub Actions every 30 min during IST market hours.  Fetches
// NSE corporate-financial-results endpoint with proper session + headers
// (defeats most Akamai checks because GH-runner IPs rotate and look
// browser-like).  Pushes parsed payload to Upstash KV — Vercel reads
// from there.
//
// Env vars required (set as GitHub Action secrets):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
//
// Node 20+ has built-in fetch; no external deps needed.
// ═══════════════════════════════════════════════════════════════════════════

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!KV_URL || !KV_TOKEN) {
  console.error('ERROR: UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must be set');
  process.exit(1);
}

// Realistic browser headers — NSE checks these
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const COMMON_HEADERS = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
};

// ─── Cookie jar utility ────────────────────────────────────────────────────
class CookieJar {
  constructor() { this.cookies = new Map(); }
  ingest(setCookieHeader) {
    if (!setCookieHeader) return;
    const lines = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
    for (const line of lines) {
      const [pair] = line.split(';');
      const eq = pair.indexOf('=');
      if (eq < 0) continue;
      const k = pair.slice(0, eq).trim();
      const v = pair.slice(eq + 1).trim();
      this.cookies.set(k, v);
    }
  }
  header() {
    return Array.from(this.cookies.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

// ─── NSE session warmup ────────────────────────────────────────────────────
async function warmupSession(jar) {
  console.log('[warmup] hitting nseindia.com/get-quotes/equity to seed cookies…');
  // Home page first
  let res = await fetch('https://www.nseindia.com/', {
    headers: {
      ...COMMON_HEADERS,
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Dest': 'document',
    },
  });
  jar.ingest(res.headers.getSetCookie?.() || res.headers.get('set-cookie'));
  // Quote page (richer cookies)
  res = await fetch('https://www.nseindia.com/get-quotes/equity?symbol=TCS', {
    headers: { ...COMMON_HEADERS, Cookie: jar.header(), Referer: 'https://www.nseindia.com/' },
  });
  jar.ingest(res.headers.getSetCookie?.() || res.headers.get('set-cookie'));
  // Results comparison page
  res = await fetch('https://www.nseindia.com/companies-listing/corporate-filings-financial-results', {
    headers: { ...COMMON_HEADERS, Cookie: jar.header(), Referer: 'https://www.nseindia.com/' },
  });
  jar.ingest(res.headers.getSetCookie?.() || res.headers.get('set-cookie'));
  console.log(`[warmup] cookies seeded: ${jar.cookies.size}`);
}

// ─── Fetch NSE financial-results window ────────────────────────────────────
async function fetchNseResults(jar, fromDate, toDate) {
  // Period choices on NSE: Quarterly, Half-Yearly, Annual.  We want all.
  const periods = ['Quarterly', 'Annual', 'Half-Yearly'];
  const out = [];
  for (const period of periods) {
    const url = `https://www.nseindia.com/api/corporates-financial-results?index=equities&period=${encodeURIComponent(period)}&from_date=${fromDate}&to_date=${toDate}`;
    console.log(`[fetch] ${period} ${fromDate} → ${toDate}`);
    try {
      const res = await fetch(url, {
        headers: {
          ...COMMON_HEADERS,
          Cookie: jar.header(),
          Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-financial-results',
        },
      });
      if (!res.ok) {
        console.warn(`[fetch] ${period} → HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      let json;
      try { json = JSON.parse(text); }
      catch (e) {
        console.warn(`[fetch] ${period} → non-JSON response: ${text.slice(0, 200)}`);
        continue;
      }
      // NSE shape: { data: [...] }  OR  Array directly
      const items = Array.isArray(json) ? json : (json.data || []);
      console.log(`[fetch] ${period} → ${items.length} items`);
      for (const it of items) out.push({ ...it, _period: period });
    } catch (e) {
      console.warn(`[fetch] ${period} failed: ${e.message}`);
    }
    await sleep(800);
  }
  return out;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ─── Normalize NSE response → canonical schema ─────────────────────────────
function normalise(raw) {
  // NSE returns fields like:
  //   symbol, companyName, financial_period, broadcast_date_time,
  //   filing_status, attachment, period_ended, audited, consolidated
  const out = [];
  for (const r of raw) {
    const symbol = String(r.symbol || r.SYMBOL || '').trim().toUpperCase();
    if (!symbol) continue;
    const company = String(r.companyName || r.COMPANY_NAME || r.company || symbol).trim();
    const broadcastRaw = String(r.broadcast_date_time || r.BROADCAST_DATE || r.broadcastDateTime || '').trim();
    const periodEnded = String(r.period_ended || r.periodEnded || r.PERIOD_ENDED || '').trim();
    // Parse filing date
    let filing_date = null;
    let filing_dt_iso = null;
    if (broadcastRaw) {
      // Common formats: "09-MAY-2026 18:30:00" / "2026-05-09T18:30:00"
      const m = broadcastRaw.match(/(\d{1,2})[- /]([A-Za-z]{3,9}|\d{2})[- /](\d{4})\s*(\d{2}):?(\d{2})?/);
      if (m) {
        const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
        const mm = isNaN(+m[2]) ? months[m[2].toUpperCase().slice(0, 3)] : (+m[2] - 1);
        const d = new Date(Date.UTC(+m[3], mm, +m[1], +m[4] - 5, (+(m[5] || 0)) - 30));
        if (!isNaN(d.getTime())) {
          filing_dt_iso = d.toISOString();
          filing_date = filing_dt_iso.slice(0, 10);
        }
      } else {
        const d = new Date(broadcastRaw);
        if (!isNaN(d.getTime())) {
          filing_dt_iso = d.toISOString();
          filing_date = filing_dt_iso.slice(0, 10);
        }
      }
    }
    if (!filing_date) continue;
    // Quarter inference from period_ended (e.g. "31-Mar-2026" → Q4FY26)
    let quarter = '';
    if (periodEnded) {
      const pm = periodEnded.match(/(\d{1,2})[- /]([A-Za-z]{3,9})[- /](\d{4})/);
      if (pm) {
        const months = { JAN:0, FEB:1, MAR:2, APR:3, MAY:4, JUN:5, JUL:6, AUG:7, SEP:8, OCT:9, NOV:10, DEC:11 };
        const mNum = months[pm[2].toUpperCase().slice(0, 3)] ?? -1;
        const yr = +pm[3];
        if (mNum === 2)        quarter = `Q4FY${String(yr).slice(2)}`;
        else if (mNum === 5)   quarter = `Q1FY${String(yr).slice(2)}`;
        else if (mNum === 8)   quarter = `Q2FY${String(yr).slice(2)}`;
        else if (mNum === 11)  quarter = `Q3FY${String(yr).slice(2)}`;
      }
    }
    out.push({
      symbol,
      company,
      filing_date,
      filing_dt_iso,
      quarter,
      period_ended: periodEnded,
      audited: !!r.audited || String(r.audited).toLowerCase() === 'yes' || /audited/i.test(r.filing_status || ''),
      consolidated: /consolidated/i.test(r.consolidated || r.filing_status || ''),
      period_type: r._period,
      attachment: r.attachment ? `https://www.nseindia.com/${String(r.attachment).replace(/^\//, '')}` : null,
      source_url: r.attachment ? `https://www.nseindia.com/${String(r.attachment).replace(/^\//, '')}` : `https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`,
      exchange: 'NSE',
    });
  }
  return out;
}

// ─── Upstash REST push ─────────────────────────────────────────────────────
async function kvSet(key, value, ttlSeconds) {
  const body = JSON.stringify(value);
  const url = `${KV_URL}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ value: body }),
  });
  if (!res.ok) throw new Error(`KV set failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Alternative Upstash REST style: POST to /set/<key> with value in body
async function kvSetSimple(key, valueObj, ttlSeconds) {
  const url = `${KV_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(JSON.stringify(valueObj))}?EX=${ttlSeconds}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`KV set failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// Use the pipeline endpoint — most robust for large payloads
async function kvPipeline(commands) {
  const res = await fetch(`${KV_URL}/pipeline`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(commands),
  });
  if (!res.ok) throw new Error(`KV pipeline failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const today = new Date();
  // Look back 90d so the calendar covers history; look forward 30d for upcoming
  const from = new Date(today);
  from.setDate(today.getDate() - 90);
  const to = new Date(today);
  to.setDate(today.getDate() + 30);
  const fromStr = formatDate(from);
  const toStr   = formatDate(to);

  const jar = new CookieJar();
  await warmupSession(jar);

  const raw = await fetchNseResults(jar, fromStr, toStr);
  if (raw.length === 0) {
    console.error('[!] NSE returned 0 items.  Cookies may have been rejected or API is down.');
    process.exit(2);
  }

  const items = normalise(raw);
  console.log(`[normalise] ${raw.length} raw → ${items.length} canonical filings`);

  // Group by date for fast lookup
  const byDate = {};
  for (const it of items) {
    if (!byDate[it.filing_date]) byDate[it.filing_date] = [];
    byDate[it.filing_date].push(it);
  }
  // Sort each date by filing_dt_iso desc
  for (const k of Object.keys(byDate)) {
    byDate[k].sort((a, b) => (b.filing_dt_iso || '').localeCompare(a.filing_dt_iso || ''));
  }

  const payload = {
    scraped_at: new Date().toISOString(),
    from: fromStr,
    to: toStr,
    total: items.length,
    by_date: byDate,
    items,
  };

  // Push to KV — single canonical key
  console.log('[kv] pushing earnings:calendar:nse:v1 to Upstash…');
  // 7-day TTL — workflow runs every 30min so this stays fresh
  const ttl = 7 * 24 * 3600;
  const cmds = [
    ['SET', 'earnings:calendar:nse:v1', JSON.stringify(payload), 'EX', String(ttl)],
    // Per-date keys for fast point-lookup
    ...Object.entries(byDate).map(([date, dayItems]) => [
      'SET',
      `earnings:calendar:nse:v1:date:${date}`,
      JSON.stringify({ date, items: dayItems, total: dayItems.length }),
      'EX',
      String(ttl),
    ]),
  ];
  const result = await kvPipeline(cmds);
  console.log(`[kv] pipeline ok — ${result.length} commands acked`);
  console.log(`[done] ${items.length} filings, ${Object.keys(byDate).length} dates`);
}

function formatDate(d) {
  return `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
}

main().catch((e) => {
  console.error('[fatal]', e.stack || e.message);
  process.exit(1);
});
