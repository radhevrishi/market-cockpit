// zzz1055 — FII / DII flows: pure parsers for the three public sources (no I/O here, unit-tested).
//
//   1. NSE provisional cash-market FII/DII figures   https://www.nseindia.com/api/fiidiiTradeReact
//      Published ~18:00–19:00 IST each trading day for THAT day. JSON array, one object per category.
//   2. NSDL "Daily Trends in FPI Investments"          https://www.fpi.nsdl.co.in/web/Reports/Latest.aspx (+ Archive.aspx)
//      FPI (= FII) only, confirmed from custodian reports. A row's "reporting date" carries the trades of the PREVIOUS
//      trading day, so a row is filed under the trading day before its reporting date (see nsdlTradeDate).
//   3. NSDL fortnightly sector-wise FPI investment    .../StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/*.html
//      Per sector: assets under custody (AUC) and net investment for two half-months, in ₹ crore and US$ million.

export interface Side { buy: number; sell: number; net: number }
export interface NseFiiDiiDay { date: string; fii: Side | null; dii: Side | null }

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** '15-Oct-2026' / '15-OCT-2026' → '2026-10-15'; null when not a real date. */
export function ddMonYyyyToIso(s: string): string | null {
  const m = /^\s*(\d{1,2})[-\s]([A-Za-z]{3,9})[-\s,]*(\d{4})\s*$/.exec(String(s || ''));
  if (!m) return null;
  const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mon) return null;
  const d = Number(m[1]), y = Number(m[3]);
  const dt = new Date(Date.UTC(y, mon - 1, d));
  if (dt.getUTCMonth() !== mon - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 'September 30, 2026' / 'SEP 30, 2026' → '2026-09-30'. */
export function monthDayYearToIso(s: string): string | null {
  const m = /([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(String(s || ''));
  if (!m) return null;
  return ddMonYyyyToIso(`${m[2]}-${m[1]}-${m[3]}`);
}

/** Indian-formatted number: '5,07,517' → 507517, '(1094.47)' → -1094.47, '-2,670' → -2670. null when not a number. */
export function parseInNumber(s: unknown): number | null {
  if (typeof s === 'number') return Number.isFinite(s) ? s : null;
  let t = String(s ?? '').replace(/[₹\s]|Rs\.?/gi, '').replace(/,/g, '');
  if (!t || t === '-' || t === '—') return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (!/^[-+]?\d+(\.\d+)?$/.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function side(o: any): Side | null {
  const buy = parseInNumber(o?.buyValue), sell = parseInNumber(o?.sellValue);
  let net = parseInNumber(o?.netValue);
  if (buy == null || sell == null) return null;
  if (net == null) net = round2(buy - sell);
  return { buy, sell, net };
}

/** zzz1067 (F03) — how far bought − sold may sit from the stated net: rounding to 2 decimals on each figure, plus a hair. */
export const netTolerance = (buy: number, sell: number) => 0.05 + (Math.abs(buy) + Math.abs(sell)) * 0.00001;

/** Gross figures must be ≥ 0 and bought − sold must match the stated net within rounding. Empty list = the side is sound. */
export function sideProblems(label: string, s: Side): string[] {
  const out: string[] = [];
  if (s.buy < 0 || s.sell < 0) out.push(`${label}: negative bought / sold value`);
  if (Math.abs(s.buy - s.sell - s.net) > netTolerance(s.buy, s.sell)) out.push(`${label}: bought − sold (${round2(s.buy - s.sell)}) does not match the stated net (${s.net})`);
  return out;
}

export interface NseFiiDiiCheck { day: NseFiiDiiDay | null; problems: string[] }

/**
 * zzz1067 (F03) — NSE fiidiiTradeReact JSON → one day, with every reason it cannot be trusted. A payload is QUARANTINED
 * (problems not empty, nothing stored) when the FII and DII rows carry different dates, a category appears twice, a gross
 * figure is negative or bought − sold does not match the stated net. Unknown categories are ignored. `day` is null when the
 * shape is not recognised or anything is wrong — the caller keeps the last verified day.
 */
export function checkNseFiiDii(json: unknown): NseFiiDiiCheck {
  const arr: any[] = Array.isArray(json) ? json : Array.isArray((json as any)?.data) ? (json as any).data : [];
  if (!arr.length) return { day: null, problems: [] };
  const problems: string[] = [];
  let fii: Side | null = null, dii: Side | null = null;
  let fiiSeen = 0, diiSeen = 0;
  const dates = new Set<string>();
  for (const o of arr) {
    const cat = String(o?.category || '').toUpperCase();
    const isFii = /FII|FPI/.test(cat), isDii = !isFii && /DII/.test(cat);
    if (!isFii && !isDii) continue;
    const d = ddMonYyyyToIso(String(o?.date || ''));
    if (d) dates.add(d);
    else if (String(o?.date || '').trim()) problems.push(`${isFii ? 'FII' : 'DII'}: date "${String(o.date).slice(0, 20)}" is not a real date`);
    const s = side(o);
    if (s) problems.push(...sideProblems(isFii ? 'FII' : 'DII', s));
    if (isFii) { fiiSeen++; fii = s; } else { diiSeen++; dii = s; }
  }
  if (fiiSeen > 1) problems.push('FII category appears more than once');
  if (diiSeen > 1) problems.push('DII category appears more than once');
  if (dates.size > 1) problems.push(`categories carry different dates (${[...dates].sort().join(', ')})`);
  const date = dates.size === 1 ? [...dates][0] : null;
  if (!date || (!fii && !dii)) return { day: null, problems: date || dates.size > 1 ? problems : [] };
  return { day: problems.length ? null : { date, fii, dii }, problems };
}

/** NSE fiidiiTradeReact JSON → one day. Accepts the array or { data: [...] }. null when the shape is not recognised or the
 *  payload fails a check (checkNseFiiDii says why). */
export function parseNseFiiDii(json: unknown): NseFiiDiiDay | null {
  return checkNseFiiDii(json).day;
}

// ── tiny HTML table reader (NSDL pages are plain server-rendered tables) ─────────

const ENT: Record<string, string> = { '&amp;': '&', '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
function clean(cell: string): string {
  return cell.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, (e) => ENT[e.toLowerCase()] ?? ' ').replace(/\s+/g, ' ').trim();
}
/** Every <tr> as an array of cell texts. */
export function htmlRows(html: string): string[][] {
  const out: string[][] = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(String(html || '')))) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(m[1]))) cells.push(clean(c[1]));
    out.push(cells);
  }
  return out;
}

export interface NsdlDailyRow { reportDate: string; buy: number; sell: number; net: number }

/** NSDL daily trends page (Latest / Monthly / Archive) → equity, stock-exchange route, one row per reporting date. */
export function parseNsdlDaily(html: string): NsdlDailyRow[] {
  const out: NsdlDailyRow[] = [];
  const seen = new Set<string>();
  for (const c of htmlRows(html)) {
    if (c.length < 6) continue;
    const date = ddMonYyyyToIso(c[0]);
    if (!date || !/^equity$/i.test(c[1]) || !/stock\s*exchange/i.test(c[2])) continue;
    const buy = parseInNumber(c[3]), sell = parseInNumber(c[4]), net = parseInNumber(c[5]);
    if (buy == null || sell == null || net == null || seen.has(date)) continue;
    if (sideProblems('NSDL', { buy, sell, net }).length) continue;   // zzz1067 (F03): an inconsistent row is not stored
    seen.add(date);
    out.push({ reportDate: date, buy, sell, net });
  }
  return out.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

/** The weekday before `iso` that is not a holiday (NSDL reporting date → trading day it covers). */
export function prevTradingDay(iso: string, isHoliday: (iso: string) => boolean): string {
  const d = new Date(`${iso}T00:00:00Z`);
  for (let i = 0; i < 15; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const wd = d.getUTCDay();
    const s = d.toISOString().slice(0, 10);
    if (wd !== 0 && wd !== 6 && !isHoliday(s)) return s;
  }
  return d.toISOString().slice(0, 10);
}

export interface NsdlTradeRow extends NsdlDailyRow { tradeDate: string }
/** Files every NSDL row under the trading day its trades happened. Two rows never land on the same day (when the holiday
 *  list is incomplete the later row keeps the day and the earlier one steps back further). */
export function nsdlTradeDates(rows: NsdlDailyRow[], isHoliday: (iso: string) => boolean): NsdlTradeRow[] {
  const sorted = [...rows].sort((a, b) => b.reportDate.localeCompare(a.reportDate));   // newest first
  const used = new Set<string>();
  const out: NsdlTradeRow[] = [];
  for (const r of sorted) {
    let t = prevTradingDay(r.reportDate, isHoliday);
    for (let k = 0; k < 5 && used.has(t); k++) t = prevTradingDay(t, isHoliday);
    if (used.has(t)) continue;
    used.add(t);
    out.push({ ...r, tradeDate: t });
  }
  return out.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

// ── fortnightly sector report ─────────────────────────────────────────────────

export interface SectorReportLink { date: string; url: string }
const SECTOR_BASE = 'https://www.fpi.nsdl.co.in/web/StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/';

/** NSDL FPI_Fortnightly_Selection.aspx → every report (newest first). */
export function parseSectorReportList(html: string): SectorReportLink[] {
  const out: SectorReportLink[] = [];
  const seen = new Set<string>();
  const re = /<option[^>]*value="([^"]*Fortnightly_Sector_wise_FII_Investment_Data\/([^"]+\.html?))"[^>]*>([^<]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(html || '')))) {
    const date = monthDayYearToIso(m[3]);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    out.push({ date, url: SECTOR_BASE + m[2] });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export interface SectorRow { sector: string; aucCr: number; netCr: number; netPrevCr: number | null }
export interface SectorReport {
  reportDate: string;          // end of the fortnight (AUC date)
  fortnight: string;           // e.g. 'September 16-30, 2026'
  sectors: SectorRow[];        // equity only, ₹ crore
  total: SectorRow | null;     // 'Grand Total' row
}

/** One fortnightly report → equity AUC + equity net investment per sector (₹ crore). Works for the 24-column (2022+) and the
 *  older 5-column layouts: each of the 4 periods has an INR block then a USD block; equity is the first column of a block. */
export function parseSectorReport(html: string): SectorReport | null {
  const rows = htmlRows(html);
  let header: string[] | null = null;
  for (const r of rows) {
    const t = r.filter(Boolean);
    if (t.length === 4 && /AUC as on/i.test(t[0]) && /AUC as on/i.test(t[3])) { header = t; break; }
  }
  if (!header) return null;
  const reportDate = monthDayYearToIso(header[3]);
  if (!reportDate) return null;
  const fortnight = header[2].replace(/^\s*Net Investment\s*/i, '').trim();
  const sectors: SectorRow[] = [];
  let total: SectorRow | null = null;
  for (const c of rows) {
    if (c.length < 22 || (c.length - 2) % 8 !== 0) continue;
    const w = (c.length - 2) / 8;                         // columns per currency block
    const name = c[1].replace(/\d+$/, '').trim();          // 'Others4' (footnote marker) → 'Others'
    const isTotal = /grand\s*total/i.test(name);
    if (!isTotal && !/^\d+$/.test(c[0])) continue;         // header rows / sub-rows
    const auc = parseInNumber(c[2 + 3 * 2 * w]);
    const net = parseInNumber(c[2 + 2 * 2 * w]);
    const prev = parseInNumber(c[2 + 1 * 2 * w]);
    if (auc == null || net == null || !name) continue;
    const row: SectorRow = { sector: isTotal ? 'Total' : name, aucCr: auc, netCr: net, netPrevCr: prev };
    if (isTotal) total = row; else sectors.push(row);
  }
  if (!sectors.length) return null;
  return { reportDate, fortnight, sectors, total };
}

/**
 * zzz1067 (F03) — the sectors must add up to the report's own Grand Total (holding and fortnight net, within rounding).
 * Returns the reasons a report is NOT consistent; an empty list = usable. A report without a Grand Total row cannot be checked
 * and is accepted (older layouts). Negative holdings and a sector listed twice are never accepted.
 */
export function sectorReportProblems(rep: SectorReport): string[] {
  const out: string[] = [];
  if (rep.sectors.some((s) => s.aucCr < 0)) out.push('a sector has a negative holding');
  if (new Set(rep.sectors.map((s) => s.sector)).size !== rep.sectors.length) out.push('a sector appears twice');
  if (!rep.total) return out;
  const auc = rep.sectors.reduce((a, s) => a + s.aucCr, 0);
  const net = rep.sectors.reduce((a, s) => a + s.netCr, 0);
  const aucTol = Math.max(100, Math.abs(rep.total.aucCr) * 0.005);
  const netTol = Math.max(50, Math.abs(rep.total.netCr) * 0.02, Math.abs(rep.total.aucCr) * 0.0001);
  if (Math.abs(auc - rep.total.aucCr) > aucTol) out.push(`sector holdings add up to ${round2(auc)}, the report total says ${rep.total.aucCr}`);
  if (Math.abs(net - rep.total.netCr) > netTol) out.push(`sector net flows add up to ${round2(net)}, the report total says ${rep.total.netCr}`);
  return out;
}

// ── zzz1060: NSE participant-wise open interest (daily archive CSV) ──────────────
//   https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_<DDMMYYYY>.csv — contracts held at the day's close by
//   Client / DII / FII / Pro. Line 1: '"Participant wise Open Interest ... as on Oct 14, 2026"'; line 2 the column names.

export interface OiPosition {
  futIdxLong: number; futIdxShort: number; futStkLong: number; futStkShort: number;
  optIdxCallLong: number; optIdxPutLong: number; optIdxCallShort: number; optIdxPutShort: number;
}
export interface ParticipantOiDay { date: string; byParticipant: Record<string, OiPosition> }

const OI_COLS: Array<[keyof OiPosition, RegExp]> = [
  ['futIdxLong', /^future\s*index\s*long$/i], ['futIdxShort', /^future\s*index\s*short$/i],
  ['futStkLong', /^future\s*stock\s*long$/i], ['futStkShort', /^future\s*stock\s*short$/i],
  ['optIdxCallLong', /^option\s*index\s*call\s*long$/i], ['optIdxPutLong', /^option\s*index\s*put\s*long$/i],
  ['optIdxCallShort', /^option\s*index\s*call\s*short$/i], ['optIdxPutShort', /^option\s*index\s*put\s*short$/i],
];

/** 'DDMMYYYY' for the archive file name. */
export const oiFileDate = (iso: string) => `${iso.slice(8, 10)}${iso.slice(5, 7)}${iso.slice(0, 4)}`;
export const participantOiUrl = (iso: string) => `https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${oiFileDate(iso)}.csv`;

/** Participant OI CSV → the day's positions per participant (Client / DII / FII / Pro). null when the layout is not recognised. */
export function parseParticipantOi(csv: string): ParticipantOiDay | null {
  const lines = String(csv || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 3) return null;
  const date = monthDayYearToIso(lines[0]);
  if (!date) return null;
  const head = lines[1].split(',').map((h) => h.replace(/"/g, '').trim());
  const idx: Partial<Record<keyof OiPosition, number>> = {};
  for (const [k, re] of OI_COLS) {
    const i = head.findIndex((h) => re.test(h));
    if (i < 0) return null;
    idx[k] = i;
  }
  const by: Record<string, OiPosition> = {};
  for (const l of lines.slice(2)) {
    const c = l.split(',').map((x) => x.replace(/"/g, '').trim());
    const who = String(c[0] || '').toUpperCase();
    if (!/^(CLIENT|DII|FII|PRO)$/.test(who)) continue;
    const pos = {} as OiPosition;
    let bad = false;
    for (const [k] of OI_COLS) {
      const v = parseInNumber(c[idx[k]!]);
      if (v == null) { bad = true; break; }
      pos[k] = v;
    }
    if (!bad) by[who === 'CLIENT' ? 'Client' : who === 'PRO' ? 'Pro' : who] = pos;
  }
  if (!by.FII) return null;
  return { date, byParticipant: by };
}

// ── zzz1060: NSDL FPI asset-class split (equity / debt / hybrid) per reporting date ──────────────────────────────────────
// The daily trends page (Latest and Archive) lists, per reporting date, Equity, Debt-General Limit, Debt-VRR, Debt-FAR,
// Hybrid, Mutual Funds and AIFs, each with a 'Stock Exchange' row, a 'Primary market & others' row and a 'Sub-total'. Older
// pages may have no sub-total — then the route rows are added up. The derivatives table further down is ignored.

export interface AssetMixRow { reportDate: string; equityNet: number | null; debtNet: number | null; hybridNet: number | null }

const bucketOf = (label: string): 'equity' | 'debt' | 'hybrid' | 'other' | null => {
  if (/^equity$/i.test(label)) return 'equity';
  if (/^debt(\s*-.*)?$/i.test(label)) return 'debt';   // 'Debt', 'Debt-General Limit', 'Debt-VRR' — not MF 'Debt schemes'
  if (/^hybrid$/i.test(label)) return 'hybrid';
  if (/^(mutual funds|aifs?)$/i.test(label)) return 'other';
  return null;
};

export function parseNsdlAssetMix(html: string): AssetMixRow[] {
  const per = new Map<string, Map<string, { bucket: string; routes: number; sub: number | null }>>();   // date → label → sums
  let date: string | null = null, label: string | null = null;
  for (const c0 of htmlRows(html)) {
    if (!c0.length) continue;
    let cells = c0;
    const d = ddMonYyyyToIso(c0[0]);
    if (d) { date = d; label = null; cells = c0.slice(1); }
    else if (/^total/i.test(c0[0])) { if (/^total for/i.test(c0[0])) date = null; label = null; continue; }
    if (!date || !cells.length) continue;
    const b = bucketOf(cells[0]);
    let net: number | null;
    let kind: 'route' | 'sub';
    if (b) { label = cells[0]; net = parseInNumber(cells[4]); kind = 'route'; }
    else if (/^sub-?\s*total$/i.test(cells[0])) { net = parseInNumber(cells[3]); kind = 'sub'; }
    else if (/primary|stock\s*exchange/i.test(cells[0])) { net = parseInNumber(cells[3]); kind = 'route'; }
    else continue;
    if (!label || net == null) continue;
    if (!per.has(date)) per.set(date, new Map());
    const m = per.get(date)!;
    if (!m.has(label)) m.set(label, { bucket: bucketOf(label)!, routes: 0, sub: null });
    const a = m.get(label)!;
    if (kind === 'sub') a.sub = net; else a.routes += net;
  }
  const out: AssetMixRow[] = [];
  for (const [d, m] of per) {
    const sum = (bk: string) => {
      const xs = [...m.values()].filter((x) => x.bucket === bk);
      return xs.length ? round2(xs.reduce((s, x) => s + (x.sub ?? x.routes), 0)) : null;
    };
    const row: AssetMixRow = { reportDate: d, equityNet: sum('equity'), debtNet: sum('debt'), hybridNet: sum('hybrid') };
    if (row.equityNet != null || row.debtNet != null) out.push(row);
  }
  return out.sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}
