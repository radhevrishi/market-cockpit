// ═══════════════════════════════════════════════════════════════════════════
// AI DAILY GAINERS — THE US SIDE, AS PURE FUNCTIONS.               (zzz766)
//
// A QA pass against the live deployment on 22 Sep 2026 found the "US" gainers
// list was not a US small/mid-cap list at all:
//
//   · 15 of 52 rows were INDIAN listings (NSE/BSE). The TradingView screen is
//     multi-market, the route never read the Exchange column, and each Indian
//     row was then looked up in SEC EDGAR and printed as "source failed".
//   · 17 of the remaining 37 were large or mega caps — META ($1.9T), AMD,
//     INTC, QCOM, SHOP, NET… The owner wants small and mid caps only.
//   · Two tickers appeared twice (the same company on NSE and BSE).
//   · An 8-K "Item 1.01 Entry into a Material Definitive Agreement" was
//     labelled `order_win` — for PRTH it was a take-private MERGER agreement,
//     for DOCN an equipment-finance facility. A 424B3 prospectus was a
//     positive "fundraising" catalyst. An 8-K Item 2.02 earnings release was
//     filed away as routine paperwork.
//   · The "synced at" time was the file's mtime, i.e. the DEPLOY time, not
//     the time TradingView was read.
//
// Everything here is pure (no network, no KV) so each of those is a test.
// ═══════════════════════════════════════════════════════════════════════════

import type { AnnouncementLite, ClassifiedAnnouncement } from './catalyst-research';

// ── 1. THE CAP BANDS ───────────────────────────────────────────────────────
// Conventional US bands, in $ M. Small/mid = $300M–$10B. Micro ($50M–$300M)
// is kept and tagged — a $250M name moving 30% on an 8-K is exactly what the
// owner wants to see — but nano (< $50M) and sub-$1 prints are noise.
export const US_CAP_BANDS_M = { nanoMax: 50, microMax: 300, smallMax: 2_000, midMax: 10_000, largeMax: 200_000 } as const;
export const US_PENNY_PRICE = 1;

export type UsCapTier = 'nano' | 'micro' | 'small' | 'mid' | 'large' | 'mega';

export function capTierUs(mcapM: number | null | undefined): UsCapTier | null {
  if (mcapM == null || !Number.isFinite(mcapM) || mcapM <= 0) return null;
  const b = US_CAP_BANDS_M;
  return mcapM < b.nanoMax ? 'nano' : mcapM < b.microMax ? 'micro' : mcapM < b.smallMax ? 'small'
    : mcapM <= b.midMax ? 'mid' : mcapM <= b.largeMax ? 'large' : 'mega';
}

/** $ M → "$643M", "$2.1B", "$1.90T". */
export function fmtUsdM(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '-' : '';
  if (a >= 1_000_000) return `${s}$${(a / 1_000_000).toFixed(2)}T`;
  if (a >= 1_000) return `${s}$${(a / 1_000).toFixed(a >= 100_000 ? 0 : 1)}B`;
  if (a >= 100) return `${s}$${Math.round(a)}M`;
  return `${s}$${a.toFixed(1)}M`;
}

// ── 2. THE EXPORT ──────────────────────────────────────────────────────────

/** Minimal CSV reader — the TradingView export quotes any field containing a
 *  comma, and a naive split on "," corrupts every company description. */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { cur.push(field); field = ''; }
    else if (c === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || cur.length) { cur.push(field); rows.push(cur); }
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.length > 1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const num = (v: unknown): number | null => {
  const s = String(v ?? '').replace(/[, ]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export interface UsExportRow {
  ticker: string; company: string; exchange: string;
  movePct: number | null; relVol: number | null; gapPct: number | null;
  volume: number | null; price: number | null; marketCap: number | null;   // $ M
  perf: { w1?: number | null; m1: number | null; m3: number | null; m6: number | null; y1: number | null };
}

/** One TradingView record → a row. The move is the 1-WEEK column and ONLY
 *  that: the first version fell back to the 1-month column when the week was
 *  blank and printed it under a "1W MOVE" header. */
export function usRowFromRecord(r: Record<string, string>): UsExportRow {
  const mcap = num(r['Market capitalization']);
  return {
    ticker: String(r['Symbol'] || '').trim().toUpperCase(),
    company: r['Description'] || '',
    exchange: String(r['Exchange'] || '').trim().toUpperCase(),
    movePct: num(r['Performance %, 1 week']),
    relVol: num(r['Relative volume, 1 week']),
    gapPct: num(r['Gap']),
    volume: num(r['Volume']),
    price: num(r['Price']),
    marketCap: mcap != null ? mcap / 1e6 : null,
    perf: {
      m1: num(r['Performance %, 1 month']), m3: num(r['Performance %, 3 months']),
      m6: num(r['Performance %, 6 months']), y1: num(r['Performance % 1 year'] ?? r['Performance %, 1 year']),
    },
  };
}

// US exchange listings. OTC is deliberately NOT here: an OTC quote is not an
// exchange listing, files little or nothing with the SEC, and is noise here.
const US_EXCHANGES = new Set(['NASDAQ', 'NYSE', 'AMEX', 'NYSE AMERICAN', 'NYSEAMERICAN', 'NYSE MKT', 'NYSE ARCA', 'NYSEARCA', 'ARCA', 'CBOE', 'BATS']);

export interface UsScreenedRow extends UsExportRow { capTier: UsCapTier; flags: string[] }
export interface UsExclusion { ticker: string; exchange: string; reason: string; kind: 'non_us' | 'otc' | 'duplicate' | 'not_common' | 'no_move' | 'not_gainer' | 'no_mcap' | 'large_cap' | 'nano_cap' | 'penny' }

/**
 * The owner's universe: US exchange-listed common stock, small or mid cap,
 * that actually went UP over the window. Every row that is dropped is
 * returned with its reason, so "20 of 52 kept" can be checked.
 */
/** zzz797 — the owner's own scan criteria override the fixed small/mid bands
 *  here, so a name his screener asked for is never dropped again downstream.
 *  Omitted = the original small/mid rules. Values in $ M. */
export interface UsScreenOptions { maxMcapM?: number | null; minMcapM?: number | null; minPrice?: number | null; allowOtc?: boolean; allowPreferred?: boolean }

export function screenUsGainers(rows: UsExportRow[], opts: UsScreenOptions = {}): { kept: UsScreenedRow[]; excluded: UsExclusion[] } {
  // undefined → the fixed rule; null → no bound (the owner removed it).
  const ceilingM = opts.maxMcapM === undefined ? US_CAP_BANDS_M.midMax : opts.maxMcapM;
  const floorM = opts.minMcapM === undefined ? US_CAP_BANDS_M.nanoMax : Math.min(opts.minMcapM ?? 0, US_CAP_BANDS_M.nanoMax);
  const pennyFloor = opts.minPrice === undefined || opts.minPrice === null ? US_PENNY_PRICE : Math.min(opts.minPrice, US_PENNY_PRICE);
  const kept: UsScreenedRow[] = [];
  const excluded: UsExclusion[] = [];
  const seen = new Set<string>();
  const ex = (r: UsExportRow, kind: UsExclusion['kind'], reason: string) => excluded.push({ ticker: r.ticker, exchange: r.exchange, kind, reason });
  for (const r of rows) {
    if (!r.ticker) continue;
    if (/^OTC/.test(r.exchange) && !opts.allowOtc) { ex(r, 'otc', 'OTC quote, not an exchange listing'); continue; }
    if (!US_EXCHANGES.has(r.exchange) && !(opts.allowOtc && /^OTC/.test(r.exchange))) { ex(r, 'non_us', `not a US listing (${r.exchange || 'no exchange'})`); continue; }
    if (seen.has(r.ticker)) { ex(r, 'duplicate', 'duplicate row'); continue; }
    seen.add(r.ticker);
    if (/\bwarrants?\b|\bunits?\b|\brights?\b|\bnotes? due\b/i.test(r.company) || /[.\-/](WS|W|WT|U|UN|R|RT)$/.test(r.ticker)
      || (!opts.allowPreferred && (/\bpreferred\b|\bdepositary shares?,? each representing\b/i.test(r.company) || /[.\-/]P[A-Z]?$/.test(r.ticker)))) {
      ex(r, 'not_common', 'warrant / unit / right / preferred — not common stock'); continue;
    }
    if (r.movePct == null) { ex(r, 'no_move', 'no 1-week move in the export'); continue; }
    if (r.movePct <= 0) { ex(r, 'not_gainer', `not a gainer on the window (${r.movePct.toFixed(1)}%)`); continue; }
    const tier = capTierUs(r.marketCap);
    if (!tier) { ex(r, 'no_mcap', 'market cap missing — small/mid cannot be confirmed'); continue; }
    if (ceilingM != null && r.marketCap! > ceilingM) { ex(r, 'large_cap', `${tier} cap (${fmtUsdM(r.marketCap)}) — above the ${fmtUsdM(ceilingM)} ceiling`); continue; }
    if (r.marketCap! < floorM) { ex(r, 'nano_cap', `nano cap (${fmtUsdM(r.marketCap)}) — below the ${fmtUsdM(floorM)} floor`); continue; }
    if (r.price != null && r.price < pennyFloor) { ex(r, 'penny', `penny stock ($${r.price.toFixed(2)})`); continue; }
    const flags: string[] = [];
    if (/\bacquisition corp|\bblank check\b|\bspac\b/i.test(r.company)) flags.push('SPAC');
    if (/\bADRs?\b|\bADS\b|american depositary/i.test(r.company)) flags.push('ADR');
    kept.push({ ...r, capTier: tier, flags });
  }
  return { kept, excluded };
}

/** One sentence for the notes: what was dropped and why, with examples. */
export function describeExclusions(excluded: UsExclusion[], total: number, kept: number, universe?: string): string | null {
  if (!excluded.length) return null;
  const by = new Map<string, UsExclusion[]>();
  for (const e of excluded) { if (!by.has(e.kind)) by.set(e.kind, []); by.get(e.kind)!.push(e); }
  const label: Record<UsExclusion['kind'], string> = {
    non_us: 'non-US listings', otc: 'OTC quotes', duplicate: 'duplicate rows', not_common: 'warrants/units/preferred',
    no_move: 'rows with no 1-week move', not_gainer: 'names that did not rise', no_mcap: 'rows with no market cap',
    large_cap: 'large/mega caps (> $10B)', nano_cap: 'nano caps (< $50M)', penny: 'sub-$1 prints',
  };
  const parts = Array.from(by.entries()).map(([k, v]) => {
    const names = Array.from(new Set(v.map((e) => e.ticker)));
    return `${v.length} ${label[k as UsExclusion['kind']]} (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''})`;
  });
  return universe
    ? `Kept ${kept} of ${total} scanned rows (${universe}). Excluded: ${parts.join('; ')}.`
    : `Kept ${kept} of ${total} export rows as US-listed small/mid-cap gainers ($50M–$10B). Excluded: ${parts.join('; ')}.`;
}

// ── 3. THE US SESSION CALENDAR ─────────────────────────────────────────────
// NYSE full-day holidays. Weekends are excluded separately. Keep in sync each
// year from nyse.com/markets/hours-calendars.
export const NYSE_HOLIDAYS = new Set<string>([
  '2025-01-01', '2025-01-09', '2025-01-20', '2025-02-17', '2025-04-18', '2025-05-26', '2025-06-19', '2025-07-04', '2025-09-01', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
/** 1:00 pm ET closes. */
export const NYSE_EARLY_CLOSES = new Set<string>(['2025-07-03', '2025-11-28', '2025-12-24', '2026-11-27', '2026-12-24', '2027-11-26']);

interface EtParts { ymd: string; minutes: number; weekday: number; hhmm: string }
export function etParts(d: Date): EtParts {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short',
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value || '';
  const hour = parseInt(g('hour'), 10) % 24, minute = parseInt(g('minute'), 10);
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { ymd: `${g('year')}-${g('month')}-${g('day')}`, minutes: hour * 60 + minute, weekday: wd, hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` };
}

/** "2026-09-10T16:05:38-04:00" — an ISO stamp whose first ten characters
 *  are the EASTERN date, so a filing accepted at 21:17 ET is not shown under
 *  the next day's UTC date. */
export function toEtIso(d: Date): string {
  const e = etParts(d);
  const off = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' })
    .formatToParts(d).find((x) => x.type === 'timeZoneName')?.value || 'GMT-5';
  const m = /GMT([+-])(\d{1,2})(?::(\d{2}))?/.exec(off);
  const sign = m ? m[1] : '-', hh = m ? m[2].padStart(2, '0') : '05', mm = m && m[3] ? m[3] : '00';
  const sec = String(d.getUTCSeconds()).padStart(2, '0');
  return `${e.ymd}T${e.hhmm}:${sec}${sign}${hh}:${mm}`;
}

/** The US Eastern calendar date — the day key a US sweep is filed under. */
export function etToday(now: Date = new Date()): string { return etParts(now).ymd; }

const addDays = (ymd: string, n: number): string => {
  const t = Date.parse(`${ymd}T12:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};
const weekdayOf = (ymd: string): number => new Date(`${ymd}T12:00:00Z`).getUTCDay();

export function isNyseTradingDay(ymd: string): boolean {
  const wd = weekdayOf(ymd);
  return wd !== 0 && wd !== 6 && !NYSE_HOLIDAYS.has(ymd);
}
export function prevNyseSession(ymd: string): string {
  let d = addDays(ymd, -1);
  for (let i = 0; i < 10 && !isNyseTradingDay(d); i++) d = addDays(d, -1);
  return d;
}
const closeMinutes = (ymd: string) => (NYSE_EARLY_CLOSES.has(ymd) ? 13 * 60 : 16 * 60);

export type UsPhase = 'pre_market' | 'regular' | 'after_hours' | 'closed_day';
export function usPhaseAt(d: Date): UsPhase {
  const e = etParts(d);
  if (!isNyseTradingDay(e.ymd)) return 'closed_day';
  if (e.minutes < 9 * 60 + 30) return 'pre_market';
  if (e.minutes < closeMinutes(e.ymd)) return 'regular';
  return 'after_hours';
}

/** The most recent session whose CLOSE has happened by `d`. */
export function lastCompletedNyseSession(d: Date): string {
  const e = etParts(d);
  if (isNyseTradingDay(e.ymd) && e.minutes >= closeMinutes(e.ymd)) return e.ymd;
  return prevNyseSession(e.ymd);
}

/** Trading sessions strictly after `a` up to and including `b`. */
export function nyseSessionsBetween(a: string, b: string): number {
  let n = 0;
  for (let d = addDays(a, 1), i = 0; d <= b && i < 400; d = addDays(d, 1), i++) if (isNyseTradingDay(d)) n++;
  return n;
}

export interface UsExportAsOf {
  synced_at: string;          // ISO, the moment TradingView was read
  synced_et: string;          // "Tue 2026-09-22 13:12 ET"
  phase: UsPhase;             // the US session phase at that moment
  session: string;            // the session whose prices the export reflects
  intraday: boolean;          // read while the session was open — not a close
  sessions_behind: number;    // completed sessions since `session`
  stale: boolean;
  label: string;
}

/**
 * What the export's prices ARE. The TradingView sync runs on an IST schedule,
 * so a US read is usually taken before the US open (it then reflects the
 * PREVIOUS close) and occasionally mid-session (an intraday snapshot). Saying
 * "today's gainers" in either case would be wrong; this says which.
 */
export function describeUsExportAsOf(syncIso: string, now: Date = new Date()): UsExportAsOf | null {
  const t = Date.parse(syncIso);
  if (!Number.isFinite(t)) return null;
  const at = new Date(t);
  const e = etParts(at);
  const phase = usPhaseAt(at);
  const intraday = phase === 'regular';
  const session = intraday ? e.ymd : lastCompletedNyseSession(at);
  const lastDone = lastCompletedNyseSession(now);
  const behind = intraday
    ? (lastDone >= session ? nyseSessionsBetween(session, lastDone) : 0)
    : nyseSessionsBetween(session, lastDone);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const synced_et = `${days[e.weekday] || ''} ${e.ymd} ${e.hhmm} ET`;
  const what = intraday
    ? `an intraday snapshot of the ${session} session (read at ${e.hhmm} ET, market open) — not a close`
    : phase === 'pre_market' ? `the ${session} close (read ${e.hhmm} ET, before the open)`
      : phase === 'after_hours' ? `the ${session} close (read ${e.hhmm} ET, after the close)`
        : `the ${session} close (read on a non-trading day)`;
  const stale = behind >= 1;
  const label = `US export reflects ${what}.${stale ? ` ${behind} US session${behind === 1 ? ' has' : 's have'} closed since — this is NOT the latest session.` : ''}`;
  return { synced_at: at.toISOString(), synced_et, phase, session, intraday, sessions_behind: behind, stale, label };
}

// ── 4. EDGAR ───────────────────────────────────────────────────────────────

/** Ticker spellings to try against the SEC map: "BRK.B" is "BRK-B" there. */
export function secTickerCandidates(ticker: string): string[] {
  const t = ticker.toUpperCase().trim();
  return Array.from(new Set([t, t.replace(/[./]/g, '-'), t.replace(/[.\-/].*$/, '')])).filter(Boolean);
}

/** The link that opens the filing. With no primary document the filing
 *  index is the right target, never a bare directory. */
export function edgarFilingUrl(cik: string, accession: string, primaryDoc: string): string {
  const cikNum = String(parseInt(cik, 10));
  const accDash = accession.includes('-') ? accession : accession.replace(/^(\d{10})(\d{2})(\d{6})$/, '$1-$2-$3');
  const acc = accDash.replace(/-/g, '');
  return primaryDoc
    ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${primaryDoc}`
    : `https://www.sec.gov/Archives/edgar/data/${cikNum}/${acc}/${accDash}-index.htm`;
}

export const EDGAR_8K_ITEMS: Record<string, string> = {
  '1.01': 'Entry into a Material Definitive Agreement', '1.02': 'Termination of a Material Definitive Agreement',
  '1.05': 'Material Cybersecurity Incidents',
  '2.01': 'Completion of Acquisition or Disposition of Assets', '2.02': 'Results of Operations and Financial Condition',
  '2.03': 'Creation of a Direct Financial Obligation', '2.04': 'Triggering Events That Accelerate a Financial Obligation',
  '2.05': 'Costs Associated with Exit or Disposal Activities',
  '2.06': 'Material Impairments', '3.01': 'Notice of Delisting or Failure to Satisfy a Continued Listing Rule',
  '3.02': 'Unregistered Sales of Equity Securities', '3.03': 'Material Modification to Rights of Security Holders',
  '4.01': "Changes in Registrant's Certifying Accountant",
  '4.02': 'Non-Reliance on Previously Issued Financial Statements', '5.01': 'Changes in Control of Registrant',
  '5.02': 'Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers',
  '5.03': 'Amendments to Articles of Incorporation or Bylaws', '5.07': 'Submission of Matters to a Vote of Security Holders',
  '7.01': 'Regulation FD Disclosure', '8.01': 'Other Events', '9.01': 'Financial Statements and Exhibits',
};

/** Forms that are insider mechanics and arrive by the dozen. */
export const EDGAR_SKIP_FORMS = /^(3|4|5|144)(\/A)?$/;

/** Forms filed as merger / tender communications. An 8-K whose document is
 *  ALSO filed under one of these on the same day is a business combination. */
const MERGER_COMPANION = /^(DEFA14A|425|SC TO-C|SC 14D9-C|DEFM14A|PREM14A)$/;
export const MERGER_MARKER = 'also filed as merger communication';
/** zzz785: written into a 13G/13D subject by edgar-research after the
 *  ownership report was READ and names an operating company as holder. */
export const STRATEGIC_STAKE_MARKER = 'strategic holder stake';

function phrase(p: UsPhase): string {
  return p === 'pre_market' ? 'before the open' : p === 'regular' ? 'during the session' : p === 'after_hours' ? 'after the close' : 'on a non-trading day';
}

// ── 8-K ITEMS IN PLAIN ENGLISH                                    (zzz782) ──
// The subject used to be the SEC item titles strung together — "8-K: Business
// combination agreement … — Item 1.01 Entry into a Material Definitive
// Agreement; Item 9.01 Financial Statements and Ex…" — which the page cut off
// mid-word. The subject now leads with what happened, in plain words, and
// keeps the item codes as a short bracket tag ("[Item 1.01, Item 9.01]") so
// the classifier and anyone checking the filing still see them. Item 9.01
// (exhibits) is never the event; it stays in the tag only.
const EIGHT_K_PLAIN: Record<string, string> = {
  '1.01': 'Material agreement signed (terms not stated in the item — open the filing)',
  '1.02': 'Material agreement terminated',
  '1.05': 'Material cybersecurity incident',
  '2.01': 'Acquisition or disposition completed',
  '2.02': 'Quarterly results released (results of operations)',
  '2.03': 'New debt or financing obligation',
  '2.04': 'Financial obligation accelerated',
  '2.05': 'Exit / restructuring costs',
  '2.06': 'Material impairment',
  '3.01': 'Notice of delisting / listing-rule deficiency',
  '3.02': 'Unregistered sale of equity (private placement)',
  '3.03': 'Change to shareholder rights',
  '4.01': 'Change of certifying accountant (auditor)',
  '4.02': 'Non-reliance on previously issued financial statements (restatement)',
  '5.01': 'Change in control',
  '5.02': 'Director / officer change',
  '5.03': 'Charter or bylaw amendment',
  '5.07': 'Shareholder vote results',
  '7.01': 'Regulation FD disclosure (press release / investor materials)',
  '8.01': 'Other events (company press release)',
};
// Which item leads when several are filed together: the one that is the
// event, not the paperwork around it.
const EIGHT_K_LEAD_ORDER = ['2.02', '2.01', '5.01', '1.01', '1.02', '3.01', '4.02', '4.01', '2.04', '2.06', '1.05', '3.02', '2.05', '2.03', '8.01', '7.01', '3.03', '5.02', '5.03', '5.07'];

/** "Business combination agreement signed", "Quarterly results released"… —
 *  the leading event of an 8-K, then at most two other substantive items. */
export function usEightKLead(items: string[], merger: boolean): string {
  const subst = items.filter((i) => i !== '9.01');
  const ordered = [
    ...EIGHT_K_LEAD_ORDER.filter((i) => subst.includes(i)),
    ...subst.filter((i) => !EIGHT_K_LEAD_ORDER.includes(i)),
  ];
  const parts: string[] = [];
  if (merger && items.includes('1.01')) parts.push(`Business combination agreement signed (${MERGER_MARKER})`);
  for (const i of ordered) {
    if (merger && i === '1.01') continue;
    parts.push(EIGHT_K_PLAIN[i] ? (parts.length ? EIGHT_K_PLAIN[i].replace(/ \(terms not stated in the item — open the filing\)$/, '') : EIGHT_K_PLAIN[i]) : `Item ${i}`);
    if (parts.length >= 3) break;
  }
  if (!parts.length) return items.includes('9.01') ? 'Financial statements and exhibits only' : 'no items listed';
  return parts.join('; also ');
}

/** Any 8-K subject — the old item-title list or the new plain form — in the
 *  plain form. Idempotent; non-8-K subjects are returned unchanged. Stored
 *  sweep inputs carry the old form, so findings re-scored from them are
 *  normalised here rather than refetched. */
export function usPlainSubject(subject: string): string {
  const s = String(subject || '');
  const m = /^(8-K(?:\/A)?):\s*([\s\S]*)$/i.exec(s);
  if (!m) return s;
  const rest = m[2];
  if (/\[Item \d\.\d\d/.test(rest)) return s;          // already plain
  const filedIdx = rest.indexOf(' · filed ');
  const filed = filedIdx >= 0 ? rest.slice(filedIdx) : '';
  const body = filedIdx >= 0 ? rest.slice(0, filedIdx) : rest;
  const items = usItemsOf(body);
  const merger = body.includes(MERGER_MARKER);
  if (!items.length && !merger) return s;
  return `${m[1].toUpperCase()}: ${usEightKLead(items, merger)}${items.length ? ` [${items.map((i) => `Item ${i}`).join(', ')}]` : ''}${filed}`;
}

/**
 * The submissions JSON → dated announcements, newest first. Pure: the fetch
 * lives in edgar-research.ts. `acceptanceDateTime` is UTC (a Form 4/A
 * accepted 01:17Z carries the PREVIOUS filing date, which is only possible if
 * the stamp is UTC), so the session a filing landed in is exact.
 */
export function announcementsFromSubmissions(sub: any, cik: string, windowDays: number, now: Date, stats?: { insiderForms: number; inWindow: number }): AnnouncementLite[] {
  const rec = sub?.filings?.recent || {};
  const n = Array.isArray(rec.form) ? rec.form.length : 0;
  const at = (k: string, i: number) => (Array.isArray(rec[k]) ? rec[k][i] : undefined);
  const rows: Array<{ form: string; date: string; acc: string; doc: string; items: string[]; desc: string; accepted: string }> = [];
  for (let i = 0; i < n; i++) {
    const form = String(at('form', i) || '').trim().toUpperCase();
    const date = String(at('filingDate', i) || '');
    if (!form || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const age = Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    if (!Number.isFinite(age) || age > windowDays) continue;
    if (stats) stats.inWindow++;
    // Insider ownership reports are counted, not listed: "nothing filed" and
    // "only Form 4s filed" are different statements. (zzz782)
    if (EDGAR_SKIP_FORMS.test(form)) { if (stats) stats.insiderForms++; continue; }
    rows.push({
      form, date,
      acc: String(at('accessionNumber', i) || ''),
      doc: String(at('primaryDocument', i) || ''),
      items: String(at('items', i) ?? '').split(',').map((x) => x.trim()).filter((x) => /^\d\.\d\d$/.test(x)),
      desc: String(at('primaryDocDescription', i) || ''),
      accepted: String(at('acceptanceDateTime', i) || ''),
    });
  }
  const out: AnnouncementLite[] = [];
  for (const r of rows) {
    if (!r.acc) continue;
    const accepted = Date.parse(r.accepted);
    const when = Number.isFinite(accepted) ? new Date(accepted) : null;
    const dateIso = when ? toEtIso(when) : `${r.date}T00:00:00Z`;
    const ageDays = Math.max(0, Math.floor((now.getTime() - Date.parse(dateIso)) / 86_400_000));
    const isCurrent = /^(8-K|8-K\/A)$/.test(r.form);
    const companion = isCurrent && r.items.includes('1.01') && rows.some((o) => o !== r && MERGER_COMPANION.test(o.form) && o.doc && o.doc === r.doc && o.date === r.date);
    // The same document re-filed as DEFA14A/425 beside its 8-K is one event.
    if (MERGER_COMPANION.test(r.form) && rows.some((o) => o !== r && /^8-K/.test(o.form) && o.doc && o.doc === r.doc && o.date === r.date)) continue;
    // zzz782: plain words first, item codes as a short tag (see usEightKLead).
    // The merger lead still goes FIRST so a shortened headline still says it.
    const itemTag = r.items.length ? ` [${r.items.map((it) => `Item ${it}`).join(', ')}]` : '';
    const base = isCurrent ? `${r.form}: ${usEightKLead(r.items, companion)}${itemTag}` : `${r.form}${r.desc && r.desc.toUpperCase() !== r.form ? `: ${r.desc}` : ''}`;
    const subject = `${base}${when ? ` · filed ${etParts(when).hhmm} ET ${phrase(usPhaseAt(when))}` : ''}`;
    out.push({ subject, summary: null, url: edgarFilingUrl(cik, r.acc, r.doc), dateIso, ageDays });
  }
  return out;
}

// ── 5. CLASSIFY A US FILING BY FORM AND 8-K ITEM ───────────────────────────
//
// The SEC's own taxonomy is better than any regex over a subject line, and
// it says what KIND of event a filing is — not whether it is good. So:
//   · Item 1.01 / 7.01 / 8.01 / 6-K are UNCLASSIFIED: a "material definitive
//     agreement" is as often a credit line or a merger as a customer contract.
//     The research route model-reads these; nothing is invented from the item.
//   · Offerings — 424B*, S-1, S-3, F-1/F-3, FWP, Form D, Item 3.02 — are
//     SUPPLY, so NEGATIVE (`dilution`), never a positive "fundraising".
//   · Item 2.02 / 10-Q / 10-K are the results — a real, dated catalyst whose
//     direction is not read here.
//   · Officer/director changes, bylaws, votes, proxies, 13G are paperwork.

type UsClass = Pick<ClassifiedAnnouncement, 'kind' | 'category' | 'stage' | 'routineReason'>;

const cat = (category: ClassifiedAnnouncement['category'], stage: ClassifiedAnnouncement['stage'] = 'executed'): UsClass => ({ kind: 'catalyst', category, stage, routineReason: null });
const neg = (category: ClassifiedAnnouncement['category'], why: string): UsClass => ({ kind: 'negative', category, stage: null, routineReason: why });
const routine = (why: string): UsClass => ({ kind: 'routine', category: null, stage: null, routineReason: why });
const unclassified: UsClass = { kind: 'unclassified', category: null, stage: null, routineReason: null };

export function usFormOf(subject: string): string {
  return (String(subject || '').split(/:| · /)[0] || '').trim().toUpperCase();
}
export function usItemsOf(subject: string): string[] {
  return Array.from(String(subject || '').matchAll(/Item (\d\.\d\d)/g)).map((m) => m[1]);
}

export function classifyUsFiling(a: Pick<AnnouncementLite, 'subject'>): UsClass | null {
  const form = usFormOf(a.subject);
  if (!form) return null;
  if (/^(424B\d|S-1|S-1\/A|S-1MEF|S-3|S-3\/A|S-3ASR|S-3MEF|F-1|F-1\/A|F-3|F-3\/A|F-3ASR|FWP|D|D\/A)$/.test(form)) {
    // zzz771: a 424B3 (resale prospectus / prospectus update) or an S-3 / F-3
    // shelf registers stock for sale without pricing a raise: a supply
    // overhang, not new proceeds and not the move's catalyst (USDE +111%
    // weekly on a 424B3 was classed "Fundraising, negative"). A 424B4/B5
    // takedown, an S-1 / F-1 that is not a resale, an FWP or a Form D is a
    // new raise. The view reads the words "resale / shelf" from this reason.
    const subj = String(a.subject || '');
    const resaleWords = /resale|selling (stock|share)holders?|secondary offering by/i.test(subj);
    if (form === 'D' || form === 'D/A') return neg('dilution', 'Form D — exempt (private) securities offering: a new raise');
    if (form === '424B3' || /^(S-3|F-3)/.test(form) || (/^(S-1|F-1)/.test(form) && resaleWords)) {
      return neg('dilution', `${form} — resale / shelf registration: supply overhang (shares may be sold; this does not by itself mean the price must fall), not a new raise`);
    }
    return neg('dilution', `${form} — prospectus for a securities offering: new supply, dilution`);
  }
  if (/^NT (10-[QK]|20-F)/.test(form)) return neg(null, `${form} — late periodic filing`);
  // Forms 3/4/5 are insider ownership reports: who holds what, not an event. (zzz770)
  if (/^[345](\/A)?$/.test(form)) return routine(`Form ${form} — insider ownership report`);
  if (/^(SC 13D|SCHEDULE 13D)$/.test(form)) return cat('strategic_investor');
  if (/^(SC 13D|SCHEDULE 13D)\/A$/.test(form)) return routine('13D amendment — a holder\'s stake changed; direction not stated in the form type');
  // zzz785: a 13G / 13D whose DOCUMENT names an operating company as the
  // holder (Amazon's 5.3% of BETA) is a potential catalyst, not paperwork.
  // The marker is written by edgar-research only after the ownership report
  // itself was read — never from the form type.
  if (/^(SC 13[DG]|SCHEDULE 13[DG])(\/A)?$/.test(form) && String(a.subject || '').includes(STRATEGIC_STAKE_MARKER)) return cat('strategic_investor', 'enabling');
  if (/^(SC 13G|SCHEDULE 13G)(\/A)?$/.test(form)) return routine('13G — passive 5% holder');
  if (/^(SC TO-T|SC TO-T\/A|SC 14D9|SC 14D9\/A)$/.test(form)) return cat('open_offer');
  if (/^(SC TO-I|SC TO-I\/A)$/.test(form)) return cat('buyback');
  if (/^(425|S-4|S-4\/A|F-4|F-4\/A|DEFM14A|PREM14A|SC 13E3|SC 13E3\/A)$/.test(form)) return cat('acquisition');
  if (/^(10-Q|10-K|10-KT|20-F|40-F)$/.test(form)) return cat('quarterly_result');
  if (/^(10-Q|10-K|20-F|40-F)\/A$/.test(form)) return routine('amended periodic report');
  if (/^(DEF 14A|DEFA14A|DEFR14A|PRE 14A|PRER14A|DEFC14A|ARS|S-8|S-8 POS|8-A12B|8-A12G|CERT\S*|EFFECT|CORRESP|UPLOAD|POS AM|POSASR|10-D|SD|N-PX|11-K|IRANNOTICE|CT ORDER|DEL AM|RW|424H|25-NSE|15-12[BG]|S-3D)$/.test(form)) {
    return routine(form === 'EFFECT' ? 'registration declared effective (the registration itself is flagged)' : `${form} — administrative`);
  }
  if (form === '6-K' || form === '6-K/A') return unclassified;
  if (/^8-K(\/A)?$/.test(form)) {
    const it = new Set(usItemsOf(a.subject));
    // zzz785: the item is a routing hint — the reason says what to open for,
    // not a conclusion about size (shares, price and buyers come from the text).
    if (it.has('3.02')) return neg('dilution', 'Item 3.02 — unregistered sale of equity reported (dilution; shares, price and buyers are in the filing text, not the item)');
    if (it.has('3.01')) return neg(null, 'Item 3.01 — delisting notice / listing-rule deficiency');
    if (it.has('4.02')) return neg(null, 'Item 4.02 — prior financial statements can no longer be relied on');
    if (it.has('4.01')) return neg('auditor_resignation', 'Item 4.01 — change of auditor');
    if (it.has('2.04')) return neg('debt_stress', 'Item 2.04 — a financial obligation was accelerated');
    if (it.has('2.06')) return neg(null, 'Item 2.06 — material impairment');
    if (it.has('1.05')) return neg(null, 'Item 1.05 — material cybersecurity incident');
    if (it.has('2.05')) return neg(null, 'Item 2.05 — exit / disposal (restructuring) costs');
    if (it.has('1.01') && a.subject.includes(MERGER_MARKER)) return cat('acquisition');
    if (it.has('2.01')) return cat('acquisition');
    if (it.has('5.01')) return cat('acquisition');
    if (it.has('2.02')) return cat('quarterly_result');
    if (it.has('1.01') || it.has('1.02') || it.has('7.01') || it.has('8.01')) return unclassified;
    if (it.has('2.03')) return routine('Item 2.03 — a financing obligation (debt), not an operating event');
    if (it.size) return routine(`8-K ${Array.from(it).join(', ')} — governance / administrative`);
    return unclassified;
  }
  return null;
}

// ── 6. THE PRESS RELEASE, READ WITHOUT A MODEL                    (zzz782) ──
//
// An 8-K's substance is in its EX-99.1 press release, and the sweep used to
// leave it unopened unless a paid model read was available ("document not
// parsed" on PRTH's merger). This reads the text for a few narrowly defined
// statements and returns them VERBATIM, each with the sentence it came from:
//   · a stated deal / contract value ("transaction valued at approximately
//     $1.2 billion", "a $45 million contract"),
//   · a per-share cash price and a stated premium (merger terms),
//   · the revenue sentence of an earnings release, and a raised outlook,
//   · the closing conditions / expected timing.
// Nothing is inferred: a figure hedged as potential / up to / expected /
// estimated is dropped, and when no sentence matches the answer is null —
// never a guess. The lead sentence is returned too, for a filing the item
// code cannot classify (7.01 / 8.01 / 1.01 / 6-K).

export interface UsPressReleaseFacts {
  /** The first substantive sentence of the release (dateline stripped). */
  lead: string | null;
  /** $ M, only when a sentence states a deal / contract value outright. */
  valueM: number | null;
  /** The verbatim sentence the value came from. */
  valueSentence: string | null;
  /** The verbatim revenue sentence of an earnings release. */
  revenueSentence: string | null;
  facts: Record<string, string>;
}

const HEDGED = /\b(potential(ly)?|could|may|might|up to|ceiling|idiq|estimated|expected to (generate|be worth|reach)|anticipat\w+ (revenue|value)|opportunity|addressable|pipeline|target(ed|ing)?)\b/i;
const DEAL_NOUN = /\b(transaction|merger|acquisition|deal|agreement|contract|award|order|purchase|take-private|buyout|financing|offering|investment)\b/i;
const MONEY = String.raw`(?:US)?\$\s?([\d][\d,]*(?:\.\d+)?)\s*(billion|million|bn|mm|mn|b|m)\b`;
const VALUE_AFTER = new RegExp(String.raw`\b(valued at|valuing|value of|worth|total consideration of|aggregate consideration of|(?:aggregate )?purchase price of|total (?:cash )?consideration of|enterprise value of|equity value of|transaction value of|for a total of|in exchange for|in the amount of|totaling|totalling)\s+(?:approximately |about |roughly |an aggregate of |a total of )?` + MONEY, 'i');
const VALUE_BEFORE = new RegExp(MONEY + String.raw`\s+(?:all-cash |cash |all-stock |stock |multi-year |multiyear |\w+-year )?(transaction|acquisition|merger|deal|contract|award|order|take-private|buyout|agreement)\b`, 'i');
const PER_SHARE = /\$\s?(\d+(?:\.\d+)?)\s+per share(?:\s+in cash| in cash)?/i;
const PREMIUM = /premium of (?:approximately |about )?(\d+(?:\.\d+)?)\s?%/i;
const REVENUE = /\b(total |net )?(revenues?|net sales|sales)\b[^.]{0,60}?\b(of|was|were|totaled|totalled|reached|increased|grew|rose|decreased|declined|fell)\b[^.]{0,40}?\$\s?[\d][\d,]*(?:\.\d+)?\s*(billion|million)/i;
const OUTLOOK_UP = /\b(rais(es|ed|ing)|increas(es|ed|ing)|lift(s|ed)?)\b[^.]{0,40}\b(full[- ]year|fiscal(?: year)? ?\d{0,4}|annual|\d{4})?\s*(guidance|outlook)\b/i;
const CLOSING = /\b(expected to close|anticipated to close|subject to (customary|shareholder|stockholder|regulatory))\b/i;

function toM(n: string, unit: string): number | null {
  const v = parseFloat(n.replace(/,/g, ''));
  if (!Number.isFinite(v) || v <= 0) return null;
  return /^b/i.test(unit) ? v * 1000 : v;
}

/** Sentences of a filing's text, without the SEC cover-page noise. */
export function filingSentences(text: string): string[] { return sentencesOf(text); }
function sentencesOf(text: string): string[] {
  return String(text || '').slice(0, 40_000)
    .replace(/\s+/g, ' ')
    // zzz785: "Jane Q. Smith", "U.S. Army", "Mr. Crisafulli" are not sentence
    // ends; "Inc. (the “Company”)" / "Inc. (NASDAQ: X)" is not a new sentence; a cover-page check
    // box (☐) ends the cover and starts Item 1.01.
    // A release's dateline dash ("…, September 21, 2026 – Priority …") ends the headline block.
    .split(/\s*[☐☒]\s+|(?<=\b\d{4}(?:\s*\([^)]{1,40}\))?)\s+[-–—]{1,2}\s+(?=[A-Z])|(?<=(?<!\b(?:[A-Z]|Mr|Ms|Mrs|Dr|Jr|Sr|No|St))[.!?])\s+(?=[A-Z“"$])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 40 && s.length <= 700)
    .filter((s) => !/securities and exchange commission|check the appropriate box|commission file number|pursuant to section 13 or 15\(d\)|emerging growth company|forward-looking statements?|safe harbor|incorporated by reference|signature|exhibit (no\.|number)/i.test(s));
}

export function extractUsPressRelease(text: string): UsPressReleaseFacts {
  const out: UsPressReleaseFacts = { lead: null, valueM: null, valueSentence: null, revenueSentence: null, facts: {} };
  const ss = sentencesOf(text);
  if (!ss.length) return out;
  // The lead: the first sentence that reads like news — a dateline'd
  // announcement verb — else the first sentence after the cover page.
  const leadRaw = ss.find((s) => /\b(announce[sd]?|today|entered into|signed|completed|reported|received|awarded|launch(ed|es)|approv(ed|al))\b/i.test(s)) || null;
  out.lead = leadRaw ? leadRaw.replace(/^[A-Z][A-Za-z .,'-]{2,40},\s*[A-Z][a-z]{2,9}\.? \d{1,2},? \d{4}\s*(\([^)]{0,40}\))?\s*[-–—]+\s*/, '').slice(0, 400) : null;
  for (const s of ss) {
    if (out.valueM == null && DEAL_NOUN.test(s) && !HEDGED.test(s)) {
      const m = VALUE_AFTER.exec(s);
      const b = m ? null : VALUE_BEFORE.exec(s);
      const v = m ? toM(m[2], m[3]) : b ? toM(b[1], b[2]) : null;
      if (v != null) { out.valueM = v; out.valueSentence = s; out.facts.value = s.slice(0, 220); }
    }
    if (!out.facts.price_terms) {
      const p = PER_SHARE.exec(s);
      if (p && /\b(merger|acquir\w*|acquisition|transaction|tender offer|holders|stockholders|shareholders)\b/i.test(s)) {
        const prem = PREMIUM.exec(s);
        out.facts.price_terms = `$${p[1]} per share${/in cash/i.test(p[0]) ? ' in cash' : ''}${prem ? `, a ${prem[1]}% premium` : ''} — “${s.slice(0, 180)}”`;
      }
    }
    if (!out.revenueSentence && REVENUE.test(s) && !HEDGED.test(s)) { out.revenueSentence = s; out.facts.revenue = s.slice(0, 220); }
    if (!out.facts.guidance && OUTLOOK_UP.test(s)) out.facts.guidance = s.slice(0, 220);
    if (!out.facts.conditions && CLOSING.test(s)) out.facts.conditions = s.slice(0, 220);
  }
  return out;
}

// ── 7. FALLBACK LISTINGS → THE SUBMISSIONS SHAPE                  (zzz785) ──
//
// When data.sec.gov/submissions refuses or times out, the same filing list
// can be rebuilt from EDGAR full-text search or the www.sec.gov company Atom
// feed. Both are mapped into the submissions JSON shape so
// announcementsFromSubmissions stays the ONE mapping (and its tests hold).

type SubRow = { form: string; filingDate: string; accessionNumber: string; primaryDocument: string; items: string; primaryDocDescription: string; acceptanceDateTime: string };

function toSubmissions(rows: SubRow[]): any {
  const k = <K extends keyof SubRow>(key: K) => rows.map((r) => r[key]);
  return { filings: { recent: { form: k('form'), filingDate: k('filingDate'), accessionNumber: k('accessionNumber'), primaryDocument: k('primaryDocument'), items: k('items'), primaryDocDescription: k('primaryDocDescription'), acceptanceDateTime: k('acceptanceDateTime') } } };
}

/** efts.sec.gov/LATEST/search-index JSON → submissions shape. One row per
 *  accession (an exhibit hit is folded into its filing). */
export function submissionsFromFullText(json: any): any {
  const hits: any[] = json?.hits?.hits || [];
  const byAcc = new Map<string, SubRow & { primaryHit: boolean }>();
  for (const h of hits) {
    const src = h?._source || {};
    const acc = String(src.adsh || String(h?._id || '').split(':')[0] || '');
    const doc = String(h?._id || '').split(':')[1] || '';
    const form = String(src.form || src.root_forms?.[0] || '').toUpperCase();
    const date = String(src.file_date || '');
    if (!acc || !form || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const primaryHit = String(src.file_type || '').toUpperCase() === form;
    const row = { form, filingDate: date, accessionNumber: acc, primaryDocument: primaryHit ? doc : '', items: Array.isArray(src.items) ? src.items.join(',') : String(src.items || ''), primaryDocDescription: String(src.file_description || ''), acceptanceDateTime: '', primaryHit };
    const prev = byAcc.get(acc);
    if (!prev || (!prev.primaryHit && primaryHit)) byAcc.set(acc, row);
  }
  return toSubmissions(Array.from(byAcc.values()).sort((a, b) => b.filingDate.localeCompare(a.filingDate)));
}

/** www.sec.gov/cgi-bin/browse-edgar?…&output=atom → submissions shape. */
export function submissionsFromAtom(xml: string): any {
  const rows: SubRow[] = [];
  for (const m of String(xml || '').matchAll(/<entry>[\s\S]*?<\/entry>/gi)) {
    const e = m[0];
    const tag = (t: string) => (new RegExp(`<${t}>([\\s\\S]*?)<\\/${t}>`, 'i').exec(e)?.[1] || '').trim();
    const form = (tag('filing-type') || (/<category[^>]*term="([^"]+)"/i.exec(e)?.[1] || '')).toUpperCase();
    const acc = tag('accession-number') || tag('accession-nunber');
    const date = tag('filing-date');
    if (!form || !acc || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const items = Array.from(tag('items-desc').matchAll(/\d\.\d\d/g)).map((x) => x[0]).join(',');
    rows.push({ form, filingDate: date, accessionNumber: acc, primaryDocument: '', items, primaryDocDescription: tag('form-name'), acceptanceDateTime: tag('updated') });
  }
  return toSubmissions(rows);
}
