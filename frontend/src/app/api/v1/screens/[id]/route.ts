// zzz341 — Screener.in screen fetcher via CF Worker proxy.
//
// Screener.in screens are HTML pages with a big data table. This route fetches
// the HTML server-side (Railway IPs are often blocked by Screener's Cloudflare
// so we proxy via our own indiaearninghub Worker), then parses the table into
// structured JSON. Client renders it as a sortable/filterable table.
//
// Contract: GET /api/v1/screens/{id}
// Returns { id, name, columns: string[], rows: Array<Record<string, string|number>>, fetchedAt }

import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const WORKER_BASE = 'https://indiaearninghub.radhev-232.workers.dev';

function stripHtml(s: string): string {
  return String(s || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function toNumber(s: string): number | string {
  const t = String(s).replace(/,/g, '').trim();
  if (!t || t === '—' || t === '-') return '';
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : s;
}

async function fetchScreen(id: string): Promise<string | null> {
  const urls = [
    `${WORKER_BASE}/screen?id=${id}`,
    `https://www.screener.in/screens/${id}/`,
  ];
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
        cache: 'no-store',
      });
      if (!r.ok) continue;
      const html = await r.text();
      if (html.length > 5000 && (html.includes('data-row') || html.includes('<table') || html.includes('data-name'))) {
        return html;
      }
    } catch { continue; }
  }
  return null;
}

function parseScreenerTable(html: string): { columns: string[]; rows: any[]; name: string } {
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
    while ((m = thRegex.exec(theadMatch[1])) !== null) {
      columns.push(stripHtml(m[1]));
    }
  }

  const tbodyMatch = table.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  const rows: any[] = [];
  if (tbodyMatch) {
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g;
    let tr;
    while ((tr = trRegex.exec(tbodyMatch[1])) !== null) {
      const row: any = {};
      const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/g;
      let td;
      let i = 0;
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

export async function GET(req: NextRequest, context: { params: { id: string } }) {
  const { id } = context.params;
  if (!id || !/^\d+$/.test(id)) {
    return Response.json({ err: 'bad id' }, { status: 400 });
  }
  const html = await fetchScreen(id);
  if (!html) {
    return Response.json({ id, err: 'fetch_failed', hint: 'Screener screen not accessible. May need auth cookie or CF Worker screen endpoint.' }, { status: 502 });
  }
  const parsed = parseScreenerTable(html);
  return Response.json({
    id,
    name: parsed.name,
    columns: parsed.columns,
    rows: parsed.rows,
    count: parsed.rows.length,
    fetchedAt: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}

