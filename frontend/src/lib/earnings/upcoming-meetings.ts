// ═══════════════════════════════════════════════════════════════════════════
// UPCOMING RESULTS BOARD MEETINGS — TWO EXCHANGES, ONE LIST.          (zzz748)
//
// The calendar's "next 30 days" had gone blank. Diagnosis, in order:
//
//   1. The month ingest only ever ran for the CURRENT month, so October's
//      board meetings could not reach Postgres before October 1st.
//   2. Underneath that, NSE's `/api/corporate-board-meetings` answers this
//      host with NOTHING (bmTotal 0 in the ingest's own debug output) while
//      the same call from a residential IP returns COFORGE 23-Oct, HCLTECH
//      12-Oct and the rest. NSE announcements still work from here; the
//      board-meetings endpoint does not. Nothing reported it: the ingest
//      wrote whatever it had and the cron said "ok".
//   3. The `refresh-earnings-calendar` cron walked ~750 per-symbol NSE calls
//      to an endpoint that returned nothing, and wrote zero keys, daily.
//
// This module is the one place both consumers get upcoming meetings from:
//
//   NSE  /api/corporate-board-meetings?from_date&to_date  (when it answers)
//   BSE  /BseIndiaAPI/api/Corpforthresults/w             (forthcoming results,
//        every BSE-listed company, ~all NSE names are dual-listed; goes
//        through the mc-proxy Worker when PROXY_URL/PROXY_SECRET are set)
//
// Rows are normalised to the shape the earnings route already consumes for
// NSE board meetings (`bm_symbol`, `bm_date`, `bm_purpose`, `bm_desc`,
// `sm_name`), so nothing downstream changes. BSE-only names carry their
// scrip code in `bse_scrip`. The result says which source answered and which
// did not; an empty answer from both is reported as such, never as "ok".
// ═══════════════════════════════════════════════════════════════════════════

import { nseApiFetch } from '@/lib/nse';
import { proxiedFetch } from '@/lib/proxy-fetch';

export interface UpcomingMeeting {
  bm_symbol: string;
  bm_date: string;          // DD-MMM-YYYY, what NSE emits and parseDate reads
  bm_purpose: string;
  bm_desc: string;
  sm_name: string;
  bse_scrip?: string;
  source: 'NSE' | 'BSE';
}

export interface UpcomingMeetingsResult {
  meetings: UpcomingMeeting[];
  nse: { ok: boolean; rows: number; error: string | null };
  bse: { ok: boolean; rows: number; error: string | null };
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_IDX: Record<string, number> = Object.fromEntries(MON.map((m, i) => [m.toLowerCase(), i]));

/** "12 Oct 2026" | "12-Oct-2026" | "2026-10-12" | "12/10/2026" → "12-Oct-2026". */
export function toNseDate(s: string | null | undefined): string | null {
  const t = String(s || '').trim();
  let d: number, m: number, y: number;
  let x: RegExpMatchArray | null;
  if ((x = t.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[a-z]*[-\s/,]+(\d{4})/))) {
    d = +x[1]; m = MON_IDX[x[2].toLowerCase()]; y = +x[3];
  } else if ((x = t.match(/^(\d{4})-(\d{2})-(\d{2})/))) {
    y = +x[1]; m = +x[2] - 1; d = +x[3];
  } else if ((x = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) {
    d = +x[1]; m = +x[2] - 1; y = +x[3];
  } else return null;
  if (m == null || m < 0 || m > 11 || d < 1 || d > 31) return null;
  return `${String(d).padStart(2, '0')}-${MON[m]}-${y}`;
}

/** DD-MM-YYYY for NSE query strings. */
export const nseQueryDate = (d: Date) => `${String(d.getDate()).padStart(2, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
/** YYYYMMDD for BSE query strings. */
export const bseQueryDate = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

/** BSE short names carry group suffixes NSE symbols never do ("RAMAPPR-B"). */
export function bseShortToSymbol(short: string): string {
  return String(short || '').toUpperCase().trim().replace(/-(B|B1|B2|BE|BZ|E|E1|X|XT|T|Z)$/, '');
}

/** Pure: NSE board-meetings rows → normalised, results-purpose only. */
export function normaliseNse(rows: any[]): UpcomingMeeting[] {
  const out: UpcomingMeeting[] = [];
  for (const r of rows) {
    const sym = String(r?.bm_symbol || r?.symbol || '').toUpperCase();
    const date = toNseDate(r?.bm_date || r?.bm_meetingDate || r?.date);
    if (!sym || !date) continue;
    const purpose = String(r?.bm_purpose || r?.purpose || '');
    const desc = String(r?.bm_desc || r?.desc || '');
    const p = purpose.toLowerCase(), dsc = desc.toLowerCase();
    const results = (t: string) => /financial\s*result|quarterly\s*result|half.?yearly\s*result|annual\s*result/.test(t);
    // NSE files the same meeting twice: "Board Meeting Intimation" (desc carries
    // the purpose) and "Financial Results" (purpose carries it). Keep either.
    if (!results(p) && !results(dsc)) continue;
    if (/\bagm\b|\begm\b|annual general|extraordinary general/.test(p)) continue;
    out.push({ bm_symbol: sym, bm_date: date, bm_purpose: results(p) ? purpose : 'Financial Results', bm_desc: desc, sm_name: String(r?.sm_name || r?.bm_companyName || sym), source: 'NSE' });
  }
  return out;
}

/** Pure: BSE Corpforthresults rows → normalised. Every row IS a results meeting. */
export function normaliseBse(rows: any[]): UpcomingMeeting[] {
  const out: UpcomingMeeting[] = [];
  for (const r of rows) {
    const date = toNseDate(r?.meeting_date);
    const sym = bseShortToSymbol(r?.short_name);
    if (!date || !sym) continue;
    out.push({
      bm_symbol: sym,
      bm_date: date,
      bm_purpose: 'Financial Results',
      bm_desc: `BSE forthcoming results: ${String(r?.Long_Name || sym)} board meeting on ${date}`,
      sm_name: String(r?.Long_Name || sym),
      bse_scrip: String(r?.scrip_Code || r?.scrip_code || ''),
      source: 'BSE',
    });
  }
  return out;
}

/** Pure: union by symbol+date, NSE row wins over BSE for the same meeting. */
export function mergeMeetings(nse: UpcomingMeeting[], bse: UpcomingMeeting[]): UpcomingMeeting[] {
  const seen = new Set<string>();
  const out: UpcomingMeeting[] = [];
  for (const m of [...nse, ...bse]) {
    const k = `${m.bm_symbol}|${m.bm_date}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(m);
  }
  return out;
}

export async function fetchUpcomingBoardMeetings(from: Date, to: Date): Promise<UpcomingMeetingsResult> {
  const res: UpcomingMeetingsResult = { meetings: [], nse: { ok: false, rows: 0, error: null }, bse: { ok: false, rows: 0, error: null } };

  const [nseRaw, bseRaw] = await Promise.all([
    nseApiFetch(`/api/corporate-board-meetings?index=equities&from_date=${nseQueryDate(from)}&to_date=${nseQueryDate(to)}`, 300000)
      .catch((e: any) => { res.nse.error = String(e?.message || e); return null; }),
    (async () => {
      const url = `https://api.bseindia.com/BseIndiaAPI/api/Corpforthresults/w?scripcode=&Fdate=${bseQueryDate(from)}&Purpose=P&TDate=${bseQueryDate(to)}&strSearch=P`;
      try {
        const r = await proxiedFetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
            'Accept': 'application/json, text/plain, */*',
            'Referer': 'https://www.bseindia.com/',
            'Origin': 'https://www.bseindia.com',
          },
          signal: AbortSignal.timeout(20_000),
          cache: 'no-store',
        });
        if (!r.ok) { res.bse.error = `HTTP ${r.status}`; return null; }
        const text = await r.text();
        try { return JSON.parse(text); } catch { res.bse.error = `non-JSON answer (${text.slice(0, 60).replace(/\s+/g, ' ')}…)`; return null; }
      } catch (e: any) { res.bse.error = String(e?.message || e); return null; }
    })(),
  ]);

  const nseRows: any[] = Array.isArray(nseRaw) ? nseRaw : (Array.isArray(nseRaw?.data) ? nseRaw.data : []);
  const bseRows: any[] = Array.isArray(bseRaw) ? bseRaw : (Array.isArray(bseRaw?.Table) ? bseRaw.Table : []);
  if (nseRaw == null && !res.nse.error) res.nse.error = 'NSE answered nothing (blocked, cookie refresh failed, or negative-cached)';
  if (bseRaw == null && !res.bse.error) res.bse.error = 'BSE answered nothing';
  const nse = normaliseNse(nseRows);
  const bse = normaliseBse(bseRows);
  res.nse = { ok: nseRows.length > 0, rows: nse.length, error: res.nse.error };
  res.bse = { ok: bseRows.length > 0, rows: bse.length, error: res.bse.error };
  res.meetings = mergeMeetings(nse, bse);
  return res;
}
