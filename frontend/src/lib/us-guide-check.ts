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
import { composeUsNarrative, applySetupGates, US_TIER_ORDER, type EarningsTier } from './us-earnings-core';
import { releaseAttributesCashToWorkingCapital } from './us-pr-financials';
import { regradeRow } from './us-regrade';
import { US_ENGINE_VERSION } from './us-engine-version';
import { guideLine } from './us-guide-line';

// zzz971 — v2 records the DIRECTION (raised / lowered / kept / no guidance), not only "lowered". v1 results (lowered yes/no,
// some of them paid AI answers) are still read: a v1 "lowered" stands as is; a v1 "not lowered" is re-checked for free only.
// v3 (zzz971b): v2's first run had loose matches (negations, "capital raised … forecast") — re-read, free only
export const GUIDE_CHECK_V = 'v3';
export const guideCheckKey = (ticker: string, filingDate: string) => `us-guide-check:${GUIDE_CHECK_V}:${String(ticker).toUpperCase()}:${filingDate}`;
export const guideCheckKeyV1 = (ticker: string, filingDate: string) => `us-guide-check:v1:${String(ticker).toUpperCase()}:${filingDate}`;
const TTL_S = 200 * 24 * 3600;
/** a check that found nothing and could not use AI is kept a day, so the next runs move on and AI can try it later */
const UNSETTLED_TTL_S = 20 * 3600;
const TOP: EarningsTier[] = ['BLOCKBUSTER', 'STRONG'];

/** mixed = one guided line better, a profit line guided down (CarMax FY27: GPU decline smaller, CAF income below FY26).
 *  cautious = a profit line guided below last year, nothing raised. Both keep a quarter out of BLOCKBUSTER / STRONG. */
export type GuideCheckDirection = 'raised' | 'lowered' | 'mixed' | 'cautious' | 'maintained' | 'withdrawn' | 'none' | 'not-lowered' | 'unknown';

export interface GuideCheck {
  checked_at: string;
  lowered: boolean;
  /** zzz971 — absent on v1 results */
  direction?: GuideCheckDirection;
  scope: 'company' | 'segment' | 'none' | 'unknown';
  what: string;          // plain words: "GE engine-program sales outlook cut to $32–35M from $34–38M"
  quote: string;         // the sentence or figures it rests on
  source: 'filing' | 'call-coverage' | 'ai-web';
  url: string | null;
  usd: number;
}

/** v1 results carried only `lowered` */
export function withDirection(g: GuideCheck | null | undefined): GuideCheck | null {
  if (!g || typeof g !== 'object') return null;
  if (g.direction) return g;
  return { ...g, direction: g.lowered ? 'lowered' : 'not-lowered' };
}

// ── 1. the filing's own words — the detectors live in us-guide-text (pure, shared with the card) ──
import { guideLoweredInText, guideRaisedInText, guideKeptInText, guideCautionInText, guideDirectionInCoverage } from './us-guide-text';
export { guideLoweredInText, guideRaisedInText, guideKeptInText, guideCautionInText, guideLoweredInCoverage, guideDirectionInCoverage, focusQuote } from './us-guide-text';

async function filingText(filingUrl: string | null | undefined): Promise<string> {
  if (!filingUrl) return '';
  const exhibits = await filingExhibits(filingUrl).catch(() => []);
  const docs = exhibits.filter((e) => /^EX-99|^8-K$/i.test(e.type) && /\.html?$/i.test(e.name) && (e.size || 0) < 3_000_000).slice(0, 4);
  const texts = await Promise.all(docs.map(async (d) => { const h = await secGet(d.url).catch(() => null); return h ? htmlToText(h) : ''; }));
  return texts.join('\n\n').slice(0, 400_000);
}

// ── 2. the earnings-call coverage (free) ─────────────────────────────────────
// zzz970 — Park Aerospace cut its GE-program outlook on the CALL; the 8-K said nothing. Yahoo Finance's free headline feed
// for the ticker lists the call write-ups (MarketBeat "earnings call summary", Motley Fool transcripts, Benzinga…) within a
// day. Those pages are read and searched for a lowered-outlook sentence about the company. No AI, no paid source.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CALL_TITLE = /earnings call|call summary|call transcript|call highlights|transcript|conference call|why .* stock is (falling|plunging|sinking|down|dropping|tumbling|soaring|jumping)|guidance|outlook|forecast/i;
const decodeXml = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");
export function callCoverageLinks(rssXml: string, filingDate: string): Array<{ title: string; url: string; at: string }> {
  const from = Date.parse(`${filingDate}T00:00:00Z`) - 86_400_000, to = from + 9 * 86_400_000;
  const out: Array<{ title: string; url: string; at: string }> = [];
  for (const m of rssXml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const title = decodeXml((/<title>([\s\S]*?)<\/title>/.exec(it) || [])[1] || '').trim();
    const url = decodeXml((/<link>([\s\S]*?)<\/link>/.exec(it) || [])[1] || '').trim();
    const at = Date.parse(((/<pubDate>([\s\S]*?)<\/pubDate>/.exec(it) || [])[1] || '').trim());
    if (!title || !/^https:\/\//.test(url) || !Number.isFinite(at) || at < from || at > to) continue;
    if (!CALL_TITLE.test(title)) continue;
    out.push({ title, url, at: new Date(at).toISOString() });
  }
  return out.slice(0, 4);
}
async function callCoverageCheck(row: any): Promise<GuideCheck | null> {
  let xml = '';
  try {
    const r = await fetch(`https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(String(row.ticker))}&region=US&lang=en-US`, { headers: { 'User-Agent': UA }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    if (r.ok) xml = await r.text();
  } catch { /* no feed this time */ }
  if (!xml) return null;
  const links = callCoverageLinks(xml, row.filing_date);
  // every write-up is read before deciding: a cut in the second article beats a raise in the first
  let best: GuideCheck | null = null;
  const rank = { lowered: 5, mixed: 4, cautious: 3, raised: 2, maintained: 1 } as const;
  for (const l of links) {
    try {
      const r = await fetch(l.url, { headers: { 'User-Agent': UA }, cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(12_000) });
      if (!r.ok) continue;
      const html = (await r.text()).slice(0, 1_500_000);
      const text = htmlToText(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
      const hit = guideDirectionInCoverage(text, row.company || row.ticker);
      if (!hit) continue;
      if (best && rank[best.direction as keyof typeof rank] >= rank[hit.direction]) continue;
      best = { checked_at: new Date().toISOString(), lowered: hit.direction === 'lowered', direction: hit.direction, scope: hit.direction === 'lowered' ? hit.scope : 'company', what: hit.quote.slice(0, 200), quote: hit.quote, source: 'call-coverage', url: l.url, usd: 0 };
      if (hit.direction === 'lowered') break;
    } catch { /* next article */ }
  }
  return best;
}

// ── 3. AI with a web search ──────────────────────────────────────────────────
const dailyKey = (day: string) => `us-guide-check:usd:${day}`;
export const dailyCapUsd = () => { const v = Number(process.env.US_GUIDE_CHECK_DAILY_USD); return Number.isFinite(v) && v >= 0 ? v : 0.15; };

const SYSTEM = `You check one fact about one US company's latest earnings report: which way did management move its OWN forward guidance?
Answer "lowered" if ANY outlook, forecast or guidance range was cut, reduced, revised down or withdrawn — for the company, a segment, a product line or a named customer programme — versus what management itself had guided before, in the earnings release, the investor presentation, the earnings call, or as reported by news in the days after. A cut on one line counts even if other lines were raised (say both in "what").
Answer "mixed" if one guided line improved but another profit line (income, margin, gross profit per unit, EPS, a financing or segment income line) is guided below last year or below the earlier outlook — e.g. "GPU decline now expected under $200, CAF income expected slightly below last year".
Answer "cautious" if nothing was raised but a profit line is guided below last year.
Answer "raised" if guidance was raised and nothing was cut or guided down. "maintained" if it was reaffirmed / unchanged. "none" if the company gives no guidance.
Do NOT count as lowered: guidance below analyst consensus but not below management's own prior range; lower costs, debt or tax; a lower quarter that was never guided; a range merely narrowed around the same midpoint.
Search the web. Answer ONLY with one JSON object, no other text:
{"direction": "raised"|"lowered"|"mixed"|"cautious"|"maintained"|"none", "scope": "company"|"segment", "what": "<plain words, include old and new figures if known, max 30 words>", "quote": "<the sentence or figures from your source, max 40 words>", "source_url": "<the page you read it on, or empty>"}`;

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
Question: in this earnings report, its slides, its call or the news of the following days, did management raise, keep or lower its guidance or outlook (company-wide, a segment, a product line or a key customer programme) versus its own prior guidance?`;
  const r = await webResearch('us-guide-check', SYSTEM, prompt, { maxSearches: 3, signal: AbortSignal.timeout(90_000) });
  if (r.usd > 0) await kvIncrByFloat(dailyKey(day), r.usd, 3 * 24 * 3600).catch(() => null);
  if (!r.ok) return null;
  const a = parseAnswer(r.text);
  if (!a) return null;
  const raw = String(a.direction || (a.lowered === true ? 'lowered' : a.lowered === false ? 'not-lowered' : '')).toLowerCase();
  if (!['raised', 'lowered', 'mixed', 'cautious', 'maintained', 'none', 'withdrawn', 'not-lowered'].includes(raw)) return null;
  const url = typeof a.source_url === 'string' && /^https?:\/\//.test(a.source_url) ? a.source_url : (r.urls[0] || null);
  const what = String(a.what || '').slice(0, 240);
  // a "lowered" or "raised" from AI needs something to stand on: a link and words saying what moved
  const backed = !!url && what.length >= 8;
  let direction = raw as GuideCheckDirection;
  if ((direction === 'lowered' || direction === 'withdrawn' || direction === 'mixed' || direction === 'cautious') && !backed) direction = 'not-lowered';
  if (direction === 'raised' && !backed) direction = 'unknown';
  const lowered = direction === 'lowered' || direction === 'withdrawn';
  return {
    checked_at: new Date().toISOString(),
    lowered, direction,
    scope: lowered ? (a.scope === 'segment' ? 'segment' : 'company') : 'none',
    what: direction === 'unknown' ? '' : what,
    quote: String(a.quote || '').slice(0, 300),
    source: 'ai-web', url, usd: r.usd,
  };
}

/**
 * Check one row, cheapest first: the filing's exhibits → the earnings-call write-ups (both free) → AI with a web search
 * (extra, within its daily ceiling). A LOWERED anywhere stops the search. For a top-tier row, a raise or "kept" from the free
 * steps is not the end — the call can still carry a segment cut — so AI is asked when it is allowed; for other rows the
 * first direction found settles it. Cached per filing. `settledByRelease`: the release's own figures already give the
 * direction, so a non-top row only needs the free look for a hidden cut.
 */
export async function checkRow(row: any, opts: { allowAi: boolean; top?: boolean; settledByRelease?: boolean }): Promise<GuideCheck | null> {
  const key = guideCheckKey(row.ticker, row.filing_date);
  const cached = await kvGet<GuideCheck>(key).catch(() => null);
  if (cached && cached.direction !== 'unknown') return cached;
  // an earlier v1 answer: a cut stands; a paid "not lowered" is kept unless the free look finds a direction
  const v1 = withDirection(await kvGet<GuideCheck>(guideCheckKeyV1(row.ticker, row.filing_date)).catch(() => null));
  if (v1?.lowered) { await kvSet(key, v1, TTL_S).catch(() => {}); return v1; }

  const now = () => new Date().toISOString();
  const text = await filingText(row.filing_url);
  const lo = guideLoweredInText(text);
  if (lo) {
    const res: GuideCheck = { checked_at: now(), lowered: true, direction: 'lowered', scope: lo.scope, what: 'management lowered its outlook in the filing', quote: lo.quote, source: 'filing', url: row.filing_url || null, usd: 0 };
    await kvSet(key, res, TTL_S).catch(() => {});
    return res;
  }
  const cov = await callCoverageCheck(row).catch(() => null);
  if (cov && (cov.direction === 'lowered' || cov.direction === 'mixed' || cov.direction === 'cautious')) { await kvSet(key, cov, TTL_S).catch(() => {}); return cov; }
  const up = guideRaisedInText(text);
  const caution = guideCautionInText(text);
  if (caution) {
    const res: GuideCheck = { checked_at: now(), lowered: false, direction: up ? 'mixed' : 'cautious', scope: 'company', what: caution.quote.slice(0, 200), quote: up ? `${up.quote} … ${caution.quote}`.slice(0, 400) : caution.quote, source: 'filing', url: row.filing_url || null, usd: 0 };
    await kvSet(key, res, TTL_S).catch(() => {});
    return res;
  }
  const keep = up ? null : guideKeptInText(text);
  const free: GuideCheck | null = cov
    || (up ? { checked_at: now(), lowered: false, direction: 'raised', scope: 'company', what: up.quote.slice(0, 160), quote: up.quote, source: 'filing', url: row.filing_url || null, usd: 0 } : null)
    || (keep ? { checked_at: now(), lowered: false, direction: 'maintained', scope: 'company', what: keep.quote.slice(0, 160), quote: keep.quote, source: 'filing', url: row.filing_url || null, usd: 0 } : null);

  // a paid v1 "not lowered" is not paid for twice
  const paidBefore = v1 && v1.source === 'ai-web';
  const wantAi = opts.allowAi && !paidBefore && (opts.top ? true : (!free && !opts.settledByRelease));
  if (wantAi) {
    const ai = await aiGuideCheck(row).catch(() => null);
    if (ai && ai.direction !== 'unknown') {
      // AI found a cut → it wins; AI found nothing new → keep the free finding when there is one
      const pick = (ai.lowered || ai.direction === 'mixed' || ai.direction === 'cautious') ? ai : (free && (ai.direction === 'not-lowered' || ai.direction === 'none') ? free : (free?.direction === 'raised' && ai.direction === 'maintained' ? free : ai));
      await kvSet(key, pick, TTL_S).catch(() => {});
      return pick;
    }
  }
  if (free) { await kvSet(key, free, TTL_S).catch(() => {}); return free; }
  if (v1) { await kvSet(key, v1, TTL_S).catch(() => {}); return v1; }
  // nothing found and no AI this time: remembered for a day so the job moves on, then tried again (AI may be allowed then)
  const unsettled: GuideCheck = { checked_at: now(), lowered: false, direction: 'unknown', scope: 'unknown', what: '', quote: '', source: 'call-coverage', url: null, usd: 0 };
  await kvSet(key, unsettled, UNSETTLED_TTL_S).catch(() => {});
  return unsettled;
}

// ── applying it ──────────────────────────────────────────────────────────────
export const GUIDE_LOWERED_TAG = 'guidance lowered';
const shortWhat = (g: GuideCheck) => (g.what || g.quote || '').replace(/\s+/g, ' ').slice(0, 140);
const clipTag = (s: string) => s.replace(/\s+/g, ' ').slice(0, 140);

/**
 * Put one result on a row and its one-line guidance verdict (`guide_line`). A top-tier row whose guidance was lowered,
 * cut on a main line, or guided down on a profit line (mixed / cautious) becomes MIXED. Returns true when the tier moved.
 */
export function applyGuideCheck(row: any, g: GuideCheck | null | undefined): boolean {
  if (!row) return false;
  if (g) row.guide_check = withDirection(g);
  const line = guideLine(row);
  row.guide_line = line;
  const cut = line.lowered || (row.caveat_tags || []).includes('guidance cut');
  if (!cut || !TOP.includes(row.tier)) return false;
  const tag = `${line.direction === 'mixed' ? 'guidance mixed' : line.direction === 'cautious' ? 'guidance cautious' : GUIDE_LOWERED_TAG} — ${clipTag(line.text.replace(/^Guidance \w+(?: \([^)]*\))? — /, ''))}`;
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
// ── zzz962b — cached days graded before the working-capital read existed ─────
// A day is cached for 30 days and its regrade has no release text, so a quarter like Penguin's stayed "profit without
// operating cash" → MIXED. The job re-reads just those releases (free, SEC) and stores the answer; the overlay regrades
// the row with it.
export const wcCheckKey = (ticker: string, filingDate: string) => `us-wc-check:v1:${String(ticker).toUpperCase()}:${filingDate}`;
const NO_CASH_TAG = 'profit without operating cash';
const WC_TAG = 'negative operating cash — the release attributes it to working capital';

export function regradeWithWorkingCapital(row: any): any {
  const r = { ...row, caveat_tags: (row.caveat_tags || []).map((t: string) => (t === NO_CASH_TAG ? WC_TAG : t)) };
  if (r.grade_input && typeof r.grade_input === 'object') r.grade_input = { ...r.grade_input, cash_explained_by_working_capital: true };
  const out = regradeRow(r);
  try { applySetupGates([out]); } catch { /* single-row gate only demotes */ }
  if (row.prelim && out.tier === 'BLOCKBUSTER') out.tier = 'STRONG';
  if (out.narrative_stem) {
    try { out.narrative = composeUsNarrative(out.narrative_stem, out.caveat_tags || [], out.methodology_tags || [], out.tier, out.company || out.ticker, out.quarter, out.market_context || []) + (out.narrative_tail || ''); } catch { /* keep */ }
  }
  out.wc_rechecked = true;
  return out;
}

async function overlayWorkingCapital(payload: any): Promise<any> {
  const cands: Array<{ t: string; r: any }> = [];
  for (const t of US_TIER_ORDER) for (const r of (payload.by_tier[t] || [])) if ((r.caveat_tags || []).includes(NO_CASH_TAG)) cands.push({ t, r });
  if (!cands.length) return payload;
  const now = Date.now();
  const keys = cands.map((c) => wcCheckKey(c.r.ticker, c.r.filing_date));
  const need = keys.filter((k) => { const m = _wcMemo.get(k); return !m || now - m.at > MEMO_MS; });
  if (need.length) {
    const vals = await kvMGet<{ explained: boolean }>(need).catch(() => need.map(() => null));
    need.forEach((k, i) => _wcMemo.set(k, { at: now, v: vals[i]?.explained === true }));
  }
  const hits = cands.filter((c, i) => _wcMemo.get(keys[i])?.v);
  if (!hits.length) return payload;
  const by_tier: Record<string, any[]> = {};
  for (const t of US_TIER_ORDER) by_tier[t] = (payload.by_tier[t] || []).filter((r: any) => !hits.some((h) => h.r === r));
  for (const h of hits) { const nr = regradeWithWorkingCapital(h.r); (by_tier[nr.tier] || by_tier.MIXED).push(nr); }
  for (const t of US_TIER_ORDER) by_tier[t].sort((a: any, b: any) => ((b.composite_score ?? 0) - (a.composite_score ?? 0)));
  return { ...payload, by_tier };
}
const _wcMemo = new Map<string, { at: number; v: boolean }>();

export async function overlayGuideChecks(payload: any): Promise<any> {
  if (!payload?.by_tier) return payload;
  try { payload = await overlayWorkingCapital(payload); } catch { /* keep the payload as stored */ }
  // zzz971 — every row gets its one-line guidance verdict; v2 results first, a v1 result where no v2 exists yet
  const all: any[] = [];
  for (const t of US_TIER_ORDER) for (const r of (payload.by_tier[t] || [])) all.push(r);
  if (!all.length) return payload;
  const now = Date.now();
  const need = all.filter((r) => { const m = _memo.get(guideCheckKey(r.ticker, r.filing_date)); return !m || now - m.at > MEMO_MS; });
  if (need.length) {
    const k2 = need.map((r) => guideCheckKey(r.ticker, r.filing_date));
    const k1 = need.map((r) => guideCheckKeyV1(r.ticker, r.filing_date));
    const vals = await kvMGet<GuideCheck>([...k2, ...k1]).catch(() => [...k2, ...k1].map(() => null));
    need.forEach((r, i) => _memo.set(k2[i], { at: now, v: withDirection(vals[i] || vals[need.length + i] || null) }));
  }
  let moved = 0;
  const copy = { ...payload, by_tier: {} as Record<string, any[]> };
  for (const t of US_TIER_ORDER) copy.by_tier[t] = [];
  for (const t of US_TIER_ORDER) {
    for (const r0 of (payload.by_tier[t] || [])) {
      const r = { ...r0 };
      const g = _memo.get(guideCheckKey(r0.ticker, r0.filing_date))?.v || null;
      if (applyGuideCheck(r, g)) { copy.by_tier.MIXED.unshift(r); moved++; }
      else copy.by_tier[t].push(r);
    }
  }
  for (const t of Object.keys(payload.by_tier)) if (!(t in copy.by_tier)) copy.by_tier[t] = payload.by_tier[t];
  if (moved) copy.notes = [...(payload.notes || []), `${moved} top-tier row${moved > 1 ? 's' : ''} moved to MIXED: guidance lowered, cut on a main line, or a profit line guided down (filing, slides, call or news)`];
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
export async function runUsGuideChecks(opts: { sessions?: number; maxRows?: number; budgetMs?: number } = {}): Promise<{ checked: number; lowered: string[]; ai_calls: number; skipped_budget: number; usd: number; wc_fixed: number; directions: number }> {
  const t0 = Date.now();
  const budget = opts.budgetMs ?? 4 * 60_000;
  const rows: any[] = [];
  let wcFixed = 0;
  // zzz971 — three weeks back: a STRONG card from a fortnight ago (CarMax, 29 Sep) is still on the page and still needs its line
  for (const date of lastWeekdays(opts.sessions ?? 15)) {
    const p = unzip(await kvGet<any>(`us-graded:${US_ENGINE_VERSION}:${date}|1`).catch(() => null));
    if (!p?.by_tier) continue;
    for (const t of TOP) for (const r of (p.by_tier[t] || [])) rows.push(r);
    // zzz971 — other rows only when their release does not settle the direction (free look first, AI after the top rows)
    for (const t of US_TIER_ORDER) if (!TOP.includes(t)) for (const r of (p.by_tier[t] || [])) {
      if (guideLine(r).direction === 'unknown') rows.push(r);
    }
    // zzz962b — re-read the release of rows held down by "profit without operating cash"
    for (const t of US_TIER_ORDER) for (const r of (p.by_tier[t] || [])) {
      if (!(r.caveat_tags || []).includes(NO_CASH_TAG) || Date.now() - t0 > budget / 2) continue;
      const k = wcCheckKey(r.ticker, r.filing_date);
      if (await kvGet(k).catch(() => null)) continue;
      const ex = await filingExhibits(r.filing_url || '').catch(() => []);
      const doc = ex.find((e) => /^EX-99\.1/i.test(e.type)) || ex.find((e) => /^EX-99/i.test(e.type));
      const html = doc ? await secGet(doc.url).catch(() => null) : null;
      if (!html) continue;
      const explained = releaseAttributesCashToWorkingCapital(html);
      await kvSet(k, { explained, checked_at: new Date().toISOString() }, TTL_S).catch(() => {});
      if (explained) { wcFixed++; const nr = regradeWithWorkingCapital(r); if (TOP.includes(nr.tier)) rows.push(nr); }
    }
  }
  { // the same filing shows on several session days — keep one copy (the top-tier one first)
    const by = new Map<string, any>();
    for (const r of rows) { const k = guideCheckKey(r.ticker, r.filing_date); const o = by.get(k); if (!o || (TOP.includes(r.tier) && !TOP.includes(o.tier))) by.set(k, r); }
    rows.length = 0; rows.push(...by.values());
  }
  const keys = rows.map((r) => guideCheckKey(r.ticker, r.filing_date));
  const have = await kvMGet<GuideCheck>(keys).catch(() => keys.map(() => null));
  const isTop = (r: any) => TOP.includes(r.tier);
  const todo = rows.filter((_, i) => !have[i] || (have[i] as any)?.direction === 'unknown')
    .sort((a, b) => (Number(isTop(b)) - Number(isTop(a))) || String(b.filing_date).localeCompare(String(a.filing_date)) || (TOP.indexOf(a.tier) - TOP.indexOf(b.tier)));
  const out = { checked: 0, lowered: [] as string[], ai_calls: 0, skipped_budget: 0, usd: 0, wc_fixed: wcFixed, directions: 0 };
  const seen = new Set<string>();
  for (const r of todo.slice(0, opts.maxRows ?? 40)) {
    const k = guideCheckKey(r.ticker, r.filing_date);
    if (seen.has(k)) continue; seen.add(k);
    if (Date.now() - t0 > budget) { out.skipped_budget++; continue; }
    const day = new Date().toISOString().slice(0, 10);
    const spent = Number(await kvGet<number>(dailyKey(day)).catch(() => 0)) || 0;
    const settled = guideLine(r).direction !== 'unknown';
    const g = await checkRow(r, { allowAi: spent < dailyCapUsd(), top: isTop(r), settledByRelease: settled });
    if (!g) { out.skipped_budget++; continue; }
    out.checked++;
    if (g.source === 'ai-web') { out.ai_calls++; out.usd += g.usd; }
    if (g.lowered || g.direction === 'mixed' || g.direction === 'cautious') out.lowered.push(`${r.ticker}: ${g.direction} — ${shortWhat(g)}`);
    else if (g.direction && g.direction !== 'unknown') out.directions = (out.directions || 0) + 1;
    _memo.delete(k);
  }
  return out;
}
