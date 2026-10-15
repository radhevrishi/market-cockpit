// zzz1061 — price alerts on the app's OWN signals: Stage Analysis, Cheat Entry, setups & chart patterns, volume & accumulation,
// results and guidance. Pure (no I/O): the checker passes in the data views; signal-sources.ts reads them on the server.
//
// STATE-CHANGE semantics. Each signal condition has a STATE per alert + ticker (1 / 0, or the stage number for "Stage 1 → 2").
// The state is worked out again only when its SOURCE has a new reading (the screener snapshot's builtAt, or a new content stamp
// of the graded-results / guidance data) — between readings nothing is recomputed. It FIRES when the state becomes true
// compared with the previous reading:
//   • the first reading only records the state (a signal that was already true when the alert started watching never fires);
//   • false → true sets an "edge" for the current bar (market day, or week on a 1-week alert). The condition is met while the
//     edge is there, so it can combine (AND) with price conditions during that bar;
//   • the edge is used up when the alert fires (it never fires twice for one change, whatever the trigger setting), and it ends
//     when the bar ends or the state turns false again;
//   • staying true does not fire again; it has to turn false and then true again.
// Missing data (a ticker not in the snapshot, a company the setups were not read for) is "unknown": the alert waits, the last
// known state is kept, and the next known reading is compared with it.
// India and US are kept apart: every state is per market-qualified ticker, and each market has its own snapshot.
import { cheatSetup } from '@/lib/cheat-entry-setup';
import type { AlertCondition, AlertMarket, CondType, PatternTf } from './types';

export type SignalSource = 'screen' | 'results' | 'guidance';
export type SignalGroup = 'Stage Analysis' | 'Setups & patterns' | 'Volume & accumulation' | 'Fundamentals & results';

export interface SignalMeta {
  group: SignalGroup;
  source: SignalSource;
  /** dialog name */
  name: string;
  /** one line under the chosen condition */
  desc: string;
  /** when the state can change, in plain words */
  updates: string;
}

const SCREEN_UPD = 'Updates with the screener build: every 20 min (India) · 4× a day (USA), from completed daily sessions.';
const STAGE_UPD = 'Stage Analysis updates at each weekly close (completed weeks only); checked after each screener build.';
const RESULTS_UPD = 'Checked every 30 min while the market is open, from the graded results of today and the previous session.';
const GUIDE_UPD = 'Checked every 30 min while the market is open, from the guidance archive (updated hourly; raises dated in the last 7 days).';

const S = (group: SignalGroup, name: string, desc: string, updates = SCREEN_UPD, source: SignalSource = 'screen'): SignalMeta => ({ group, source, name, desc, updates });

export const SIGNAL_META: Record<string, SignalMeta> = {
  stage_2: S('Stage Analysis', 'Stage changes to 2 (confirmed)', 'TheWrap Stage Analysis on weekly bars: fires when the stage becomes 2 (advancing) after two confirming weekly closes.', STAGE_UPD),
  stage_to: S('Stage Analysis', 'Stage changes to … (pick 1–4)', 'Fires when the confirmed weekly stage becomes the one you pick: 1 basing, 2 advancing, 3 topping, 4 declining.', STAGE_UPD),
  stage2_weak: S('Stage Analysis', 'Stage 2 weakening (topping risk)', 'A confirmed Stage 2 starts breaking down (Stage 2 health turns "weakening": SATA ≤ 3, close well under the 30-week average, or far off the stage high). The stage itself is not changed.', STAGE_UPD),
  stage_1_to_2: S('Stage Analysis', 'Stage 1 → 2 transition', 'Fires only when the stage goes from 1 (basing) straight to 2 (advancing) — the classic breakout from a base.', STAGE_UPD),
  sata_cross_up: S('Stage Analysis', 'SATA score crosses above …', 'The 0–10 SATA score (TheWrap) rises above the level you pick.', STAGE_UPD),
  sata_cross_down: S('Stage Analysis', 'SATA score crosses below …', 'The 0–10 SATA score falls below the level you pick.', STAGE_UPD),
  mrs_cross_up: S('Stage Analysis', 'Mansfield RS crosses above 0', 'Mansfield relative strength vs the S&P 500 (USA) / Nifty 50 (India) turns positive: the stock starts beating the index.', STAGE_UPD),
  cheat_any: S('Setups & patterns', 'Cheat entry trigger', 'The Cheat Entry rules (/cheat-entry): price comes onto its 50-day average (3% under to 5% over) or its 200-day average, not extended. The page’s quality score (your browser’s Multibagger grades) is not applied — pick a quality list as the target.'),
  cheat_50: S('Setups & patterns', 'Cheat entry: 50-day pullback', 'The Cheat Entry board’s 🎯 50DMA pullback: price 3% under to 5% over the 50-day average (nearest pivot).'),
  cheat_200: S('Setups & patterns', 'Cheat entry: 200-day retest', 'The Cheat Entry board’s 🛡 200DMA retest: price 3% under to 5% over the 200-day average (nearest pivot).'),
  cheat_support: S('Setups & patterns', 'Cheat entry: at support now', 'A cheat setup with price within 1% of the average it is resting on — the smallest stop.'),
  pattern_breakout: S('Setups & patterns', 'Breaks out of a pattern', 'A bullish chart pattern (bases, VCP, cup, flag …) has its first close above the pivot. Daily, weekly or monthly patterns (weekly / monthly from completed bars).'),
  pattern_near_pivot: S('Setups & patterns', 'Pattern forming within …% of pivot', 'A bullish pattern still forming, with the close up to the % you pick under its pivot (buy point).'),
  tight_3w: S('Setups & patterns', '3 weeks tight', 'Three or more weekly closes within about 1.5% of each other, price above the 50-day average (O’Neil).'),
  darvas_breakout: S('Setups & patterns', 'Darvas breakout', 'A close above the top of a confirmed Darvas box.'),
  donchian_20: S('Setups & patterns', 'Donchian 20 breakout', 'A close above the highest high of the previous 20 sessions.'),
  donchian_55: S('Setups & patterns', 'Donchian 55 breakout', 'A close above the highest high of the previous 55 sessions (turtle breakout).'),
  squeeze_up: S('Setups & patterns', 'Squeeze fired up', 'A TTM squeeze of at least 5 bars releases with upward momentum (John Carter).'),
  episodic_pivot: S('Setups & patterns', 'Episodic pivot / gap on volume', 'A big gap up on heavy volume (episodic pivot, Pradeep Bonde style).'),
  pocket_pivot: S('Setups & patterns', 'Pocket pivot', 'An up day whose volume is above every down day’s volume of the last 10 sessions (Morales & Kacher).'),
  trend_template: S('Setups & patterns', 'Minervini trend template passes (all 6)', 'All six of Minervini’s trend-template rules pass (price over rising 50 / 150 / 200-day averages, near the high, well off the low).'),
  rs_rating: S('Setups & patterns', 'RS Rating ≥ …', 'The 1–99 RS Rating (12-month weighted performance vs the market’s snapshot) rises to the level you pick or more.'),
  acc_ab: S('Volume & accumulation', 'Accumulation grade becomes A or B', 'The accumulation grade (O’Neil / Wyckoff rules, every gate passed) becomes A or B.'),
  dist_warn: S('Volume & accumulation', 'Distribution warning appears', 'Distribution days (heavy selling, stalling) are piling up.'),
  vol_breakout: S('Volume & accumulation', 'Volume breakout (≥1.5× on a new 50-day closing high)', 'An up day closing above every close of the prior 50 sessions on at least 1.5× average volume, closing in the upper part of the day’s range.'),
  result_strong: S('Fundamentals & results', 'New result filed graded STRONG or BLOCKBUSTER', 'A newly filed quarterly result graded STRONG or BLOCKBUSTER by Earnings Opportunities (India) / US graded results.', RESULTS_UPD, 'results'),
  result_blockbuster: S('Fundamentals & results', 'New result filed graded BLOCKBUSTER', 'A newly filed quarterly result graded BLOCKBUSTER.', RESULTS_UPD, 'results'),
  guidance_raised: S('Fundamentals & results', 'Guidance raised', 'A verified formal guidance upgrade (old and new numbers, same metric and period) from the Guidance Upgrades page.', GUIDE_UPD, 'guidance'),
};

export const signalMeta = (t: CondType): SignalMeta | null => SIGNAL_META[t] ?? null;

// ── data views (filled by signal-sources.ts) ────────────────────────────────

/** The snapshot fields the signals read (a ScreenRow subset; extra fields are ignored). */
export interface SignalRow {
  t: string;
  px?: number | null; scanPx?: number | null; sma50?: number | null; sma200?: number | null;
  twSt?: number | null; twH?: number | null; sata?: number | null; mrs?: number | null;
  pat?: SigTag[]; patW?: SigTag[]; patM?: SigTag[];
  scan?: { st?: string } | null; scanW?: { st?: string } | null; scanM?: { st?: string } | null;
  wt3?: number | null; dvx?: number | null; dc20D?: number | null; dc55D?: number | null; sqzF?: number | null; sqzM?: number | null;
  epD?: number | null; td9?: number | null; udv?: number | null;
  ppD?: number | null; ttOk?: number | null; tt?: number | null; rvol?: number | null; rsR?: number | null;
  accS?: number | null; accR?: number | null; distWarn?: number | null; vboD?: number | null;
}
export interface SigTag { id?: string; b?: 'U' | 'D'; s?: 'f' | 'b' | 'x'; d?: number | null }

/** One source's reading for one market. `version` changes when the data changes (snapshot builtAt / content stamp). */
export interface SourceView<T> { version: string; get(ticker: string): T | null }
export type ResultTier = 'BLOCKBUSTER' | 'STRONG';
export interface SignalFeeds { screen?: SourceView<SignalRow> | null; results?: SourceView<ResultTier> | null; guidance?: SourceView<true> | null }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const b01 = (x: boolean) => (x ? 1 : 0);
/** "within the last 2 sessions" for the windowed setup fields (0 = the last completed session) — a missed build cannot lose one */
const fresh = (d: number | null | undefined) => fin(d) && d <= 1;

function tagsOf(r: SignalRow, tf: PatternTf): SigTag[] | null {
  const tags = tf === 'W' ? r.patW : tf === 'M' ? r.patM : r.pat;
  const scan = tf === 'W' ? r.scanW : tf === 'M' ? r.scanM : r.scan;
  if (Array.isArray(tags)) return tags;
  if (scan && (scan.st === 'ready' || scan.st === 'no-pattern')) return [];
  return null;   // not scanned (yet), too little history, an error, or an old scan version
}
/** setups (lib/setups.ts) were read for this company with the current version — td9 / udv are always set by a reading */
const setupsRead = (r: SignalRow) => fin(r.td9) || fin(r.udv);
const tvRead = (r: SignalRow) => fin(r.tt) || fin(r.rvol) || fin(r.ttOk);
const accRead = (r: SignalRow) => fin(r.accS);

/** The state of one condition from a snapshot row: 1 / 0 (stage_1_to_2: the stage number), null = not known. */
export function screenState(c: AlertCondition, r: SignalRow): number | null {
  const v = c.value ?? NaN;
  switch (c.type) {
    case 'stage_2': return fin(r.twSt) ? b01(r.twSt === 2) : null;
    case 'stage_to': return fin(r.twSt) ? b01(r.twSt === v) : null;
    case 'stage2_weak': if (!fin(r.twSt)) return null; if (r.twSt !== 2) return 0; return fin(r.twH) ? b01(r.twH === 0) : null;
    case 'stage_1_to_2': return fin(r.twSt) ? r.twSt : null;
    case 'sata_cross_up': return fin(r.sata) ? b01(r.sata > v) : null;
    case 'sata_cross_down': return fin(r.sata) ? b01(r.sata < v) : null;
    case 'mrs_cross_up': return fin(r.mrs) ? b01(r.mrs > 0) : null;
    case 'cheat_any': case 'cheat_50': case 'cheat_200': case 'cheat_support': {
      const px = fin(r.px) && r.px > 0 ? r.px : r.scanPx;
      if (!fin(px) || !fin(r.sma50) || !fin(r.sma200)) return null;
      const cs = cheatSetup(px, r.sma50, r.sma200);
      if (!cs) return 0;   // more than 3% under the 200-day average: a broken chart, no setup
      if (c.type === 'cheat_50') return b01(cs.setup === 'AT_50');
      if (c.type === 'cheat_200') return b01(cs.setup === 'AT_200');
      if (c.type === 'cheat_support') return b01(cs.atSupportNow);
      return b01(cs.setup === 'AT_50' || cs.setup === 'AT_200');
    }
    case 'pattern_breakout': { const t = tagsOf(r, c.tf ?? 'D'); return t ? b01(t.some((x) => x.b === 'U' && x.s === 'b')) : null; }
    case 'pattern_near_pivot': { const t = tagsOf(r, c.tf ?? 'D'); return t ? b01(t.some((x) => x.b === 'U' && x.s === 'f' && fin(x.d) && x.d <= 0 && x.d >= -v)) : null; }
    case 'tight_3w': return setupsRead(r) ? b01(fin(r.wt3) && r.wt3 >= 3) : null;
    case 'darvas_breakout': return setupsRead(r) ? b01(r.dvx === 2) : null;
    case 'donchian_20': return setupsRead(r) ? b01(fresh(r.dc20D)) : null;
    case 'donchian_55': return setupsRead(r) ? b01(fresh(r.dc55D)) : null;
    case 'squeeze_up': return setupsRead(r) ? b01(fresh(r.sqzF) && r.sqzM === 1) : null;
    case 'episodic_pivot': return setupsRead(r) ? b01(fresh(r.epD)) : null;
    case 'pocket_pivot': return tvRead(r) ? b01(fresh(r.ppD)) : null;
    case 'trend_template': return fin(r.ttOk) ? b01(r.ttOk === 1) : fin(r.tt) ? b01(r.tt >= 6) : null;
    case 'rs_rating': return fin(r.rsR) ? b01(r.rsR >= v) : null;
    case 'acc_ab': return accRead(r) ? b01(fin(r.accR) && r.accR >= 4) : null;
    case 'dist_warn': return accRead(r) ? b01(r.distWarn === 1) : null;
    case 'vol_breakout': return accRead(r) ? b01(fresh(r.vboD)) : null;
  }
  return null;
}

/** The state of one signal condition for one ticker, and the reading it came from (version null = the source is not available). */
export function signalReading(c: AlertCondition, feeds: SignalFeeds | undefined, ticker: string): { v: number | null; version: string | null } {
  const m = SIGNAL_META[c.type];
  if (!m || !feeds) return { v: null, version: null };
  if (m.source === 'screen') {
    const f = feeds.screen; if (!f) return { v: null, version: null };
    const row = f.get(ticker);
    return { v: row ? screenState(c, row) : null, version: f.version };
  }
  if (m.source === 'results') {
    const f = feeds.results; if (!f) return { v: null, version: null };
    const tier = f.get(ticker);
    return { v: c.type === 'result_blockbuster' ? b01(tier === 'BLOCKBUSTER') : b01(tier === 'BLOCKBUSTER' || tier === 'STRONG'), version: f.version };
  }
  const f = feeds.guidance; if (!f) return { v: null, version: null };
  return { v: b01(f.get(ticker) === true), version: f.version };
}

// ── state + edge ────────────────────────────────────────────────────────────

export interface SignalState {
  /** last KNOWN state (null = never known) */
  v: number | null;
  /** the source reading it was worked out from */
  src: string;
  /** the bar (barKey) an edge was found in and not used yet; null = none */
  edge: string | null;
  /** the alert version (an edit starts the condition afresh) */
  ver: number;
}

export const signalKey = (alertId: string, mid: string, idx: number) => `${alertId}|${mid}|${idx}`;

/** Is the move prev → cur the change this condition fires on? */
export function isEdge(type: CondType, prev: number, cur: number): boolean {
  if (type === 'stage_1_to_2') return prev === 1 && cur === 2;
  return prev === 0 && cur === 1;
}
/** Does the state still hold (keeps an unused edge alive inside its bar)? */
export function holds(type: CondType, cur: number): boolean {
  return type === 'stage_1_to_2' ? cur === 2 : cur === 1;
}

export interface SignalStep { met: boolean; known: boolean; next: SignalState | null; changed: boolean }

/**
 * One check of one signal condition. `prev` = the remembered state (undefined = never seen), `reading` = the source now,
 * `bar` = the current bar key. Recomputes only when the reading's version differs from the remembered one.
 */
export function stepSignal(type: CondType, alertVersion: number, prev: SignalState | undefined, reading: { v: number | null; version: string | null }, bar: string): SignalStep {
  const p = prev && prev.ver === alertVersion ? prev : undefined;
  if (reading.version == null) return { met: false, known: false, next: p ?? null, changed: false };
  if (p && p.src === reading.version) return { met: p.v != null && p.edge === bar, known: p.v != null, next: p, changed: false };
  const v = reading.v;
  let next: SignalState;
  if (v == null) next = { v: p?.v ?? null, src: reading.version, edge: null, ver: alertVersion };
  else if (!p || p.v == null) next = { v, src: reading.version, edge: null, ver: alertVersion };   // first sighting: record only
  else {
    const edge = isEdge(type, p.v, v) ? bar : p.edge === bar && holds(type, v) ? p.edge : null;
    next = { v, src: reading.version, edge, ver: alertVersion };
  }
  const changed = !p || next.v !== p.v || next.edge !== p.edge;
  return { met: v != null && next.edge === bar, known: v != null, next, changed };
}

/** The checker's signal context (states in memory; `dirty` = keys to write to Postgres). */
export interface SignalBook {
  states: Map<string, SignalState>;
  dirty: Set<string>;
  feeds: Map<AlertMarket, SignalFeeds>;
}
export function newSignalBook(feeds: Map<AlertMarket, SignalFeeds> = new Map()): SignalBook {
  return { states: new Map(), dirty: new Set(), feeds };
}

/** Uses up the edges of these keys (the alert fired). Returns what to put back if the fire could not be saved. */
export function consumeEdges(book: SignalBook, keys: readonly string[]): Array<[string, SignalState]> {
  const undo: Array<[string, SignalState]> = [];
  for (const k of keys) {
    const s = book.states.get(k);
    if (!s || s.edge == null) continue;
    undo.push([k, s]);
    book.states.set(k, { ...s, edge: null });
    book.dirty.add(k);
  }
  return undo;
}

/** Which sources each market needs for these conditions. */
export function sourcesFor(conds: readonly AlertCondition[]): Set<SignalSource> {
  const s = new Set<SignalSource>();
  for (const c of conds) { const m = SIGNAL_META[c.type]; if (m) s.add(m.source); }
  return s;
}

/** Ticker lookup in a snapshot: exact, then the US class-share spelling the other way round (BRK.B ↔ BRK-B). */
export function rowIndex<T extends { t: string }>(rows: readonly T[]): (ticker: string) => T | null {
  const m = new Map<string, T>();
  for (const r of rows) if (r && typeof r.t === 'string') m.set(r.t.toUpperCase(), r);
  return (ticker: string) => {
    const t = ticker.toUpperCase();
    return m.get(t) ?? m.get(t.replace(/\./g, '-')) ?? m.get(t.replace(/-/g, '.')) ?? null;
  };
}

/** A small stable stamp of a ticker → value map (the version of a results / guidance reading). */
export function contentStamp(entries: Iterable<[string, string]>): string {
  const parts = [...entries].map(([k, v]) => `${k}=${v}`).sort();
  let h = 2166136261;
  for (const s of parts) for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return `${parts.length}:${h.toString(36)}`;
}
