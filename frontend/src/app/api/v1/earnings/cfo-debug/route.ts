// Diagnostic endpoint for CFO/PAT extraction. Call: /api/v1/earnings/cfo-debug?symbol=SHILPAMED
import { proxiedFetch } from '@/lib/proxy-fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0 Safari/537.36';

function strip(s: string): string {
  return String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/,/g, '').trim();
}
function toNum(s: string): number | null {
  const n = parseFloat(strip(s));
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const symbol = (searchParams.get('symbol') || '').trim().toUpperCase();
  if (!symbol) return Response.json({ error: 'symbol required' }, { status: 400 });

  const url = `https://www.screener.in/company/${encodeURIComponent(symbol)}/consolidated/`;
  const trace: any = { symbol, url, stages: [] };

  let html = '';
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    const res = await proxiedFetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,*/*' }, signal: ctrl.signal });
    clearTimeout(t);
    trace.stages.push({ stage: 'fetch', status: res.status, ok: res.ok });
    if (!res.ok) return Response.json(trace);
    html = await res.text();
    trace.stages.push({ stage: 'html_size', bytes: html.length, has_top_ratios: /id=["']top-ratios["']/.test(html) });
  } catch (e: any) {
    trace.stages.push({ stage: 'fetch_error', err: String(e).slice(0, 200) });
    return Response.json(trace);
  }

  const sectionRe = (id: string) => new RegExp('<section[^>]*\\bid=["\']' + id + '["\'][^>]*>([\\s\\S]*?)</section>', 'i');
  const cfSec = html.match(sectionRe('cash-flow'));
  const plSec = html.match(sectionRe('profit-loss'));
  trace.stages.push({ stage: 'sections_found', cash_flow: !!cfSec, profit_loss: !!plSec });

  const rowLabels = (sectionHtml: string | null): string[] => {
    if (!sectionHtml) return [];
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const labels: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = trRe.exec(sectionHtml)) !== null) {
      const first = m[1].match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/i);
      if (first) labels.push(strip(first[1]));
    }
    return labels;
  };
  trace.stages.push({ stage: 'cash_flow_labels', labels: rowLabels(cfSec ? cfSec[1] : null) });
  trace.stages.push({ stage: 'profit_loss_labels', labels: rowLabels(plSec ? plSec[1] : null) });

  const findLastNum = (labelRe: RegExp): { matched: string | null; value: number | null; row_cells: string[] } => {
    const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let mm: RegExpExecArray | null;
    while ((mm = trRe.exec(html)) !== null) {
      const row = mm[1];
      const cells = Array.from(row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)).map((x: any) => strip(x[1]));
      if (!cells.length || !labelRe.test(cells[0])) continue;
      for (let i = cells.length - 1; i >= 1; i--) {
        const v = toNum(cells[i]);
        if (v != null) return { matched: cells[0], value: v, row_cells: cells };
      }
      return { matched: cells[0], value: null, row_cells: cells };
    }
    return { matched: null, value: null, row_cells: [] };
  };

  trace.stages.push({ stage: 'cfo_strict', result: findLastNum(/^\s*Cash from Operating Activity\s*[+\-]?\s*$/i) });
  trace.stages.push({ stage: 'cfo_loose', result: findLastNum(/cash\s+from\s+operating|operating\s+cash|cash\s+from\s+operations/i) });
  trace.stages.push({ stage: 'net_profit_strict', result: findLastNum(/^\s*Net Profit\s*[+\-]?\s*$/i) });

  return Response.json(trace, { headers: { 'Content-Type': 'application/json' } });
}

