// zzz341 + zzz343 — Screener.in screen fetcher with multiple fallbacks.
//
// Fetches Screener screen HTML and parses the data-table into JSON.
// Fallback chain (first success wins):
//   1. indiaearninghub Worker /screen?id= (once endpoint deployed)
//   2. Screener.in /screens/{id}/export/ CSV (may be less protected)
//   3. corsproxy.io wrapping Screener HTML
//   4. api.allorigins.win wrapping Screener HTML
//   5. Direct Screener fetch (usually blocked from Railway)

import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKER_BASE = 'https://indiaearninghub.radhev-232.workers.dev';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

function stripHtml(s: string): string {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function toNumber(s: string): number | string {
  const t = String(s).replace(/,/g, '').trim();
  if (!t || t === '—' || t === '-') return '';
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : s;
}

async function tryFetch(url: string, opts: RequestInit = {}): Promise<string | null> {
  try {
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml,text/csv,*/*;q=0.8', ...(opts.headers || {}) },
      cache: 'no-store',
      ...opts,
    });
    if (!r.ok) return null;
    const text = await r.text();
    return text && text.length > 500 ? text : null;
  } catch { return null; }
}

async function fetchScreen(id: string): Promise<{ html: string | null; csv: string | null }> {
  const screenerUrl = `https://www.screener.in/screens/${id}/`;
  const exportUrl = `https://www.screener.in/screens/${id}/export/`;
  const encoded = encodeURIComponent(screenerUrl);
  const encodedExport = encodeURIComponent(exportUrl);
  const attempts = [
    { url: `${WORKER_BASE}/screen?id=${id}`, kind: 'html' },
    { url: exportUrl, kind: 'csv' },
    { url: `https://corsproxy.io/?url=${encoded}`, kind: 'html' },
    { url: `https://corsproxy.io/?url=${encodedExport}`, kind: 'csv' },
    { url: `https://api.allorigins.win/raw?url=${encoded}`, kind: 'html' },
    { url: `https://api.codetabs.com/v1/proxy?quest=${encoded}`, kind: 'html' },
    { url: screenerUrl, kind: 'html' },
    { url: exportUrl, kind: 'csv' },
  ];
  for (const a of attempts) {
    const text = await tryFetch(a.url);
    if (!text) continue;
    if (a.kind === 'csv' && text.includes(',') && text.split('\n').length > 2) {
      return { html: null, csv: text };
    }
    if (a.kind === 'html' && (text.includes('data-table') || text.includes('<table'))) {
      return { html: text, csv: null };
    }
  }
  return { html: null, csv: null };
}

function parseScreenerHtml(html: string): { columns: string[]; rows: any[]; name: string } {
  const nameMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/) || html.match(/<title>([^<]+)<\/title>/);
  const name = nameMatch ? stripHtml(nameMatch[1]).replace(' - Screener', '') : '';
  const tableMatch = html.match(/<table[^>]*class="[^"]*data-table[^"]*"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) return { columns: [], rows: [], name };
  const table = tableMatch[1];
  const theadMatch = table.match(/<thead[^>]*>([\s\S]*?)<\/thead>/);
  const columns: string[] = [];
  if (theadMatch) {
    const thRegex = /<th[^>]*>([\s\S]*?)<\/th>/g;
    let m;
    while ((m = thRegex.exec(theadMatch[1])) !== null) columns.push(stripHtml(m[1]));
  }
  const tbodyMatch = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  const rows: any[] = [];
  if (tbodyMatch) {
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr;
    while ((tr = trRegex.exec(tbodyMatch[1])) !== null) {
      const row: any = {};
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let td; let i = 0;
      while ((td = tdRegex.exec(tr[1])) !== null) {
        const cell = td[1];
        if (i === 1) {
          const linkMatch = cell.match(/\/company\/([^/"]+)/);
          if (linkMatch) row.__ticker = linkMatch[1];
        }
        const col = columns[i] || `col_${i}`;
        row[col] = toNumber(stripHtml(cell));
        i++;
      }
      if (Object.keys(row).length > 3) rows.push(row);
    }
  }
  return { columns, rows, name };
}

function parseCsv(csv: string): { columns: string[]; rows: any[]; name: string } {
  // Simple CSV parser handling quoted values
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { columns: [], rows: [], name: '' };
  const splitCsvLine = (line: string): string[] => {
    const out: string[] = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  };
  const columns = splitCsvLine(lines[0]).map((s) => s.trim());
  const rows: any[] = [];
  for (let li = 1; li < lines.length; li++) {
    const cells = splitCsvLine(lines[li]);
    if (cells.length < 3) continue;
    const row: any = {};
    for (let i = 0; i < cells.length; i++) {
      const col = columns[i] || `col_${i}`;
      row[col] = toNumber(cells[i]);
    }
    // Extract ticker if there's a Name column with symbol
    if (row['Name']) row.__ticker = String(row['Name']).toUpperCase().replace(/\s+/g, '');
    rows.push(row);
  }
  return { columns, rows, name: '' };
}

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  const { id } = context.params;
  if (!id || !/^\d+$/.test(id)) return Response.json({ err: 'bad id' }, { status: 400 });
  const { html, csv } = await fetchScreen(id);
  if (!html && !csv) {
    return Response.json({ id, err: 'fetch_failed', hint: 'All proxy attempts blocked. Screener.in may require login for this screen OR add /screen?id= endpoint to indiaearninghub Cloudflare Worker.' }, { status: 502 });
  }
  const parsed = html ? parseScreenerHtml(html) : parseCsv(csv!);
  return Response.json({
    id,
    name: parsed.name,
    columns: parsed.columns,
    rows: parsed.rows,
    count: parsed.rows.length,
    source: html ? 'html' : 'csv',
    fetchedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
