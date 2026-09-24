// ═══════════════════════════════════════════════════════════════════════════
// THEME ROTATION — EVIDENCE LAYERS  (zzz795)
//
// Seven separate reads of a theme. They are kept apart on purpose: a theme can
// be structurally strong while its price breaks down this month, or have
// improving earnings while its price is still lagging. Merging them into one
// number is what hid both of those cases before.
//
//   strength   — relative strength vs the benchmark over months
//   breadth    — how many of the theme's own stocks are participating
//   flow       — trading-volume PROXY for money moving in or out
//   earnings   — strong graded prints (Conviction bench) in the theme
//   catalysts  — dated filings / news: orders, ratings, capacity, guidance
//   valuation  — P/E level where a real field exists, else "not available"
//   price      — what the theme's own price is doing now
//
// Each layer reports a STATE (improving / steady / weakening / unknown) and,
// separately, a LEVEL. 'unknown' means no data and is never treated as bad.
// No layer invents a number: when an input is missing the layer says so.
// ═══════════════════════════════════════════════════════════════════════════

import type {
  BreadthStats, CatalystInput, EarningsInput, EvidenceLink, FlowStats, LayerKey, LayerRead, LayerSet, PrintInput, Ret, ThemeRow,
} from './types';

const pct = (v: number | null | undefined, dp = 1) => (typeof v === 'number' && Number.isFinite(v) ? `${v > 0 ? '+' : ''}${v.toFixed(dp)}%` : 'n/a');
const pts = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} pts`;
const DAY = 86_400_000;

function unknown(key: LayerKey, headline: string, source: string, detail = ''): LayerRead {
  return { key, state: 'unknown', level: null, headline, detail, source };
}

// ── 1. THEME STRENGTH ──────────────────────────────────────────────────────
export function strengthLayer(t: ThemeRow, benchName: string, benchRet?: Ret | null): LayerRead {
  if (typeof t.rsRatio !== 'number' || !t.ret) return unknown('strength', 'Relative strength not available', 'Theme price series');
  const ex3 = typeof t.excess3m === 'number' ? t.excess3m : (benchRet ? t.ret.m3 - benchRet.m3 : null);
  const ex1y = benchRet ? t.ret.y1 - benchRet.y1 : null;
  const level: LayerRead['level'] = t.rsRatio >= 100 && (ex3 ?? 0) > 0 ? 'strong' : t.rsRatio < 100 && (ex3 ?? 0) < 0 ? 'weak' : 'neutral';
  const slope = typeof t.rsSlope === 'number' ? t.rsSlope : null;
  const d1 = typeof t.rsDelta1w === 'number' ? t.rsDelta1w : null;
  const state = slope != null
    ? (slope > 0.25 ? 'improving' : slope < -0.25 ? 'weakening' : 'steady')
    : d1 != null ? (d1 > 0.5 ? 'improving' : d1 < -0.5 ? 'weakening' : 'steady') : 'steady';
  const move = state === 'improving' ? ', gaining ground' : state === 'weakening' ? ', losing ground' : '';
  const headline = (ex3 == null
    ? `${level === 'strong' ? 'Ahead of' : level === 'weak' ? 'Behind' : 'In line with'} ${benchName}`
    : `${ex3 >= 0 ? 'Ahead of' : 'Behind'} ${benchName} by ${Math.abs(ex3).toFixed(1)} pts over 3 months`) + move;
  const trendWord = state === 'improving' ? 'rising' : state === 'weakening' ? 'falling' : 'flat';
  const detail = `Relative-strength line ${trendWord} over the last 8 weeks${ex1y != null ? ` · ${pts(ex1y)} vs ${benchName} over 1 year` : ''}.`;
  return { key: 'strength', state, level, headline, detail, source: `Weekly relative strength vs ${benchName} (JdK method)` };
}

// ── 2. BREADTH ─────────────────────────────────────────────────────────────
/** zzz797 — below this many priced names a breadth reading is low confidence:
 *  "5 of 5 above the 50-day line" is five stocks, not a market. */
export const BREADTH_MIN_CONFIDENT = 5;

export function breadthLayer(b: BreadthStats | null | undefined): LayerRead {
  if (!b || b.n < 3) return unknown('breadth', b ? `Only ${b.n} constituent${b.n === 1 ? '' : 's'} priced — too few to judge` : 'Constituent breadth not available', 'Constituent daily prices');
  const pctNow = (b.above50 / b.n) * 100;
  const delta = b.above50Prev != null ? ((b.above50 - b.above50Prev) / b.n) * 100 : null;
  // Direction comes from the month-on-month change. Only when there is no
  // month-ago reading does the level (plus highs vs lows) stand in for it.
  let state: LayerRead['state'] = 'steady';
  if (delta != null) {
    if (delta >= 15 || (delta >= 5 && pctNow >= 60)) state = 'improving';
    else if (delta <= -15 || (delta <= -5 && pctNow <= 35)) state = 'weakening';
  } else state = 'level';   // zzz797 — no month-ago reading: a level, not a direction
  const level: LayerRead['level'] = pctNow >= 60 ? 'strong' : pctNow <= 35 ? 'weak' : 'neutral';
  const low = b.n < BREADTH_MIN_CONFIDENT;
  const headline = `${b.above50} of ${b.n} stocks above their 50-day line${b.above50Prev != null ? ` (${b.above50Prev} a month ago)` : ''}${low ? ' — small sample, low confidence' : ''}`;
  const extra: string[] = [];
  if (typeof b.above20 === 'number') extra.push(`${b.above20} of ${b.n} above the 20-day line`);
  if (typeof b.above200 === 'number' && typeof b.n200 === 'number' && b.n200 > 0) extra.push(`${b.above200} of ${b.n200} above the 200-day line`);
  const detail = `Sample: ${b.n} stock${b.n === 1 ? '' : 's'}. ${b.outperf} of ${b.n} beating the benchmark over 3 months · ${b.newHighs} near 1-year highs, ${b.newLows} near 1-year lows${extra.length ? ` · ${extra.join(' · ')}` : ''}.${low ? ` Fewer than ${BREADTH_MIN_CONFIDENT} names: read this as a hint, not a measurement.` : ''}`;
  return { key: 'breadth', state, level, headline, detail, source: 'Daily prices of the theme\'s constituent stocks', lowConfidence: low, basis: delta != null ? 'compared' : 'level' };
}

// ── 3. CAPITAL FLOW (PROXY) ────────────────────────────────────────────────
export function flowLayer(f: FlowStats | null | undefined): LayerRead {
  if (!f || f.basis === 'none' || f.relVol == null || f.upShare == null) {
    return { ...unknown('flow', 'No usable volume data for this theme', 'Trading volume (proxy)'), proxy: true };
  }
  const up = f.upShare, prev = f.upSharePrev;
  let state: LayerRead['state'] = 'steady';
  if (up >= 0.55 && f.relVol >= 1.0 && (prev == null || up >= prev - 0.02)) state = 'improving';
  else if (up <= 0.45 && f.relVol >= 1.0) state = 'weakening';
  else if (prev != null && up - prev <= -0.1) state = 'weakening';
  else if (prev != null && up - prev >= 0.1 && up >= 0.5) state = 'improving';
  const level: LayerRead['level'] = up >= 0.55 ? 'strong' : up <= 0.45 ? 'weak' : 'neutral';
  const headline = `Volume ${f.relVol.toFixed(1)}× its usual level, ${Math.round(up * 100)}% of it on up days`;
  const detail = `${prev != null ? `The month before: ${Math.round(prev * 100)}% on up days. ` : ''}A proxy from ${f.basis === 'etf' ? 'the theme ETF\'s' : 'constituent'} trading volume — not fund-flow data.`;
  return { key: 'flow', state, level, headline, detail, source: 'Trading volume (proxy, not fund flows)', proxy: true };
}

// ── 4. EARNINGS EVIDENCE ───────────────────────────────────────────────────
//
// zzz797 — THE "0 IN THE 90 DAYS BEFORE" ARTEFACT.
//
// The first version counted strong prints in the last 90 days against the 90
// days before, from the Conviction bench. The bench keeps the LATEST filing per
// company (older quarters survive only when the same name printed strong
// again), and it only fills on the days its page was opened — so the earlier
// window was empty for every theme, "N vs 0" read as "improving" everywhere,
// and FMCG / Energy landed in "Early rotation" off an artefact.
//
// Two honest replacements, in order of preference:
//   · GRADED HISTORY — every graded result (all tiers) for both windows: the
//     share of the theme's REPORTERS that printed strong, this quarter vs last
//     quarter. Like for like, and normalised by theme size (72 prints in a
//     big theme and 3 in a small one are both just shares).
//   · BENCH ONLY — strong prints only. Compared only when the bench
//     demonstrably covered the earlier window (enough prints market-wide),
//     as the theme's share of all strong prints on file in each window.
//     Otherwise it is a LEVEL, says so, and is never counted as improving.

/** Windows, in days: "this quarter" and "the quarter before". */
export const EARN_RECENT_DAYS = 90;
export const EARN_PRIOR_DAYS = 180;
/** A share is compared only when each window has at least this many reporters. */
export const EARN_MIN_REPORTERS = 3;
/** Bench-only: the earlier window counts as "on file" when the bench holds
 *  at least this many strong prints market-wide in it. */
export const BENCH_MIN_PRIOR = 15;

const pctOf = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export function splitPrints(prints: PrintInput[], now: Date): { recent: PrintInput[]; prior: PrintInput[] } {
  const t0 = now.getTime();
  const age = (p: PrintInput) => (t0 - new Date(p.filingDate + (p.filingDate.length === 10 ? 'T00:00:00Z' : '')).getTime()) / DAY;
  const valid = prints.filter((p) => p.filingDate && Number.isFinite(age(p)) && age(p) >= -2);
  return {
    recent: valid.filter((p) => age(p) <= EARN_RECENT_DAYS),
    prior: valid.filter((p) => age(p) > EARN_RECENT_DAYS && age(p) <= EARN_PRIOR_DAYS),
  };
}

/**
 * @param inp the theme's earnings evidence, or null when no source is loaded
 *            on this device.
 */
export function earningsLayer(inp: EarningsInput | null, now: Date, benchLabel: string): LayerRead {
  if (inp == null) return unknown('earnings', 'Graded earnings not loaded on this device', benchLabel);
  const { recent, prior } = splitPrints(inp.prints || [], now);
  const Sn = recent.length, Sp = prior.length;
  const bb = recent.filter((p) => /BLOCK/i.test(p.tier)).length;
  const evidence: EvidenceLink[] = [...recent].sort((a, b) => b.filingDate.localeCompare(a.filingDate)).map((p) => ({
    label: `${p.ticker} — ${/BLOCK/i.test(p.tier) ? 'BLOCKBUSTER' : 'STRONG'} result`, date: p.filingDate.slice(0, 10), url: p.url || null, ticker: p.ticker, tone: 'pos' as const,
  }));
  const bbTxt = bb ? ` (${bb} blockbuster)` : '';

  if (inp.source === 'graded') {
    const Rn = inp.reported?.recent ?? 0, Rp = inp.reported?.prior ?? 0;
    if (!Rn && !Rp) return unknown('earnings', 'No graded results for this theme\'s names in 6 months', benchLabel, 'Unknown is not negative: none of the names mapped to this theme reported in the graded history.');
    const shareNow = Rn ? Sn / Rn : 0;
    const mkt = inp.market?.reported && inp.market.reported.recent ? inp.market.strong.recent / inp.market.reported.recent : null;
    const level: LayerRead['level'] = Rn < EARN_MIN_REPORTERS ? null
      : mkt != null ? (shareNow >= mkt * 1.3 && Sn >= 2 ? 'strong' : shareNow <= mkt * 0.6 ? 'weak' : 'neutral')
        : (shareNow >= 0.4 ? 'strong' : shareNow <= 0.15 ? 'weak' : 'neutral');
    const low = Rn < 5;
    const nowTxt = `${Sn} of ${Rn} reporters printed strong (${pctOf(Sn, Rn)}%)${bbTxt} in the last 90 days`;
    const mktTxt = mkt != null ? ` Market-wide: ${Math.round(mkt * 100)}% of reporters printed strong.` : '';
    if (inp.priorCovered && Rp >= EARN_MIN_REPORTERS && Rn >= EARN_MIN_REPORTERS) {
      const sharePrior = Sp / Rp;
      const dpp = (shareNow - sharePrior) * 100;
      let state: LayerRead['state'] = 'steady';
      if (dpp >= 10 && Sn >= 2) state = 'improving';
      else if (dpp <= -10 && Sp >= 2) state = 'weakening';
      const headline = `${nowTxt} · ${Sp} of ${Rp} (${pctOf(Sp, Rp)}%) the quarter before`;
      const detail = (state === 'improving' ? `A larger share of this theme's companies is printing strong results than a quarter ago (${dpp > 0 ? '+' : ''}${dpp.toFixed(0)} pts).`
        : state === 'weakening' ? `A smaller share of this theme's companies is printing strong results than a quarter ago (${dpp.toFixed(0)} pts).`
          : `About the same share of strong results as the quarter before (${dpp > 0 ? '+' : ''}${dpp.toFixed(0)} pts).`) + mktTxt + (low ? ' Few reporters: low confidence.' : '');
      return { key: 'earnings', state, level, headline, detail, source: `${benchLabel} — graded results, all tiers`, evidence, lowConfidence: low, basis: 'compared' };
    }
    const why = !inp.priorCovered ? 'no earlier quarter on file' : `only ${Rp} reporter${Rp === 1 ? '' : 's'} on file for the quarter before`;
    return {
      key: 'earnings', state: 'level', level, headline: `Level only: ${nowTxt} (${why})`,
      detail: `A level, not a trend — there is no like-for-like earlier quarter to compare with, so this is not read as improving.${mktTxt}${low ? ' Few reporters: low confidence.' : ''}`,
      source: `${benchLabel} — graded results, all tiers`, evidence, lowConfidence: low, basis: 'level',
    };
  }

  // Bench only: strong prints, no denominator of reporters.
  if (!Sn && !Sp) return unknown('earnings', 'No strong graded prints in this theme in 6 months', benchLabel, 'Unknown is not negative: the bench only holds BLOCKBUSTER / STRONG results.');
  const m = inp.market?.strong;
  if (inp.priorCovered && m && m.prior >= BENCH_MIN_PRIOR && m.recent >= BENCH_MIN_PRIOR) {
    const sNow = Sn / m.recent, sPrev = Sp / m.prior;
    let state: LayerRead['state'] = 'steady';
    if (Sn >= 3 && sNow >= sPrev * 1.5 && Sn > Sp) state = 'improving';
    else if (Sp >= 3 && sNow <= sPrev * 0.5) state = 'weakening';
    const headline = `${Sn} strong print${Sn === 1 ? '' : 's'}${bbTxt} in the last 90 days (${pctOf(Sn, m.recent)}% of all on the bench) · ${Sp} (${pctOf(Sp, m.prior)}%) the 90 days before`;
    const detail = `Compared as this theme's share of every strong print on the bench in each window, so a fuller bench does not read as improvement. The bench only records strong prints: fewer means fewer confirmations, not proof of weak ones.`;
    return { key: 'earnings', state, level: null, headline, detail, source: benchLabel, evidence, lowConfidence: Sn + Sp < 3, basis: 'compared' };
  }
  return {
    key: 'earnings', state: 'level', level: null,
    headline: `Level only: ${Sn} strong print${Sn === 1 ? '' : 's'}${bbTxt} in the last 90 days (no earlier quarter on file)`,
    detail: 'The bench keeps the latest filing per company and only fills on the days it is opened, so the quarter before is not on file. This is a level, not a trend, and is not read as improving.',
    source: benchLabel, evidence, lowConfidence: Sn < 3, basis: 'level',
  };
}

// ── 5. CATALYSTS ───────────────────────────────────────────────────────────
const KIND_WORD: Record<string, [string, string]> = {
  order: ['order win', 'order wins'], 'rating-up': ['rating upgrade', 'rating upgrades'], 'rating-down': ['rating downgrade', 'rating downgrades'],
  capacity: ['capacity addition', 'capacity additions'], 'guidance-up': ['guidance raise', 'guidance raises'], 'guidance-down': ['guidance cut', 'guidance cuts'],
  approval: ['approval', 'approvals'], 'regulatory-negative': ['regulatory setback', 'regulatory setbacks'], deal: ['deal', 'deals'], buyback: ['buyback', 'buybacks'], other: ['other item', 'other items'],
};

/**
 * zzz797 — "● steady" on all 49 US and 29 India themes was a default, not a
 * reading: an empty list fell through to 'steady'. Now:
 *   · nothing counted in either window → ○ no data (unknown ≠ negative);
 *   · the feed reaches back far enough → last `windowDays` vs the
 *     `windowDays` before, compared on positives minus negatives;
 *   · the feed does not reach that far → a level, said so.
 *
 * @param items  catalysts already mapped to this theme's constituents, or null
 *               when no feed could be read.
 * @param windowDays the comparison window (14).
 * @param coverageDays how far back the feed actually reaches (market-wide);
 *               defaults to 2 × windowDays.
 */
export function catalystLayer(items: CatalystInput[] | null, now: Date, windowDays: number, coverageDays: number = windowDays * 2): LayerRead {
  if (items == null) return unknown('catalysts', 'Filings / news feed not available right now', 'Exchange filings and news');
  const t0 = now.getTime();
  const ageOf = (i: CatalystInput) => (t0 - new Date(i.date).getTime()) / DAY;
  const inWin = items.filter((i) => { const a = ageOf(i); return Number.isFinite(a) && a >= -1 && a <= windowDays; });
  const prevWin = items.filter((i) => { const a = ageOf(i); return Number.isFinite(a) && a > windowDays && a <= windowDays * 2; });
  if (!inWin.length && !prevWin.length) {
    return unknown('catalysts', `No dated catalysts counted in ${Math.round(Math.min(coverageDays, windowDays * 2))} days`, 'Exchange filings and news feed',
      'Unknown is not negative: no orders, rating actions, capacity or guidance items were found for this theme\'s stocks — or the feed does not cover them.');
  }
  const pos = inWin.filter((i) => i.tone === 'pos').length;
  const neg = inWin.filter((i) => i.tone === 'neg').length;
  const pPos = prevWin.filter((i) => i.tone === 'pos').length;
  const pNeg = prevWin.filter((i) => i.tone === 'neg').length;
  const byKind = new Map<string, number>();
  for (const i of inWin) byKind.set(i.kind, (byKind.get(i.kind) || 0) + 1);
  const parts = [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${(KIND_WORD[k] || KIND_WORD.other)[n === 1 ? 0 : 1]}`);
  const nowTxt = inWin.length ? `${parts.join(', ')} in the last ${windowDays} days` : `Quiet in the last ${windowDays} days`;
  const level: LayerRead['level'] = pos >= 3 && pos > neg ? 'strong' : neg >= 2 && neg > pos ? 'weak' : inWin.length ? 'neutral' : null;
  const evidence: EvidenceLink[] = [...inWin, ...prevWin].sort((a, b) => b.date.localeCompare(a.date)).map((i) => ({
    label: `${i.ticker} — ${i.title}`, date: i.date.slice(0, 10), url: i.url || null, ticker: i.ticker, tone: i.tone,
  }));
  const compared = coverageDays >= windowDays * 2 - 1;
  if (!compared) {
    return {
      key: 'catalysts', state: 'level', level, headline: `Level only: ${nowTxt}`,
      detail: `${pos} positive, ${neg} negative. The feed reaches back ${Math.max(0, Math.round(coverageDays))} days, not far enough to compare with the ${windowDays} days before.`,
      source: 'Exchange filings and news feed', evidence, basis: 'level',
    };
  }
  const net = pos - neg, pNet = pPos - pNeg;
  let state: LayerRead['state'] = 'steady';
  if (pos >= 2 && net - pNet >= 2) state = 'improving';
  else if (neg >= 1 && net - pNet <= -2) state = 'weakening';
  const headline = `${nowTxt} · ${prevWin.length ? `${pPos} positive, ${pNeg} negative` : 'none'} in the ${windowDays} days before`;
  const detail = `Last ${windowDays} days: ${pos} positive, ${neg} negative, ${inWin.length - pos - neg} neutral. The ${windowDays} days before: ${pPos} positive, ${pNeg} negative.`;
  return { key: 'catalysts', state, level, headline, detail, source: 'Exchange filings and news feed', evidence, basis: 'compared' };
}

// ── 6. VALUATION / EXPECTATIONS ────────────────────────────────────────────
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
/**
 * P/E is the only real valuation field the app holds (on graded bench rows).
 * It is a LEVEL: there is no stored history, so the state stays 'unknown' and
 * the layer never claims valuation is improving or worsening.
 */
export function valuationLayer(themePEs: number[], allPEs: number[]): LayerRead {
  const ok = (x: number) => Number.isFinite(x) && x > 0 && x < 1000;
  const mine = themePEs.filter(ok), all = allPEs.filter(ok);
  if (mine.length < 2) return unknown('valuation', 'Not available — fewer than 2 graded names with a P/E', 'P/E on graded earnings rows');
  const m = median(mine) as number;
  const mkt = all.length >= 5 ? median(all) : null;
  const ratio = mkt ? m / mkt : null;
  const level: LayerRead['level'] = ratio == null ? null : ratio >= 1.3 ? 'weak' : ratio <= 0.8 ? 'strong' : 'neutral';
  const headline = `Median P/E ${m.toFixed(0)}${mkt ? ` vs ${mkt.toFixed(0)} across all graded names` : ''}`;
  const detail = ratio == null ? `From ${mine.length} graded names. Level only — no history to say which way it is moving.`
    : ratio >= 1.3 ? `Priced for strong growth: expectations are high, so a miss costs more. From ${mine.length} names; level only.`
      : ratio <= 0.8 ? `Cheaper than the graded universe: low expectations. From ${mine.length} names; level only.`
        : `In line with the graded universe. From ${mine.length} names; level only.`;
  return { key: 'valuation', state: 'unknown', level, headline, detail, source: 'P/E on graded earnings rows (level only)' };
}

// ── 7. PRICE CONFIRMATION ──────────────────────────────────────────────────
export function priceLayer(t: ThemeRow): LayerRead {
  const r = t.ret;
  if (!r || typeof t.aboveSMA50 !== 'boolean') return unknown('price', 'Price not available', 'Theme price series');
  const above = t.aboveSMA50;
  const momUp = (t.momDelta1w ?? 0) >= 0;
  let state: LayerRead['state'] = 'steady';
  if ((!above && r.m1 < 0) || r.m1 <= -8 || (r.w1 <= -4 && r.m1 < 0) || t.shortTermBreak) state = 'weakening';
  else if (above && r.m1 > 0 && momUp) state = 'improving';
  const level: LayerRead['level'] = above && r.m3 > 0 ? 'strong' : !above && r.m3 < 0 ? 'weak' : 'neutral';
  const d50 = typeof t.dist50 === 'number' ? ` (${pct(t.dist50, 0)})` : '';
  const headline = `${above ? 'Above' : 'Below'} its 50-day line${d50} · 1W ${pct(r.w1)} · 1M ${pct(r.m1)}`;
  const detail = `3M ${pct(r.m3)} · 1Y ${pct(r.y1)}${typeof t.rangePos === 'number' ? ` · at ${t.rangePos}% of its 1-year range` : ''}.`;
  return { key: 'price', state, level, headline, detail, source: 'Theme price series (index, ETF or equal-weight basket)' };
}

export const LAYER_ORDER: LayerKey[] = ['strength', 'breadth', 'flow', 'earnings', 'catalysts', 'valuation', 'price'];
export const LAYER_NAME: Record<LayerKey, string> = {
  strength: 'Strength', breadth: 'Breadth', flow: 'Flow (proxy)', earnings: 'Earnings', catalysts: 'Catalysts', valuation: 'Valuation', price: 'Price',
};
export const LAYER_SHORT: Record<LayerKey, string> = {
  strength: 'STR', breadth: 'BRD', flow: 'FLW', earnings: 'ERN', catalysts: 'CAT', valuation: 'VAL', price: 'PRC',
};

export interface LayerInputs {
  benchName: string;
  benchRet?: Ret | null;
  earnings: EarningsInput | null;
  benchLabel: string;
  catalysts: CatalystInput[] | null;
  catalystWindowDays: number;
  /** How far back the catalyst feed reaches, in days (default 2 × window). */
  catalystCoverageDays?: number;
  themePEs: number[];
  allPEs: number[];
  now: Date;
}

export function buildLayers(t: ThemeRow, inp: LayerInputs): LayerSet {
  return {
    strength: strengthLayer(t, inp.benchName, inp.benchRet),
    breadth: breadthLayer(t.breadthStats),
    flow: flowLayer(t.flowStats),
    earnings: earningsLayer(inp.earnings, inp.now, inp.benchLabel),
    catalysts: catalystLayer(inp.catalysts, inp.now, inp.catalystWindowDays, inp.catalystCoverageDays),
    valuation: valuationLayer(inp.themePEs, inp.allPEs),
    price: priceLayer(t),
  };
}
