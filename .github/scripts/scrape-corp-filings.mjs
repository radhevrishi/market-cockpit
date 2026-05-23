#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════════
// PATCH 0739 — NSE + BSE corporate-filings scraper for GitHub Actions.
//
// Pulls corp-announcements from NSE + BSE on the GH free CPU runner and
// writes a consolidated blob to Upstash. Vercel routes (concall-intel,
// order-book, rating-actions, special-situations) read this blob as a
// fallback when their fresh upstream calls fail (the 50% NSE failure
// rate documented in CLAUDE.md §18.8 / §18.11).
//
// Same architectural pattern as scrape-india-news.mjs:
//   - pure Node 20, no npm install
//   - one consolidated blob in Upstash (key: corp-filings:v1:latest)
//   - 24h TTL so stale blob serves until next run, never goes blank
//
// Required env vars (GH Actions secrets):
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN
// ═══════════════════════════════════════════════════════════════════════════

const KV_URL   = process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!KV_URL || !KV_TOKEN) {
  console.error('::error title=Missing env::Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN as repo secrets.');
  process.exit(1);
}

const KV_KEY         = 'corp-filings:v1:latest';
const KV_TTL_SECONDS = 24 * 60 * 60;
const FETCH_TIMEOUT_MS = 15_000;
const MAX_FILINGS    = 500;

// ─── Date helpers ──────────────────────────────────────────────────────────

function isoDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function formatNSEDate(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;   // NSE expects DD-MM-YYYY
}

function sha256Short(s) {
  // Quick 16-char hash without crypto module dependency on Vercel.
  // GH Actions runner has Node 20 which has crypto built-in.
  // Using native crypto.subtle would require async; createHash sync.
  return import('node:crypto').then((m) =>
    m.createHash('sha256').update(s).digest('hex').slice(0, 16),
  );
}

// ─── NSE adapter ───────────────────────────────────────────────────────────

const NSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/companies-listing/corporate-filings-announcements',
};

async function fetchNSECookies() {
  // NSE blocks API calls without a session cookie. Visit homepage first.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch('https://www.nseindia.com/', {
      signal: ctl.signal,
      headers: { 'User-Agent': NSE_HEADERS['User-Agent'], 'Accept': 'text/html' },
      redirect: 'follow',
    });
    const cookies = res.headers.getSetCookie?.() || [];
    return cookies.map((c) => c.split(';')[0]).join('; ');
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function fetchNSEFilings() {
  const from = isoDaysAgo(2);
  const to   = isoDaysAgo(0);
  const url = `https://www.nseindia.com/api/corporate-announcements?index=equities&from_date=${formatNSEDate(from)}&to_date=${formatNSEDate(to)}`;

  const cookie = await fetchNSECookies();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { ...NSE_HEADERS, Cookie: cookie },
      cache: 'no-store',
    });
    if (!res.ok) {
      console.log(`::warning title=NSE::HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const entries = Array.isArray(data) ? data : (Array.isArray(data?.data) ? data.data : []);
    const filings = [];
    for (const e of entries) {
      const subject = String(e.subject || e.desc || '').trim();
      if (!subject) continue;
      const ts = e.an_dt || e.sm_dt || e.dt || e.broadcastdt;
      if (!ts) continue;
      let isoDt;
      try {
        const d = new Date(ts);
        if (!Number.isFinite(d.getTime())) continue;
        isoDt = d.toISOString();
      } catch { continue; }

      const symbol = String(e.symbol || '').trim().toUpperCase();
      const company = String(e.sm_name || e.company_name || symbol).trim();
      const urls = [];
      if (e.attchmntFile)   urls.push(String(e.attchmntFile));
      if (e.attachmentUrl)  urls.push(String(e.attachmentUrl));

      filings.push({
        exchange: 'NSE',
        symbol,
        company_name: company,
        subject,
        category:    e.csubject || e.category    || null,
        subcategory: e.smkt_cat || e.sub_category || null,
        filing_datetime: isoDt,
        attachment_urls: urls,
        source_url: `https://www.nseindia.com/companies-listing/corporate-filings-announcements?symbol=${encodeURIComponent(symbol)}`,
      });
    }
    console.log(`  NSE → ${filings.length} filings`);
    return filings;
  } catch (e) {
    console.log(`::warning title=NSE::${e?.message || e}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// ─── BSE adapter ───────────────────────────────────────────────────────────

const BSE_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.bseindia.com/corporates/ann.html',
};

async function fetchBSEFilings(pages = 2) {
  const fromStr = isoDaysAgo(2).replace(/-/g, '');
  const toStr   = isoDaysAgo(0).replace(/-/g, '');
  const all = [];
  for (let p = 1; p <= pages; p++) {
    const url = `https://api.bseindia.com/BseIndiaAPI/api/AnnGetData/w?pageno=${p}&strCat=-1&strPrevDate=${fromStr}&strScrip=&strSearch=P&strToDate=${toStr}&strType=C`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctl.signal,
        headers: BSE_HEADERS,
        cache: 'no-store',
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403 || res.status === 429) {
          console.log(`::warning title=BSE::HTTP ${res.status} — bailing`);
          break;
        }
        continue;
      }
      const data = await res.json();
      const table = Array.isArray(data?.Table) ? data.Table : [];
      for (const e of table) {
        const subject = String(e.NEWSSUB || e.HEADLINE || '').trim();
        if (!subject) continue;
        const ts = e.NEWS_DT || e.DT_TM;
        if (!ts) continue;
        let isoDt;
        try {
          const d = new Date(ts);
          if (!Number.isFinite(d.getTime())) continue;
          isoDt = d.toISOString();
        } catch { continue; }

        const symbol = String(e.SCRIP_CD || '').trim();
        const company = String(e.SLONGNAME || e.SHORTNAME || symbol).trim();
        const urls = [];
        if (e.ATTACHMENTNAME) {
          urls.push(`https://www.bseindia.com/xml-data/corpfiling/AttachLive/${e.ATTACHMENTNAME}`);
        }
        all.push({
          exchange: 'BSE',
          symbol,
          company_name: company,
          subject,
          category:    e.CATEGORYNAME || null,
          subcategory: e.SUBCATNAME   || null,
          filing_datetime: isoDt,
          attachment_urls: urls,
          source_url: `https://www.bseindia.com/stock-share-price/_/_/${symbol}/`,
        });
      }
    } catch (e) {
      console.log(`::warning title=BSE page ${p}::${e?.message || e}`);
    } finally {
      clearTimeout(timer);
    }
  }
  console.log(`  BSE → ${all.length} filings`);
  return all;
}

// ─── Upstash KV writer (REST API) ──────────────────────────────────────────

async function kvSet(key, value, ttlSeconds) {
  const url = `${KV_URL.replace(/\/+$/, '')}/set/${encodeURIComponent(key)}?EX=${ttlSeconds}`;
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Upstash SET failed: HTTP ${res.status} — ${t.slice(0, 200)}`);
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const start = Date.now();
  console.log(`▶ scrape-corp-filings at ${new Date().toISOString()}`);

  const [nse, bse] = await Promise.all([fetchNSEFilings(), fetchBSEFilings(2)]);
  const all = [...nse, ...bse];

  // Dedup by content hash. Same filing appearing on both exchanges
  // collapses; same announcement appearing on consecutive pages collapses.
  const crypto = await import('node:crypto');
  const seen = new Set();
  const deduped = [];
  for (const f of all) {
    const payload = `${f.exchange}|${(f.symbol || '').toUpperCase()}|${(f.subject || '').toLowerCase().trim()}|${f.filing_datetime}`;
    const hash = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
    if (seen.has(hash)) continue;
    seen.add(hash);
    deduped.push({ ...f, content_hash: hash });
  }

  // Sort newest first, cap.
  deduped.sort((a, b) => (b.filing_datetime || '').localeCompare(a.filing_datetime || ''));
  const final = deduped.slice(0, MAX_FILINGS);

  const elapsed = Date.now() - start;
  const payload = {
    generatedAt: new Date().toISOString(),
    elapsedMs: elapsed,
    nseCount: nse.length,
    bseCount: bse.length,
    dedupedCount: deduped.length,
    finalCount: final.length,
    filings: final,
  };

  let size = JSON.stringify(payload).length;
  while (size > 800_000 && payload.filings.length > 20) {
    payload.filings = payload.filings.slice(0, Math.floor(payload.filings.length * 0.8));
    size = JSON.stringify(payload).length;
  }

  await kvSet(KV_KEY, payload, KV_TTL_SECONDS);
  console.log(`✓ wrote ${KV_KEY} — ${final.length} filings (NSE ${nse.length} + BSE ${bse.length}), ${Math.round(size / 1024)} KB in ${elapsed}ms`);
  console.log(`::notice title=Filings scrape complete::${final.length} corp filings cached.`);
}

main().catch((e) => {
  console.error(`::error title=Scraper crashed::${e?.message || e}`);
  console.error(e?.stack || e);
  process.exit(1);
});
