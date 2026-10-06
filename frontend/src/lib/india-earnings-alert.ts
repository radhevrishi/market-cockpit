// zzz911 — India earnings alerts, run by the app (rules only, no AI).
//
// Replaces three Claude scheduled tasks:
//   • "MC Earnings Alert" (hourly)  → app job `in-earnings-alert`: new BLOCKBUSTER / STRONG results that pass the Quality
//     Preset, sent once per company + filing date.
//   • "Earnings Watch — EOD" (21:00 IST) → app job `in-earnings-eod`: one message every weekday evening, even on a
//     quiet day — a missing message is the sign the watch needs a look.
//   • the intraday "Earnings Opportunities watch" — a duplicate of the hourly alert. Its own copy of the preset had
//     drifted (PEAD ≥ 60, the site uses 40). The only things it had that the hourly alert lacked — P/E and the filing
//     link — are carried into the hourly message here.
//
// "Passes" means EXACTLY what the site means: lib/quality-preset `isAlertable` (BLOCKBUSTER/STRONG + INDIA_PRESET),
// plus the small & mid ceiling the India Conviction Beats preset applies (`mktCapMax`, lib/small-mid-filter).
// No second copy of any threshold lives here.
//
// PURE: no fetch, no KV, no process.env. Data access is in india-earnings-alert-data.ts.

import { isAlertable } from '@/lib/quality-preset';
import { passesSmallMid } from '@/lib/small-mid-filter';

export interface IndiaAlertHit {
  ticker: string;
  company: string | null;
  tier: string;
  verdict: string | null;
  filing_date: string;
  quarter: string | null;
  market_cap_cr: number | null;
  sales_yoy_pct: number | null;
  net_profit_yoy_pct: number | null;
  eps_yoy_pct: number | null;
  opm_delta_pp: number | null;
  cfo_to_pat_ratio: number | null;
  pead_score: number | null;
  composite_score: number | null;
  fund_composite: number | null;
  setup_grade: string | null;
  caveat_tags: string[];
  pe: number | null;
  source_url: string | null;
  /** TICKER:FILING_DATE — one event per company per filing */
  alert_id: string;
}

export interface GradedDay {
  date: string;
  /** the KV key the payload came from, null when nothing usable was found */
  key: string | null;
  /** graded payload (already passed through the current India rules), null when missing */
  payload: any | null;
}

export interface ScannedDay { date: string; key: string | null; rows: number; alertable: number; candidates_total: number | null; raw_items_total: number | null }

/** Where the dedup memory lives (owner-notify adds its own prefix). */
export const HOURLY_KEY_PREFIX = 'in-earnings:';
export const EOD_KEY_PREFIX = 'in-earnings-eod:';
export const SITE = 'https://market-cockpit-production.up.railway.app';

const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function hitFromRow(r: any, date: string): IndiaAlertHit {
  const filing = String(r.filing_date ?? date).slice(0, 10);
  return {
    ticker: String(r.ticker),
    company: r.company ?? null,
    tier: String(r.tier || '').toUpperCase(),
    verdict: r.verdict ?? null,
    filing_date: filing,
    quarter: r.quarter ?? null,
    market_cap_cr: numOrNull(r.market_cap_cr),
    sales_yoy_pct: numOrNull(r.sales_yoy_pct),
    net_profit_yoy_pct: numOrNull(r.net_profit_yoy_pct),
    eps_yoy_pct: numOrNull(r.eps_yoy_pct),
    opm_delta_pp:
      typeof r.opm_pct === 'number' && typeof r.opm_prev_pct === 'number'
        ? Math.round((r.opm_pct - r.opm_prev_pct) * 10) / 10
        : null,
    cfo_to_pat_ratio: numOrNull(r.cfo_to_pat_ratio),
    pead_score: numOrNull(r.pead_score),
    composite_score: numOrNull(r.composite_score),
    fund_composite: numOrNull(r.fund_composite),
    setup_grade: r.setup_grade ?? null,
    caveat_tags: Array.isArray(r.caveat_tags) ? r.caveat_tags.map(String) : [],
    pe: numOrNull(r.pe),
    source_url: typeof r.source_url === 'string' && /^https?:\/\//.test(r.source_url) ? r.source_url : null,
    alert_id: `${r.ticker}:${filing}`,
  };
}

/** Best first: BLOCKBUSTER over STRONG, then the fundamentals-only score (the blend still carries the chart). */
export function rankHits<T extends { tier: string; fund_composite: number | null; composite_score: number | null }>(hits: T[]): T[] {
  const rank = (t: string) => (t === 'BLOCKBUSTER' ? 2 : 1);
  return [...hits].sort((a, b) =>
    rank(b.tier) - rank(a.tier) ||
    (b.fund_composite ?? b.composite_score ?? 0) - (a.fund_composite ?? a.composite_score ?? 0),
  );
}

/** Rows of a graded payload, all tiers. */
export function rowsOf(payload: any): any[] {
  return Object.values(payload?.by_tier || {}).flatMap((v: any) => (Array.isArray(v) ? v : []));
}

/**
 * Picks the alertable rows from graded days. `smallMidOnly` adds the ₹30,000 Cr ceiling the site's India preset uses.
 * One hit per alert_id (a filing seen on two days is one event).
 */
export function selectIndiaAlertHits(days: GradedDay[], opts: { smallMidOnly?: boolean } = {}): { hits: IndiaAlertHit[]; scanned: ScannedDay[] } {
  const hits: IndiaAlertHit[] = [];
  const seen = new Set<string>();
  const scanned: ScannedDay[] = [];
  for (const d of days) {
    if (!d.payload) { scanned.push({ date: d.date, key: d.key, rows: 0, alertable: 0, candidates_total: null, raw_items_total: null }); continue; }
    const rows = rowsOf(d.payload);
    const keep = rows.filter((r) => isAlertable(r) && (!opts.smallMidOnly || passesSmallMid(r.market_cap_cr, true)));
    scanned.push({
      date: d.date, key: d.key, rows: rows.length, alertable: keep.length,
      candidates_total: numOrNull(d.payload.candidates_total), raw_items_total: numOrNull(d.payload.raw_items_total),
    });
    for (const r of keep) {
      const h = hitFromRow(r, d.date);
      if (seen.has(h.alert_id)) continue;
      seen.add(h.alert_id);
      hits.push(h);
    }
  }
  return { hits: rankHits(hits), scanned };
}

/** The last `days` calendar dates in UTC, newest first (same window the alerts-digest route has always used). */
export function utcDatesBack(days: number, now: Date = new Date()): string[] {
  const out: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime());
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** Today's date in India (UTC+5:30), YYYY-MM-DD. */
export function istDate(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-06 → "06 Oct 2026" */
export function longDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : iso;
}

// ── formatting ─────────────────────────────────────────────────────────────

/** One decimal at most; null → dash. Never invents a number. */
export function n1(v: number | null | undefined): string {
  if (typeof v !== 'number' || !Number.isFinite(v)) return '-';
  return String(Math.round(v * 10) / 10);
}
const pct = (v: number | null) => (v == null ? '-' : `${n1(v)}%`);
const signed = (v: number | null) => (v == null ? '-' : `${v > 0 ? '+' : ''}${n1(v)}`);
const cap = (v: number | null) => (v == null ? '-' : `Rs ${Math.round(v).toLocaleString('en-IN')} Cr`);
/** A null setup grade means no chart data — never shown as a D. */
export function setupText(g: string | null | undefined): string { return g ? String(g) : 'no setup data'; }

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const tierWord = (t: string) => (t === 'BLOCKBUSTER' ? 'Blockbuster' : t === 'STRONG' ? 'Strong' : t);

function hitBlock(h: IndiaAlertHit, i: number): string[] {
  const lines = [
    `${i + 1}. ${h.ticker} — ${h.company || '-'} (${tierWord(h.tier)})`,
    `   Market cap ${cap(h.market_cap_cr)} · ${h.quarter || '-'} · filed ${h.filing_date}`,
    `   Sales ${pct(h.sales_yoy_pct)} · Profit ${pct(h.net_profit_yoy_pct)} · EPS ${pct(h.eps_yoy_pct)} (all vs last year)`,
    `   Operating margin change ${signed(h.opm_delta_pp)} pts · Cash from operations / profit ${n1(h.cfo_to_pat_ratio)}x · After-results drift score ${n1(h.pead_score)}`,
    `   Business score ${n1(h.fund_composite)} · Chart setup ${setupText(h.setup_grade)} · P/E ${n1(h.pe)}`,
  ];
  if (h.caveat_tags.length) lines.push(`   Caveats: ${h.caveat_tags.join(', ')}`);
  if (h.source_url) lines.push(`   Filing: ${h.source_url}`);
  return lines;
}

/** The hourly message: every hit given (already new), best first. Subject starts "MC Earnings Alert" like the old task. */
export function formatHourlyAlert(hits: IndiaAlertHit[]): { subject: string; text: string; html: string } {
  const ranked = rankHits(hits);
  const subject = `MC Earnings Alert — ${ranked.length} new (${ranked.map((h) => h.ticker).join(', ')})`;
  const text = [
    'New India results that are Blockbuster or Strong and pass your Quality Preset (small and mid caps), best first:',
    '',
    ...ranked.flatMap((h, i) => [...hitBlock(h, i), '']),
    `Full detail: ${SITE}/watchlists`,
    'Each number is what the engine graded. Not investment advice.',
  ].join('\n');
  return { subject, text, html: htmlTable(ranked, text.split('\n')[0], `Full detail: <a href="${SITE}/watchlists">${SITE}/watchlists</a><br>Each number is what the engine graded. Not investment advice.`) };
}

function htmlTable(hits: IndiaAlertHit[], intro: string, footerHtml: string): string {
  const th = (s: string) => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc;font-weight:600">${s}</th>`;
  const td = (s: string) => `<td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap">${s}</td>`;
  const rows = hits.map((h, i) => `<tr>${[
    String(i + 1),
    `<b>${esc(h.ticker)}</b>`,
    esc(h.company || '-'),
    tierWord(h.tier),
    pct(h.sales_yoy_pct), pct(h.net_profit_yoy_pct), pct(h.eps_yoy_pct),
    signed(h.opm_delta_pp), n1(h.pead_score), n1(h.cfo_to_pat_ratio), n1(h.pe),
    h.market_cap_cr == null ? '-' : Math.round(h.market_cap_cr).toLocaleString('en-IN'),
    n1(h.fund_composite), esc(setupText(h.setup_grade)),
    esc(h.caveat_tags.join(', ') || '-'),
    h.source_url ? `<a href="${esc(h.source_url)}">filing</a>` : '-',
  ].map(td).join('')}</tr>`).join('');
  const head = ['#', 'Ticker', 'Company', 'Tier', 'Sales %', 'Profit %', 'EPS %', 'Margin Δ pts', 'Drift', 'Cash/Profit', 'P/E', 'Mkt cap ₹Cr', 'Business score', 'Chart setup', 'Caveats', 'Filing'].map(th).join('');
  return `<div style="font-family:system-ui,-apple-system,sans-serif;font-size:13px;color:#111;background:#fff">`
    + `<p>${esc(intro)}</p>`
    + (hits.length ? `<table style="border-collapse:collapse;background:#fff">${'<tr>' + head + '</tr>'}${rows}</table>` : '')
    + `<p style="color:#555">${footerHtml}</p></div>`;
}

export interface EodInput {
  dateIst: string;
  /** graded payload for today was found */
  graded: boolean;
  candidatesTotal: number | null;
  hits: IndiaAlertHit[];
}

/** The evening message — always sent, one per weekday. */
export function formatEodDigest(x: EodInput): { subject: string; text: string; html: string } {
  const subject = `✅ Earnings Watch — EOD ${longDate(x.dateIst)}`;
  const ranked = rankHits(x.hits);
  const graded = x.candidatesTotal ?? 0;
  const health = x.graded
    ? `Watch healthy · graded ${graded} India filings today · ${ranked.length} cleared your preset.`
    : `Watch ran · no graded India filings were found for today yet · ${ranked.length} cleared your preset.`;
  const body = ranked.length
    ? ['Today’s names that cleared the preset, best first (each was already sent in the hourly alert when it came in):', '', ...ranked.flatMap((h, i) => [...hitBlock(h, i), ''])]
    : ['No names cleared the preset today — a quiet day (between results seasons, or no print good enough). The watch ran fine.', ''];
  const footer = 'Daily check-in — if this does not arrive by about 9:15 pm IST on a weekday, the watch may need a look. Not investment advice.';
  const text = [health, '', ...body, `Full detail: ${SITE}/watchlists`, footer].join('\n');
  const html = htmlTable(ranked, health, esc(ranked.length ? 'Each of these was already sent in the hourly alert when it came in.' : body[0]) + '<br><br>' + `Full detail: <a href="${SITE}/watchlists">${SITE}/watchlists</a><br>${esc(footer)}`);
  return { subject, text, html };
}
