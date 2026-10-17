// zzz1055 — FII / DII flows: fetching the public sources (server only). Parsing lives in ./parse (pure).
//
// NSE: lib/nse nseApiFetch (cookie handling, negative cache) first, then the mc-proxy relay (proxiedFetch) when NSE blocks the
// server's IP. NSDL: plain HTTPS with a browser User-Agent (NSDL drops requests without one). When neither works from the app
// host, .github/workflows/scrape-fii-dii.yml collects the same pages from GitHub and POSTs them to /api/v1/fii-dii.
import { nseApiFetch } from '@/lib/nse';
import { proxiedFetch } from '@/lib/proxy-fetch';
import { checkNseFiiDii, participantOiUrl, type NseFiiDiiDay } from './parse';
import { fetchChart } from '@/lib/yahoo';

export const NSE_FII_DII_PATH = '/api/fiidiiTradeReact';
export const NSE_FII_DII_URL = `https://www.nseindia.com${NSE_FII_DII_PATH}`;
export const NSDL_LATEST_URL = 'https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx';
export const NSDL_ARCHIVE_URL = 'https://www.fpi.nsdl.co.in/web/Reports/Archive.aspx';
export const NSDL_SECTOR_LIST_URL = 'https://www.fpi.nsdl.co.in/web/Reports/FPI_Fortnightly_Selection.aspx';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

/** zzz1067 (F03): `rejected` lists why a recognised NSE file was not trusted (dates disagree, totals do not add up …). */
export async function fetchNseFiiDii(): Promise<{ day: NseFiiDiiDay | null; via: string; error?: string; rejected?: string[] }> {
  let rejected: string[] | undefined;
  try {
    const j = await nseApiFetch(NSE_FII_DII_PATH, 30_000);
    const c = checkNseFiiDii(j);
    if (c.day) return { day: c.day, via: 'nse' };
    if (c.problems.length) rejected = c.problems;
  } catch { /* fall through to the relay */ }
  try {
    const r = await proxiedFetch(NSE_FII_DII_URL, {
      headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.nseindia.com/reports/fii-dii' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) return { day: null, via: 'relay', error: `HTTP ${r.status}`, rejected };
    const c = checkNseFiiDii(await r.json());
    if (c.day) return { day: c.day, via: 'relay' };
    const bad = c.problems.length ? c.problems : rejected;
    return { day: null, via: 'relay', error: bad?.length ? `rejected: ${bad.join('; ')}` : 'unrecognised answer', rejected: bad };
  } catch (e: any) {
    return { day: null, via: 'relay', error: e?.message || 'network', rejected };
  }
}

async function getText(url: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; text: string; res?: Response }> {
  try {
    const res = await fetch(url, { ...init, headers: { 'User-Agent': UA, Accept: 'text/html,*/*', ...(init.headers || {}) }, signal: AbortSignal.timeout(30_000), redirect: 'follow' });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, res };
  } catch (e: any) {
    return { ok: false, status: 0, text: e?.message || 'network' };
  }
}

export async function fetchNsdlLatest(): Promise<{ html: string | null; error?: string }> {
  const r = await getText(NSDL_LATEST_URL);
  return r.ok ? { html: r.text } : { html: null, error: `NSDL HTTP ${r.status}` };
}

const hidden = (html: string, name: string) => new RegExp(`id="${name}"\\s+value="([^"]*)"`).exec(html)?.[1] ?? '';

/** NSDL archive: daily FPI trends for the month of `dateIso`, up to that date (ASP.NET form post). */
export async function fetchNsdlArchiveMonth(dateIso: string): Promise<{ html: string | null; error?: string }> {
  const first = await getText(NSDL_ARCHIVE_URL);
  if (!first.ok) return { html: null, error: `NSDL archive HTTP ${first.status}` };
  const cookies = (first.res?.headers as any)?.getSetCookie?.() as string[] | undefined;
  const cookie = (cookies || []).map((c) => c.split(';')[0]).join('; ');
  const [y, m, d] = dateIso.split('-');
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m) - 1];
  const body = new URLSearchParams({
    __EVENTTARGET: 'btnSubmit1', __EVENTARGUMENT: '',
    __VIEWSTATE: hidden(first.text, '__VIEWSTATE'), __VIEWSTATEGENERATOR: hidden(first.text, '__VIEWSTATEGENERATOR'),
    __EVENTVALIDATION: hidden(first.text, '__EVENTVALIDATION'),
    hdnDate: `${d}-${mon}-${y}`, HdnValexceldata: '', hdnFlag: '',
  });
  const r = await getText(NSDL_ARCHIVE_URL, {
    method: 'POST', body: body.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: NSDL_ARCHIVE_URL, ...(cookie ? { Cookie: cookie } : {}) },
  });
  return r.ok ? { html: r.text } : { html: null, error: `NSDL archive POST HTTP ${r.status}` };
}

export async function fetchSectorList(): Promise<{ html: string | null; error?: string }> {
  const r = await getText(NSDL_SECTOR_LIST_URL);
  return r.ok ? { html: r.text } : { html: null, error: `NSDL sector list HTTP ${r.status}` };
}

export async function fetchSectorReport(url: string): Promise<{ html: string | null; error?: string }> {
  if (!/^https:\/\/www\.fpi\.nsdl\.co\.in\/web\/StaticReports\/Fortnightly_Sector_wise_FII_Investment_Data\/[\w.-]+\.html?$/.test(url)) return { html: null, error: 'not an NSDL sector report URL' };
  const r = await getText(url);
  return r.ok ? { html: r.text } : { html: null, error: `NSDL report HTTP ${r.status}` };
}

// ── zzz1060: NSE participant-wise OI (static archive file, no cookies needed) and Nifty 50 closes (Yahoo) ──────────────

/** The day's participant-OI CSV. `missing` = NSE answered 404 (holiday / not published yet), which is not an error. */
export async function fetchParticipantOi(dateIso: string): Promise<{ csv: string | null; missing?: boolean; error?: string }> {
  const url = participantOiUrl(dateIso);
  const tryOnce = async (viaRelay: boolean) => {
    const init = { headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', Referer: 'https://www.nseindia.com/' }, signal: AbortSignal.timeout(15_000) };
    const r = viaRelay ? await proxiedFetch(url, init) : await fetch(url, init);
    if (r.status === 404) return { csv: null, missing: true };
    if (!r.ok) return { csv: null, error: `HTTP ${r.status}` };
    const t = await r.text();
    return /participant/i.test(t.slice(0, 200)) ? { csv: t } : { csv: null, error: 'not a participant OI file' };
  };
  try {
    const a = await tryOnce(false);
    if (a.csv || a.missing) return a;
  } catch { /* relay next */ }
  try { return await tryOnce(true); } catch (e: any) { return { csv: null, error: e?.message || 'network' }; }
}

/** Nifty 50 daily closes, IST trading dates. `range` = Yahoo range ('5y' for the first fill, '1mo' after). */
export async function fetchNiftyCloses(range: '5y' | '1mo' = '1mo'): Promise<Array<{ date: string; close: number }>> {
  const c: any = await fetchChart('^NSEI', range, '1d');
  const ts: number[] = c?.timestamps || [], cl: Array<number | null> = c?.closes || [];
  const out: Array<{ date: string; close: number }> = [];
  for (let i = 0; i < ts.length; i++) {
    const v = cl[i];
    if (v == null || !(v > 0)) continue;
    out.push({ date: new Date((ts[i] + 330 * 60) * 1000).toISOString().slice(0, 10), close: Math.round(v * 100) / 100 });
  }
  return out;
}
