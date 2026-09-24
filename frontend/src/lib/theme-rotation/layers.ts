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
  BreadthStats, CatalystInput, EvidenceLink, FlowStats, LayerKey, LayerRead, LayerSet, PrintInput, Ret, ThemeRow,
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
  } else if (pctNow >= 60 && b.newHighs > b.newLows) state = 'improving';
  else if (pctNow <= 35 && b.newLows > b.newHighs) state = 'weakening';
  const level: LayerRead['level'] = pctNow >= 60 ? 'strong' : pctNow <= 35 ? 'weak' : 'neutral';
  const headline = `${b.above50} of ${b.n} stocks above their 50-day line${b.above50Prev != null ? ` (${b.above50Prev} a month ago)` : ''}`;
  const detail = `${b.outperf} of ${b.n} beating the benchmark over 3 months · ${b.newHighs} near 1-year highs, ${b.newLows} near 1-year lows.`;
  return { key: 'breadth', state, level, headline, detail, source: 'Daily prices of the theme\'s constituent stocks' };
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
/**
 * @param prints strong graded prints mapped to this theme, or null when the
 *               bench is not loaded on this device.
 */
export function earningsLayer(prints: PrintInput[] | null, now: Date, benchLabel: string): LayerRead {
  if (prints == null) return unknown('earnings', 'Graded earnings not loaded on this device', benchLabel);
  const t0 = now.getTime();
  const ageDays = (p: PrintInput) => (t0 - new Date(p.filingDate + (p.filingDate.length === 10 ? 'T00:00:00Z' : '')).getTime()) / DAY;
  const valid = prints.filter((p) => p.filingDate && Number.isFinite(ageDays(p)) && ageDays(p) >= -2);
  const recent = valid.filter((p) => ageDays(p) <= 90);
  const prior = valid.filter((p) => ageDays(p) > 90 && ageDays(p) <= 180);
  if (!recent.length && !prior.length) return unknown('earnings', 'No strong graded prints in this theme in 6 months', benchLabel, 'Unknown is not negative: the bench only holds BLOCKBUSTER / STRONG results.');
  const bb = recent.filter((p) => /BLOCK/i.test(p.tier)).length;
  let state: LayerRead['state'] = 'steady';
  if (recent.length >= 2 && recent.length >= prior.length * 1.5) state = 'improving';
  else if (prior.length >= 2 && recent.length <= prior.length * 0.5) state = 'weakening';
  const level: LayerRead['level'] = recent.length >= 3 ? 'strong' : recent.length >= 1 ? 'neutral' : 'weak';
  const headline = `${recent.length} strong print${recent.length === 1 ? '' : 's'} in the last 90 days${bb ? ` (${bb} blockbuster)` : ''} · ${prior.length} in the 90 days before`;
  const detail = state === 'weakening'
    ? 'Fewer strong results than the quarter before. The bench only records strong prints, so this is fewer confirmations, not proof of weak ones.'
    : state === 'improving' ? 'More companies in this theme are printing strong results than a quarter ago.' : 'A similar number of strong results as the quarter before.';
  const evidence: EvidenceLink[] = [...recent].sort((a, b) => b.filingDate.localeCompare(a.filingDate)).map((p) => ({
    label: `${p.ticker} — ${/BLOCK/i.test(p.tier) ? 'BLOCKBUSTER' : 'STRONG'} result`, date: p.filingDate.slice(0, 10), url: p.url || null, ticker: p.ticker, tone: 'pos' as const,
  }));
  return { key: 'earnings', state, level, headline, detail, source: benchLabel, evidence };
}

// ── 5. CATALYSTS ───────────────────────────────────────────────────────────
const KIND_WORD: Record<string, [string, string]> = {
  order: ['order win', 'order wins'], 'rating-up': ['rating upgrade', 'rating upgrades'], 'rating-down': ['rating downgrade', 'rating downgrades'],
  capacity: ['capacity addition', 'capacity additions'], 'guidance-up': ['guidance raise', 'guidance raises'], 'guidance-down': ['guidance cut', 'guidance cuts'],
  approval: ['approval', 'approvals'], 'regulatory-negative': ['regulatory setback', 'regulatory setbacks'], deal: ['deal', 'deals'], buyback: ['buyback', 'buybacks'], other: ['other item', 'other items'],
};

/**
 * @param items  catalysts already mapped to this theme's constituents, or null
 *               when no feed could be read.
 * @param windowDays how far back the feed reaches.
 */
export function catalystLayer(items: CatalystInput[] | null, now: Date, windowDays: number): LayerRead {
  if (items == null) return unknown('catalysts', 'Filings / news feed not available right now', 'Exchange filings and news');
  const t0 = now.getTime();
  const inWin = items.filter((i) => { const a = (t0 - new Date(i.date).getTime()) / DAY; return Number.isFinite(a) && a >= -1 && a <= windowDays; });
  const pos = inWin.filter((i) => i.tone === 'pos').length;
  const neg = inWin.filter((i) => i.tone === 'neg').length;
  let state: LayerRead['state'] = 'steady';
  if (pos >= 2 && pos >= neg * 2) state = 'improving';
  else if (neg >= 2 && neg > pos) state = 'weakening';
  const level: LayerRead['level'] = pos >= 3 ? 'strong' : neg >= 2 && neg > pos ? 'weak' : 'neutral';
  const byKind = new Map<string, number>();
  for (const i of inWin) byKind.set(i.kind, (byKind.get(i.kind) || 0) + 1);
  const parts = [...byKind.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${n} ${(KIND_WORD[k] || KIND_WORD.other)[n === 1 ? 0 : 1]}`);
  const headline = inWin.length ? `${parts.join(', ')} in ${windowDays} days` : `Quiet — no dated catalysts in ${windowDays} days`;
  const detail = inWin.length ? `${pos} positive, ${neg} negative, ${inWin.length - pos - neg} neutral.` : 'No orders, rating actions, capacity or guidance items found for this theme\'s stocks.';
  const evidence: EvidenceLink[] = [...inWin].sort((a, b) => b.date.localeCompare(a.date)).map((i) => ({
    label: `${i.ticker} — ${i.title}`, date: i.date.slice(0, 10), url: i.url || null, ticker: i.ticker, tone: i.tone,
  }));
  return { key: 'catalysts', state, level, headline, detail, source: 'Exchange filings and news feed', evidence };
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
  prints: PrintInput[] | null;
  benchLabel: string;
  catalysts: CatalystInput[] | null;
  catalystWindowDays: number;
  themePEs: number[];
  allPEs: number[];
  now: Date;
}

export function buildLayers(t: ThemeRow, inp: LayerInputs): LayerSet {
  return {
    strength: strengthLayer(t, inp.benchName, inp.benchRet),
    breadth: breadthLayer(t.breadthStats),
    flow: flowLayer(t.flowStats),
    earnings: earningsLayer(inp.prints, inp.now, inp.benchLabel),
    catalysts: catalystLayer(inp.catalysts, inp.now, inp.catalystWindowDays),
    valuation: valuationLayer(inp.themePEs, inp.allPEs),
    price: priceLayer(t),
  };
}
