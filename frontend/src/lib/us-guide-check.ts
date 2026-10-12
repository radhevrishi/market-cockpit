// ═══════════════════════════════════════════════════════════════════════════
// zzz963 — A LOWERED OUTLOOK KEEPS A QUARTER OUT OF THE TOP TIERS (US).
//
// Park Aerospace (PKE) Q2 FY27: revenue +27%, adjusted EBITDA above the top of
// its own range — and the stock fell 11%, because management cut the outlook
// for its GE engine-program sales (its largest customer group) on the call and
// in the slide deck. The 8-K release carried no guidance at all, so nothing the
// grader read could see it, and a quarter like that can sit in STRONG.
//
// Owner's rule: a BLOCKBUSTER or STRONG quarter whose management LOWERED any
// guidance — the whole company, a segment, a product line or a key customer
// programme — is MIXED. Only the top tiers are checked (MIXED / AVOID rows are
// left alone; it is not a reason to promote or demote them further).
//
// HOW IT IS FOUND (cheapest first, every result cached per filing for good):
//   1. the filing itself — the release and every other exhibit of the 8-K
//      (slide decks are often filed), read for "lowered / reduced / cut …
//      outlook / guidance / forecast" sentences. Free.
//   2. AI with a web search — the call, the deck on the company site and the
//      news of the next days. Only for top-tier rows the filing did not
//      settle, under its own small daily ceiling (US_GUIDE_CHECK_DAILY_USD,
//      default $0.15 ≈ 10–15 checks) inside the monthly AI cap. A "lowered"
//      answer is only accepted with a source link and a quoted figure.
// ═══════════════════════════════════════════════════════════════════════════

import { gunzipSync } from 'node:zlib';
import { kvGet, kvSet, kvMGet, kvIncrByFloat } from './kv';
import { webResearch, modelConfigured } from './anthropic-meter';
import { filingExhibits, htmlToText, secGet } from './us-guidance';
import { composeUsNarrative, type EarningsTier } from './us-earnings-core';
import { US_ENGINE_VERSION } from './us-engine-version';

export const GUIDE_CHECK_V = 'v1';
export const guideCheckKey = (ticker: string, filingDate: string) => `us-guide-check:${GUIDE_CHECK_V}:${String(ticker).toUpperCase()}:${filingDate}`;
const TTL_S = 200 * 24 * 3600;
const TOP: EarningsTier[] = ['BLOCKBUSTER', 'STRONG'];

export interface GuideCheck {
  checked_at: string;
  lowered: boolean;
  scope: 'company' | 'segment' | 'none' | 'unknown';
  what: string;          // plain words: "GE engine-program sales outlook cut to $32–35M from $34–38M"
  quote: string;         // the sentence or figures it rests on
  source: 'filing' | 'ai-web';
  url: string | null;
  usd: number;
}

// ── 1. the filing's own words ─────────────────────────────────────────────────
const OUTLOOK = String.raw`(?:outlook|guidance|forecast|expectations?|full[- ]year\s+(?:revenue|sales|eps|earnings)\s+range)`;
const DOWN_VERB = String.raw`(?:lower(?:ed|s|ing)?|reduc(?:e|ed|es|ing)|cut(?:s|ting)?|trim(?:med|s|ming)?|revis(?:ed|es|ing)\s+(?:down(?:ward)?|lower)|narrow(?:ed|s)?\s+(?:to\s+)?the\s+low(?:er)?\s+end|withdr(?:ew|awn|aws))`;
const RE_VERB_THEN_OUTLOOK = new RegExp(String.raw`\b${DOWN_VERB}\s+(?:its|our|the|their)?\s*(?:[\w$.,%–\-]+\s+){0,6}?${OUTLOOK}\b`, 'i');
const RE_OUTLOOK_THEN_VERB = new RegExp(String.raw`\b${OUTLOOK}\s+(?:[\w$.,%–\-]+\s+){0,6}?(?:was|were|is|are|has\s+been|have\s+been|being)?\s*${DOWN_VERB}\b`, 'i');
// "lower costs", "reduced its debt", "cut expenses" are not an outlook cut, even near the word "guidance"
const NOT_A_CUT = /\b(?:costs?|expenses?|debt|leverage|interest|tax(?:es)?|net\s+loss|losses|headcount|share\s+count|risk|emissions|inventory\s+levels)\b/i;
const RAISED = /\b(?:rais(?:ed|es|ing)|increas(?:ed|es|ing)|lift(?:ed|s)|boost(?:ed|s))\s+(?:its|our|the)?\s*(?:[\w$.,%–\-]+\s+){0,4}?(?:outlook|guidance|forecast)/i;

/** A sentence in the filing that says management lowered an outlook. Null when there is none. */
export function guideLoweredInText(text: string): { quote: string; scope: 'company' | 'segment' } | null {
  if (!text) return null;
  const sentences = text.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
  for (const sn of sentences) {
    if (sn.length > 500 || sn.length < 20) continue;
    if (/\bforward[- ]looking\s+statements?\b|\bsafe\s+harbor\b|\bcould\s+(?:cause|differ)|\bmay\s+(?:lower|reduce|cut)|\bif\s+we\b/i.test(sn)) continue;
    const m = RE_VERB_THEN_OUTLOOK.exec(sn) || RE_OUTLOOK_THEN_VERB.exec(sn);
    if (!m) continue;
    if (NOT_A_CUT.test(m[0])) continue;
    if (RAISED.test(sn) && !/\bbut\b|\bwhile\b|\bhowever\b|\bpartially\s+offset\b/i.test(sn)) continue;
    const segment = /\b(?:segment|division|program(?:me)?s?|product\s+line|business\s+unit|customer|platform)\b/i.test(sn);
    return { quote: sn.trim().slice(0, 400), scope: segment ? 'segment' : 'company' };
  }
  return null;
}

async function filingText(filingUrl: string | null | undefined): Promise<string> {
  if (!filingUrl) return '';
  const exhibits = await filingExhibits(filingUrl).catch(() => []);
  const docs = exhibits.filter((e) => /^EX-99|^8-K$/i.test(e.type) && /\.html?$/i.test(e.name) && (e.size || 0) < 3_000_000).slice(0, 4);
  const texts = await Promise.all(docs.map(async (d) => { const h = await secGet(d.url).catch(() => null); return h ? htmlToText(h) : ''; }));
  return texts.join('\n\n').slice(0, 400_000);
}

// ── 2. AI with a web search ──────────────────────────────────────────────────
const dailyKey = (day: string) => `us-guide-check:usd:${day}`;
export const dailyCapUsd = () => { const v = Number(process.env.US_GUIDE_CHECK_DAILY_USD); return Number.isFinite(v) && v >= 0 ? v : 0.15; };

const SYSTEM = `You check one fact about one US company's latest earnings report: did management LOWER any forward guidance?
Count as lowered: a cut, reduction, downward revision or withdrawal of an outlook, forecast or guidance range for the company, a segment, a product line, or a named customer programme — versus what management itself had guided before — stated in the earnings release, the investor presentation, the earnings call, or reported by news in the days after the release.
Do NOT count: guidance below analyst consensus but not below management's own prior range; lower costs, debt or tax; a lower quarter that was never guided; a range merely narrowed around the same midpoint; guidance that was raised.
Search the web. Answer ONLY with one JSON object, no other text:
{"lowered": true|false, "scope": "company"|"segment"|"none", "what": "<plain words, include old and new figures if known, max 30 words>", "quote": "<the sentence or figures from your source, max 40 words>", "source_url": "<the page you read it on, or empty>"}`;

function parseAnswer(text: string): any | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export async function aiGuideCheck(row: { ticker: string; company?: string; quarter?: string; filing_date: string; period_end?: string | null }): Promise<GuideCheck | null> {
  if (!modelConfigured()) return null;
  const day = new Date().toISOString().slice(0, 10);
  const spent = Number(await kvGet<number>(dailyKey(day)).catch(() => 0)) || 0;
  if (spent >= dailyCapUsd()) return null;
  const prompt = `Company: ${row.company || row.ticker} (ticker ${row.ticker}, US-listed).
Earnings report filed: ${row.filing_date}${row.quarter ? ` (${row.quarter}${row.period_end ? `, period ended ${row.period_end}` : ''})` : ''}.
Question: in this earnings report, its slides, its call or the news of the following days, did management lower any guidance or outlook (company-wide, a segment, a product line or a key customer programme) versus its own prior guidance?`;
  const r = await webResearch('us-guide-check', SYSTEM, prompt, { maxSearches: 3, signal: AbortSignal.timeout(90_000) });
  if (r.usd > 0) await kvIncrByFloat(dailyKey(day), r.usd, 3 * 24 * 3600).catch(() => null);
  if (!r.ok) return null;
  const a = parseAnswer(r.text);
  if (!a || typeof a.lowered !== 'boolean') return null;
  const url = typeof a.source_url === 'string' && /^https?:\/\//.test(a.source_url) ? a.source_url : (r.urls[0] || null);
  const what = String(a.what || '').slice(0, 240);
  // an AI "lowered" needs something to stand on: a link and words saying what was cut
  const lowered = a.lowered === true && !!url && what.length >= 8;
  return {
    checked_at: new Date().toISOString(),
    lowered,
    scope: lowered ? (a.scope === 'segment' ? 'segment' : 'company') : 'none',
    what: lowered ? what : '',
    quote: String(a.quote || '').slice(0, 300),
    source: 'ai-web', url, usd: r.usd,
  };
}

/** Check one row: the filing first (free), AI web search only if the filing says nothing. Cached per filing. */
export async function checkRow(row: any, opts: { allowAi: boolean }): Promise<GuideCheck | null> {
  const key = guideCheckKey(row.ticker, row.filing_date);
  const cached = await kvGet<GuideCheck>(key).catch(() => null);
  if (cached) return cached;
  const text = await filingText(row.filing_url);
  const hit = guideLoweredInText(text);
  let res: GuideCheck | null = null;
  if (hit) {
    res = { checked_at: new Date().toISOString(), lowered: true, scope: hit.scope, what: 'management lowered its outlook in the filing', quote: hit.quote, source: 'filing', url: row.filing_url || null, usd: 0 };
  } else if (opts.allowAi) {
    res = await aiGuideCheck(row);
  }
  if (res) await kvSet(key, res, TTL_S).catch(() => {});
  return res;
}

// ── applying it ──────────────────────────────────────────────────────────────
export const GUIDE_LOWERED_TAG = 'guidance lowered';
const shortWhat = (g: GuideCheck) => (g.what || g.quote || '').replace(/\s+/g, ' ').slice(0, 140);

/** Put one result on a row: a top-tier row whose outlook was lowered becomes MIXED. Returns true when the tier moved. */
export function applyGuideCheck(row: any, g: GuideCheck | null | undefined): boolean {
  if (!row) return false;
  const cut = !!g?.lowered || (row.caveat_tags || []).includes('guidance cut');
  if (g) row.guide_check = g;
  if (!cut || !TOP.includes(row.tier)) return false;
  const tag = g?.lowered ? `${GUIDE_LOWERED_TAG} — ${shortWhat(g)}` : GUIDE_LOWERED_TAG;
  row.caveat_tags = Array.from(new Set([...(row.caveat_tags || []), tag]));
  row.tier_before_guide_check = row.tier;
  row.tier = 'MIXED';
  if (row.narrative_stem) {
    try {
      row.narrative = composeUsNarrative(row.narrative_stem, row.caveat_tags || [], row.methodology_tags || [],
        row.tier, row.company || row.ticker, row.quarter, row.market_context || []) + (row.narrative_tail || '');
    } catch { /* keep the old sentence */ }
  }
  return true;
}

const _memo = new Map<string, { at: number; v: GuideCheck | null }>();
const MEMO_MS = 5 * 60_000;

/** Served-payload overlay: reads cached results for the top-tier rows (one batched KV read) and applies them. */
export async function overlayGuideChecks(payload: any): Promise<any> {
  if (!payload?.by_tier) return payload;
  const top: any[] = [];
  for (const t of TOP) for (const r of (payload.by_tier[t] || [])) top.push(r);
  if (!top.length) return payload;
  const now = Date.now();
  const need = top.filter((r) => { const m = _memo.get(guideCheckKey(r.ticker, r.filing_date)); return !m || now - m.at > MEMO_MS; });
  if (need.length) {
    const vals = await kvMGet<GuideCheck>(need.map((r) => guideCheckKey(r.ticker, r.filing_date))).catch(() => need.map(() => null));
    need.forEach((r, i) => _memo.set(guideCheckKey(r.ticker, r.filing_date), { at: now, v: vals[i] || null }));
  }
  let moved = 0;
  const copy = { ...payload, by_tier: { ...payload.by_tier } };
  for (const t of TOP) {
    const keep: any[] = [];
    for (const r0 of (payload.by_tier[t] || [])) {
      const g = _memo.get(guideCheckKey(r0.ticker, r0.filing_date))?.v || null;
      const willMove = !!g?.lowered || (r0.caveat_tags || []).includes('guidance cut');
      if (!g && !willMove) { keep.push(r0); continue; }
      const r = { ...r0 };
      if (applyGuideCheck(r, g)) { copy.by_tier.MIXED = [r, ...(copy.by_tier.MIXED || [])]; moved++; }
      else keep.push(r);
    }
    copy.by_tier[t] = keep;
  }
  if (moved) copy.notes = [...(payload.notes || []), `${moved} top-tier row${moved > 1 ? 's' : ''} moved to MIXED: management lowered its outlook (filing, slides, call or news)`];
  return copy;
}

// ── the background job ───────────────────────────────────────────────────────
function unzip(raw: any): any | null {
  if (!raw) return null;
  if (typeof raw?.z === 'string') { try { return JSON.parse(gunzipSync(Buffer.from(raw.z, 'base64')).toString('utf8')); } catch { return null; } }
  return raw?.by_tier ? raw : null;
}
function lastWeekdays(n: number): string[] {
  const out: string[] = []; const d = new Date();
  while (out.length < n) { const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 1); }
  return out;
}

/** Check the top-tier rows of the last few sessions that have no result yet. Newest first; AI only within the daily ceiling. */
export async function runUsGuideChecks(opts: { sessions?: number; maxRows?: number; budgetMs?: number } = {}): Promise<{ checked: number; lowered: string[]; ai_calls: number; skipped_budget: number; usd: number }> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 4 * 60_000;
  const rows: any[] = [];
  for (const date of lastWeekdays(opts.sessions ?? 6)) {
    const p = unzip(await kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${date}|1`).catch(() => null));
    if (!p?.by_tier) continue;
    for (const t of TOP) for (const r of (p.by_tier[t] || [])) rows.push(r);
  }
  const keys = rows.map((r) => guideCheckKey(r.ticker, r.filing_date));
  const have = await kvMGet<GuideCheck>(keys).catch(() => keys.map(() => null));
  const todo = rows.filter((_, i) => !have[i]).sort((a, b) => String(b.filing_date).localeCompare(String(a.filing_date)) || (TOP.indexOf(a.tier) - TOP.indexOf(b.tier)));
  const out = { checked: 0, lowered: [] as string[], ai_calls: 0, skipped_budget: 0, usd: 0 };
  const seen = new Set<string>();
  for (const r of todo.slice(0, opts.maxRows ?? 25)) {
    const k = guideCheckKey(r.ticker, r.filing_date);
    if (seen.has(k)) continue; seen.add(k);
    if (Date.now() - t0 > budget) { out.skipped_budget++; continue; }
    const day = new Date().toISOString().slice(0, 10);
    const spent = Number(await kvGet<number>(dailyKey(day)).catch(() => 0)) || 0;
    const g = await checkRow(r, { allowAi: spent < dailyCapUsd() });
    if (!g) { out.skipped_budget++; continue; }
    out.checked++;
    if (g.source === 'ai-web') { out.ai_calls++; out.usd += g.usd; }
    if (g.lowered) out.lowered.push(`${r.ticker}: ${shortWhat(g)}`);
    _memo.delete(k);
  }
  return out;
}
