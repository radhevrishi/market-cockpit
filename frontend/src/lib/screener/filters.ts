// zzz938 — screener filters: the list of fields, how a filter is checked, and the owner's saved screens (copied from his
// TradingView screens). Pure — used by the page and the tests. A company whose figure is not known FAILS a filter on that
// figure (TradingView does the same), so a missing number never sneaks a company in.
// zzz948 — every one of the owner's own TradingView screens (42, read 7 Oct 2026) is built in, under its TradingView name, with the
// fields, comparisons ("≥ another field", "within 0–10% above"), exchange and date filters those screens use.
// zzz994 — + a 'pattern' filter kind (chart patterns on D / W / M, shared with the Pine Screener's query), and price / market-cap
// formatting kept apart (prices 2 decimals — the chart's precision; caps $ T/B/M and ₹ crore with Indian grouping). Formatting is
// display only: every filter compares the unrounded figure.
import type { ScreenRow, ScreenMarket } from './types';
import { TV_SECTORS, allSectorsExcept, type TvSector } from './tv-sectors';
import { PATTERN_META, PATTERN_IDS, PATTERN_NA_REASON, patternApplies, type PatternId, type PatternTag } from '../chart-patterns';

// Non-numeric row fields (and the zzz994 provenance / per-timeframe pattern fields, read defensively where present).
type NonNum = 't' | 'n' | 'sec' | 'ind' | 'q' | 'approx' | 'tvSec' | 'exch' | 'nq' | 'cc' | 'pat' | 'patAt' | 'ccBasis'
  | 'patW' | 'patM' | 'patWAt' | 'patMAt' | 'patV' | 'scan' | 'scanW' | 'scanM' | 'scanAt' | 'scanSrc' | 'scanBasis' | 'scanEx'
  | 'pxSrc' | 'pxAt' | 'pxConflict' | 'live' | 'fcfmAt' | 'fcfmTAt' | 'accG' | 'accP';
export type NumKey = Exclude<keyof ScreenRow, NonNum>;
export type FieldUnit = '%' | 'x' | 'money' | 'num' | 'price' | 'shares' | 'usd' | 'date';
export type FieldGroup = 'Price & volume' | 'Moving averages' | 'Momentum' | 'Trader setups' | 'Volume & accumulation' | 'Growth' | 'Margins & returns' | 'Valuation' | 'Balance sheet' | 'Company';
/** approxNote = worked out differently from TradingView (shown with ≈); sparse = most companies never have this figure (not "still filling") */
export interface FieldDef { key: NumKey; label: string; unit: FieldUnit; markets: ScreenMarket[]; group: FieldGroup; approxNote?: Partial<Record<ScreenMarket, string>>; sparse?: Partial<Record<ScreenMarket, string>> }

const BOTH: ScreenMarket[] = ['US', 'IN'];
const GP_IN = 'India: sales − (material + manufacturing + employee cost) − depreciation, from screener.in\'s expense split (Indian results print no gross profit; this matches TradingView\'s figure within about 1 point for most companies)';
const FQ_IN = 'India: only companies that published a balance sheet for their latest quarter have this (most publish one twice a year) — the same on TradingView';
const PRICE_IN = 'India: Yahoo daily prices, with NSE\'s own official prices for the last 3 months';
const FCFM_US = 'USA: FCF margin of the latest full fiscal year (not trailing twelve months) — (operating cash flow − capex) ÷ revenue; unknown when the company files no capex line; SEC data holds quarterly cash flows only as year-to-date totals';
/** zzz1044 (F03) — where a row's FCF margin comes from, in words ('FY to Mar 2026 · cash-flow proxy'). */
export function fcfmSourceText(r: Partial<ScreenRow>, market: ScreenMarket): string {
  const at = typeof r.fcfmAt === 'string' && r.fcfmAt ? r.fcfmAt : '';
  const yr = at ? `fiscal year to ${at}` : 'latest full fiscal year';
  return market === 'IN' ? `${yr} · cash-flow proxy: (cash from operations + cash from investing) ÷ sales` : `${yr} · (operating cash flow − capex) ÷ revenue, SEC filings`;
}
/** zzz1045e — the trailing-12-month FCF margin (USA only). */
const FCFM_T_US = 'USA: trailing 12 months — (operating cash flow − capex) over the last four fiscal quarters ÷ revenue of the same four quarters. Quarters are worked out from the year-to-date cash-flow totals in each 10-Q (Q2 = first half − Q1, …, Q4 = full year − 9 months), latest amendment first; all four quarters of both lines must be filed, else unknown. Filled in over several daily builds (largest companies first). India has no trailing figure: screener.in prints no quarterly cash flow, so India keeps the full-year cash-flow proxy (FCF margin, latest full year)';
const R40_BLANK = '. Rule of 40 is left blank when revenue growth is above +300% or the FCF margin is outside −100%…+100% (a tiny sales base — the sum would mean nothing)';
const FCFM_IN = 'India: a cash-flow proxy for the latest full fiscal year — (cash from operations + ALL cash from investing) ÷ sales. screener.in prints no capex line, and investing cash can include buying / selling investments or acquisitions; "Exact figures only" leaves these out';
const TW_NOTE = 'Our own version that follows the published rules of TheWrap Stage Analysis (weekly 10 / 30 / 40-week averages, 13-week closing range, 10-point SATA score) — not the original script; readings can differ from TradingView';
/** zzz1020 — a trader-setup field: both markets, group 'Trader setups', the rule as its approx note, optional sparse note. */
const SETUP_NOTE = 'our own version of the published rules';
function setupField(key: NumKey, label: string, unit: FieldUnit, rule: string, sparse?: string): FieldDef[] {
  const note = `${rule} — ${SETUP_NOTE}`;
  return [{ key, label, unit, markets: BOTH, group: 'Trader setups', approxNote: { US: note, IN: note }, ...(sparse ? { sparse: { US: sparse, IN: sparse } } : {}) }];
}
/** zzz1046a — a volume & accumulation field: both markets, the rule as its approx note (read on completed sessions). */
const ACC_NOTE = 'our own version of the published O\'Neil / Wyckoff rules, read on completed sessions; it shows heavy buying or selling, not who did it';
function accField(key: NumKey, label: string, unit: FieldUnit, rule: string, sparse?: string): FieldDef[] {
  const note = `${rule} — ${ACC_NOTE}`;
  return [{ key, label, unit, markets: BOTH, group: 'Volume & accumulation', approxNote: { US: note, IN: note }, ...(sparse ? { sparse: { US: sparse, IN: sparse } } : {}) }];
}
export const FIELDS: readonly FieldDef[] = [
  // price & volume
  { key: 'px', label: 'Price', unit: 'price', markets: BOTH, group: 'Price & volume' },
  { key: 'chg', label: 'Change today', unit: '%', markets: BOTH, group: 'Price & volume' },
  { key: 'chgOpen', label: 'Change from open', unit: '%', markets: BOTH, group: 'Price & volume' },
  { key: 'chg1W', label: 'Change this week (since last week’s close)', unit: '%', markets: BOTH, group: 'Price & volume' },
  { key: 'mc', label: 'Market cap', unit: 'money', markets: BOTH, group: 'Price & volume' },
  { key: 'vol', label: 'Volume (last day)', unit: 'shares', markets: BOTH, group: 'Price & volume' },
  { key: 'vol1W', label: 'Volume this week', unit: 'shares', markets: BOTH, group: 'Price & volume' },
  { key: 'avgVol10', label: 'Avg volume, 10 days', unit: 'shares', markets: BOTH, group: 'Price & volume' },
  { key: 'avgVol30', label: 'Avg volume, 30 days', unit: 'shares', markets: BOTH, group: 'Price & volume' },
  { key: 'avgVol60', label: 'Avg volume, 60 days', unit: 'shares', markets: BOTH, group: 'Price & volume' },
  { key: 'hi52', label: '52-week high', unit: 'price', markets: BOTH, group: 'Price & volume' },
  { key: 'ipoD', label: 'First trading day', unit: 'date', markets: BOTH, group: 'Price & volume', approxNote: { US: 'first day in Yahoo\'s price history (for a company that came through a SPAC, the SPAC\'s listing)', IN: 'first day in Yahoo\'s price history (from 1996 at the earliest)' } },
  // moving averages
  { key: 'sma21', label: 'SMA 21', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  { key: 'sma50', label: 'SMA 50', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  { key: 'sma100', label: 'SMA 100', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  { key: 'sma150', label: 'SMA 150', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  { key: 'sma200', label: 'SMA 200', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  { key: 'ema10', label: 'EMA 10', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  { key: 'ema21', label: 'EMA 21', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  { key: 'ema50', label: 'EMA 50', unit: 'price', markets: BOTH, group: 'Moving averages', approxNote: { IN: PRICE_IN } },
  // momentum
  { key: 'rsi', label: 'RSI 14, daily', unit: 'num', markets: BOTH, group: 'Momentum', approxNote: { IN: PRICE_IN } },
  { key: 'rsiW', label: 'RSI 14, weekly', unit: 'num', markets: BOTH, group: 'Momentum' },
  { key: 'rsiM', label: 'RSI 14, monthly', unit: 'num', markets: BOTH, group: 'Momentum', approxNote: { US: 'worked out on 5 years of monthly closes (TradingView uses the whole history) — usually within 1 point', IN: 'worked out on 5 years of monthly closes (TradingView uses the whole history) — usually within 1 point' } },
  { key: 'atrP', label: 'ATR % (14 days)', unit: '%', markets: BOTH, group: 'Momentum', approxNote: { IN: PRICE_IN } },
  { key: 'adrP', label: 'Average day range %', unit: '%', markets: BOTH, group: 'Momentum', approxNote: { IN: PRICE_IN } },
  { key: 'perf5D', label: 'Change, last 5 trading sessions', unit: '%', markets: BOTH, group: 'Momentum', sparse: { US: 'filled as each company’s prices are re-read after 12 Oct 2026', IN: 'filled as each company’s prices are re-read after 12 Oct 2026' } },
  { key: 'perf1W', label: 'Performance 1 week (7 calendar days)', unit: '%', markets: BOTH, group: 'Momentum' },
  { key: 'perf1M', label: 'Performance 1 month', unit: '%', markets: BOTH, group: 'Momentum' },
  { key: 'perf3M', label: 'Performance 3 months', unit: '%', markets: BOTH, group: 'Momentum' },
  { key: 'perf6M', label: 'Performance 6 months', unit: '%', markets: BOTH, group: 'Momentum' },
  { key: 'perfYTD', label: 'Performance YTD', unit: '%', markets: BOTH, group: 'Momentum' },
  { key: 'perf1Y', label: 'Performance 1 year', unit: '%', markets: BOTH, group: 'Momentum' },
  { key: 'perf5Y', label: 'Performance 5 years', unit: '%', markets: BOTH, group: 'Momentum', approxNote: { US: 'a company listed less than 5 years ago: since its first day', IN: 'a company listed less than 5 years ago: since its first day' } },
  { key: 'perfAll', label: 'Performance since listing', unit: '%', markets: BOTH, group: 'Momentum', approxNote: { US: 'over the last 5 years at most (exact for anything listed in the last 5 years)', IN: 'over the last 5 years at most (exact for anything listed in the last 5 years)' } },
  // zzz984 — the owner's TradingView Pine Screener setups (lib/screener/tv-screens.ts): filled as each company's prices are re-read
  { key: 'tt', label: 'Trend template: rules passed (0–6)', unit: 'num', markets: BOTH, group: 'Momentum' },
  { key: 'ttOk', label: 'Trend template: all 6 rules (1 = yes)', unit: 'num', markets: BOTH, group: 'Momentum' },
  { key: 'rsR', label: 'RS Rating (1–99)', unit: 'num', markets: BOTH, group: 'Momentum', approxNote: { US: 'IBD-style: 0.4 × 3-month + 0.2 × 6, 9 and 12-month performance, ranked against every US company in this screener', IN: 'IBD-style: 0.4 × 3-month + 0.2 × 6, 9 and 12-month performance, ranked against every NSE company in this screener' } },
  { key: 'rsiMA', label: 'RSI 14 average (14 sessions)', unit: 'num', markets: BOTH, group: 'Momentum' },
  { key: 'rsiX', label: 'Sessions since RSI crossed above its average', unit: 'num', markets: BOTH, group: 'Momentum', sparse: { US: 'only companies whose RSI crossed above its average in the last 10 sessions', IN: 'only companies whose RSI crossed above its average in the last 10 sessions' } },
  { key: 'gcD', label: 'Sessions since golden cross (SMA 50 over 200)', unit: 'num', markets: BOTH, group: 'Moving averages', sparse: { US: 'only crosses in the last 20 sessions', IN: 'only crosses in the last 20 sessions' } },
  { key: 'dcD', label: 'Sessions since death cross (SMA 50 under 200)', unit: 'num', markets: BOTH, group: 'Moving averages', sparse: { US: 'only crosses in the last 20 sessions', IN: 'only crosses in the last 20 sessions' } },
  { key: 'emaXU', label: 'Sessions since EMA 10 crossed above EMA 21', unit: 'num', markets: BOTH, group: 'Moving averages', sparse: { US: 'only crosses in the last 20 sessions', IN: 'only crosses in the last 20 sessions' } },
  { key: 'emaXD', label: 'Sessions since EMA 10 crossed below EMA 21', unit: 'num', markets: BOTH, group: 'Moving averages', sparse: { US: 'only crosses in the last 20 sessions', IN: 'only crosses in the last 20 sessions' } },
  { key: 'stage', label: 'Weinstein stage (1–4)', unit: 'num', markets: BOTH, group: 'Momentum' },
  { key: 'st12', label: 'Stage 1 → 2 transition (1 = yes)', unit: 'num', markets: BOTH, group: 'Momentum' },
  { key: 'ppD', label: 'Sessions since volume pocket pivot', unit: 'num', markets: BOTH, group: 'Price & volume', sparse: { US: 'only pocket pivots in the last 10 sessions', IN: 'only pocket pivots in the last 10 sessions' } },
  { key: 'rvol', label: 'Relative volume (vs 50 sessions)', unit: 'x', markets: BOTH, group: 'Price & volume' },
  { key: 'adv$', label: 'Average daily traded value, 20 sessions', unit: 'money', markets: BOTH, group: 'Price & volume' },
  { key: 'ripB', label: 'Ripster EMA clouds bullish (1 = yes)', unit: 'num', markets: BOTH, group: 'Momentum' },
  // zzz987 — Stage Analysis (TheWrap method): our own version that follows the published rules (lib/stage-analysis.ts), not the original script
  { key: 'twSt', label: 'Stage Analysis (TheWrap method): stage 1–4', unit: 'num', markets: BOTH, group: 'Momentum', approxNote: { US: TW_NOTE, IN: TW_NOTE } },
  { key: 'sata', label: 'Stage Analysis (TheWrap method): SATA score 0–10', unit: 'num', markets: BOTH, group: 'Momentum', approxNote: { US: TW_NOTE, IN: TW_NOTE } },
  { key: 'mrs', label: 'Mansfield RS (weekly, vs index)', unit: 'num', markets: BOTH, group: 'Momentum', approxNote: { US: '((close ÷ S&P 500) ÷ its 52-week average − 1) × 100, weekly closes', IN: '((close ÷ Nifty 50) ÷ its 52-week average − 1) × 100, weekly closes' } },
  { key: 'twWk', label: 'Stage Analysis (TheWrap method): weeks in stage (from the confirmed week)', unit: 'num', markets: BOTH, group: 'Momentum', approxNote: { US: TW_NOTE, IN: TW_NOTE } },
  // zzz1020 — trader setups (lib/setups.ts): our own version of the published rules, from the completed daily sessions
  ...setupField('wt3', '3 weeks tight: tight weekly closes (≥ 3)', 'num', 'O\'Neil: weekly closes in a row each within 1.5% of the week before, price above SMA 50', 'only companies with 3 or more tight weekly closes ending this week'),
  ...setupField('wt3P', '3 weeks tight: pivot', 'price', 'the highest weekly high of the tight weeks', 'only companies with 3 weeks tight'),
  ...setupField('udv', 'Up / down volume ratio (50 sessions)', 'x', 'volume on up days ÷ volume on down days over the last 50 sessions — above 1 means more volume on up days (accumulation)'),
  ...setupField('x10A', 'Distance from EMA 10, in ATRs', 'num', '(close − EMA 10) ÷ ATR 14'),
  ...setupField('x50A', 'Distance from SMA 50, in ATRs', 'num', '(close − SMA 50) ÷ ATR 14 — 7 or more is very extended'),
  ...setupField('dvx', 'Darvas box: 1 inside · 2 broke out · 3 broke down', 'num', 'Darvas: a box from a 52-week high, top and bottom each confirmed by 3 bars; 2 / 3 = a close beyond the top / bottom in the last 5 sessions', 'only companies inside a confirmed box or just out of one'),
  ...setupField('dvT', 'Darvas box top', 'price', 'the box top (a 52-week high confirmed by 3 lower highs)', 'only companies with a current Darvas box'),
  ...setupField('dvB', 'Darvas box bottom', 'price', 'the lowest low after the top, confirmed by 3 bars that did not go under it', 'only companies with a current Darvas box'),
  ...setupField('dc20D', 'Sessions since Donchian 20 breakout', 'num', 'Turtle traders: a close above the highest high of the 20 sessions before it', 'only breakouts in the last 10 sessions'),
  ...setupField('dc55D', 'Sessions since Donchian 55 breakout', 'num', 'Turtle traders: a close above the highest high of the 55 sessions before it', 'only breakouts in the last 10 sessions'),
  ...setupField('dc20W', 'Weeks since weekly Donchian 20 breakout', 'num', 'a weekly close above the highest high of the 20 weeks before it', 'only breakouts in the last 10 weeks'),
  ...setupField('sqzN', 'Squeeze: bars in a row (0 = none)', 'num', 'John Carter (TTM Squeeze): Bollinger Bands (20, 2) inside the Keltner Channel (EMA 20 ± 1.5 × ATR 20)'),
  ...setupField('sqzF', 'Sessions since the squeeze fired', 'num', 'the bands moved back outside the channel after a squeeze of at least 5 bars', 'only squeezes that fired in the last 10 sessions'),
  ...setupField('sqzM', 'Squeeze momentum (1 up · −1 down)', 'num', 'sign of the squeeze momentum: 20-bar linear regression of close minus the midline (average of the 20-bar high-low middle and SMA 20)'),
  ...setupField('nr7', 'Narrow range: 7 = NR7 · 4 = NR4 · 0', 'num', 'Toby Crabel: the last session\'s high-low range is the narrowest of the last 7 (or 4) sessions'),
  ...setupField('ib', 'Inside bar (1 = yes)', 'num', 'the last session\'s high and low stay inside the session before'),
  ...setupField('epD', 'Sessions since episodic pivot', 'num', 'Kullamägi / Bonde: gap up 10%+ (India 8%+, at most 60%) on 3× the 50-session average volume after a quiet stretch (≤ +30% over 60 sessions), close still at or above the gap-day low', 'only episodic pivots in the last 10 sessions'),
  ...setupField('epG', 'Episodic pivot: gap %', 'num', 'the opening gap of that episodic pivot, %', 'only companies with an episodic pivot in the last 10 sessions'),
  ...setupField('epE', 'Episodic pivot on results (1 = yes)', 'num', 'the episodic-pivot gap came within 3 days of the latest results date', 'only when both the gap and the results date are known (results dates: India)'),
  ...setupField('gvD', 'Sessions since gap-up with volume', 'num', 'Oliver Kell: open at least 0.75 × ATR 40 above the previous close on 1.5× the 50-session average volume, close still at or above the gap-day low', 'only gaps in the last 10 sessions'),
  ...setupField('mbD', 'Sessions since momentum burst', 'num', 'Pradeep Bonde: a close 4%+ above the previous close on higher volume, the session before not a burst', 'only bursts in the last 5 sessions'),
  ...setupField('antD', 'Quiet day (anticipation, 1 = yes)', 'num', 'Pradeep Bonde: the last session is NR7 or its range is under half the 20-session average range', 'only companies whose last session was quiet'),
  ...setupField('wpD', 'Sessions since wedge pop', 'num', 'Oliver Kell: a close above EMA 10 and EMA 20 after at least 5 closes below both, volume at or above the 50-session average', 'only wedge pops in the last 5 sessions'),
  ...setupField('ecbD', 'Sessions since EMA crossback', 'num', 'Oliver Kell: EMA 10 above a rising EMA 20, the low dips to within 0.5% of EMA 20, close back above EMA 10', 'only crossbacks in the last 5 sessions'),
  ...setupField('nhD', 'Sessions since new 52-week high close', 'num', 'a close above the highest high of the 252 sessions before it', 'only new highs in the last 10 sessions'),
  ...setupField('athD', 'Sessions since all-time high close', 'num', 'a close above every earlier high in the price history we read (about 5 years)', 'only new highs in the last 10 sessions'),
  ...setupField('hgD', 'Sessions since Holy Grail', 'num', 'Linda Raschke: ADX 14 ≥ 30 and rising with +DI above −DI (the session before the touch), the low touches EMA 20, the next session trades above that session\'s high', 'only signals in the last 5 sessions'),
  ...setupField('sprD', 'Sessions since Wyckoff spring', 'num', 'Wyckoff: a dip of up to 5% under a support that held 20+ sessions (lowest low of 60), a close back above within 3 sessions on average-or-better volume', 'only springs in the last 10 sessions'),
  ...setupField('td9', 'TD setup count (−9 … +9)', 'num', 'Tom DeMark: closes in a row above (+) or below (−) the close 4 sessions earlier, starting over after 9'),
  ...setupField('csl', 'CANSLIM points (0–5)', 'num', 'O\'Neil: C quarterly EPS growth ≥ 25%, A TTM EPS growth ≥ 25%, N price ≥ 85% of the 52-week high, S up/down volume ≥ 1.2, L RS Rating ≥ 80 — M (the market\'s trend) is not counted'),
  // zzz1046a — volume & accumulation (lib/accumulation.ts): our own version of the published O'Neil / Wyckoff rules, completed sessions
  ...accField('accS', 'Accumulation score (0–100)', 'num', 'money flow 13 weeks /25 + accumulation − distribution days /20 + up/down volume /15 + On-Balance Volume /15 + big-volume weeks /15 + pullback volume /10; a part with no figure counts half'),
  ...accField('accR', 'Accumulation grade (5 = A … 1 = E)', 'num', 'A score ≥ 80 heavy accumulation · B ≥ 65 · C ≥ 45 neutral · D ≥ 30 · E < 30 heavy distribution'),
  ...accField('accD', 'Accumulation days (last 25 sessions)', 'num', 'up ≥ 1% on at least 1.25× the 50-session average volume, closing in the upper half of the day\'s range (volume breakouts count too)'),
  ...accField('disD', 'Distribution days (last 25 sessions)', 'num', 'down ≥ 1% on at least 1.25× the 50-session average volume, closing in the lower half — stalling days included'),
  ...accField('chD', 'Stalling days (last 25 sessions)', 'num', 'price almost unchanged (under 0.5%) on at least 1.5× average volume, closing near the low — heavy selling into strength'),
  ...accField('cmf21', 'Money flow, 21 sessions (Chaikin)', 'num', 'Chaikin Money Flow: Σ(close location × volume) ÷ Σ volume over 21 sessions, −1 … +1 — positive = closes near the high on volume'),
  ...accField('cmf65', 'Money flow, 13 weeks (Chaikin)', 'num', 'Chaikin Money Flow over 65 sessions (the A/D-rating window), −1 … +1'),
  ...accField('obvSlope', 'On-Balance Volume trend (50 sessions)', 'num', 'least-squares slope of On-Balance Volume over 50 sessions, in average sessions of volume per session (about −1 … +1)'),
  ...accField('obvLead', 'Volume leads price (1 · 0 · −1)', 'num', '1 = On-Balance Volume at its 120-session high while price is not (stealth accumulation) · −1 = price near its high while On-Balance Volume is well below its own (high not confirmed) · 0 = neither'),
  ...accField('bigUpW', 'Big-volume up weeks (last 10 completed)', 'num', 'completed weeks with volume ≥ 1.5× the 10 weeks before, closing up in the upper half of the week\'s range'),
  ...accField('bigDnW', 'Big-volume down weeks (last 10 completed)', 'num', 'completed weeks with volume ≥ 1.5× the 10 weeks before, closing down in the lower half of the week\'s range'),
  ...accField('vdu', 'Quiet pullback (1 = light volume · 0 = heavy)', 'num', 'price below its 50-session closing high but within 15% of it; 1 = the down sessions of the last 10 averaged under 0.75× normal volume (sellers absent)', 'only companies pulling back from a 50-session high'),
  ...accField('vboD', 'Sessions since volume breakout', 'num', 'an up session closing above every close of the 50 before it, on at least 1.5× average volume, in the upper part of its range', 'only volume breakouts in the last 10 sessions'),
  ...accField('vboX', 'Volume breakout: volume ÷ 50-session average', 'x', 'the volume of that breakout session ÷ the average volume of the 50 sessions before it', 'only volume breakouts in the last 10 sessions'),
  ...accField('distWarn', 'Distribution warning (1 = yes)', 'num', '5 or more distribution days in the last 25 sessions, or a price high that On-Balance Volume does not confirm while 21-session money flow is negative'),
  { key: 'dlv10', label: 'Delivery % (10-session average)', unit: '%', markets: ['IN'], group: 'Volume & accumulation', approxNote: { IN: 'NSE price files: shares taken into delivery ÷ shares traded, average of the last 10 sessions (needs 8 known) — higher = more shares kept, not day-traded' } },
  { key: 'dlvChg', label: 'Delivery % change vs the 40 sessions before (points)', unit: 'num', markets: ['IN'], group: 'Volume & accumulation', approxNote: { IN: 'the 10-session delivery % minus the average of the 40 sessions before (needs 20 known), percentage points — NSE price files' } },
  // growth
  { key: 'r40', label: 'Revenue growth YoY + FCF margin (Rule of 40)', unit: '%', markets: BOTH, group: 'Growth', approxNote: { US: FCFM_US + R40_BLANK, IN: FCFM_IN + R40_BLANK } },
  { key: 'r40T', label: 'Revenue growth YoY + FCF margin, trailing 12 months (Rule of 40, USA)', unit: '%', markets: ['US'], group: 'Growth', approxNote: { US: FCFM_T_US + R40_BLANK } },
  { key: 'revQYoY', label: 'Revenue growth, quarterly YoY', unit: '%', markets: BOTH, group: 'Growth' },
  { key: 'revAYoY', label: 'Revenue growth, annual YoY', unit: '%', markets: BOTH, group: 'Growth' },
  { key: 'revTTMYoY', label: 'Revenue growth, TTM YoY', unit: '%', markets: BOTH, group: 'Growth' },
  { key: 'gpQYoY', label: 'Gross profit growth, quarterly YoY', unit: '%', markets: BOTH, group: 'Growth', approxNote: { IN: GP_IN } },
  { key: 'gpAYoY', label: 'Gross profit growth, annual YoY', unit: '%', markets: BOTH, group: 'Growth', approxNote: { IN: GP_IN } },
  { key: 'epsQYoY', label: 'EPS (diluted) growth, quarterly YoY', unit: '%', markets: BOTH, group: 'Growth' },
  { key: 'epsTTMYoY', label: 'EPS (diluted) growth, TTM YoY', unit: '%', markets: BOTH, group: 'Growth' },
  { key: 'ebitdaQoQ', label: 'EBITDA growth, quarterly QoQ', unit: '%', markets: BOTH, group: 'Growth', approxNote: { US: 'USA: operating profit + depreciation where filed, else operating profit' } },
  { key: 'ebitdaQYoY', label: 'EBITDA growth, quarterly YoY', unit: '%', markets: BOTH, group: 'Growth', approxNote: { US: 'USA: operating profit + depreciation where filed, else operating profit' } },
  { key: 'ebitdaTTMYoY', label: 'EBITDA growth, TTM YoY', unit: '%', markets: BOTH, group: 'Growth', approxNote: { US: 'USA: operating profit + depreciation where filed, else operating profit' } },
  { key: 'ebitdaAYoY', label: 'EBITDA growth, annual YoY', unit: '%', markets: BOTH, group: 'Growth', approxNote: { US: 'USA: operating profit + depreciation where filed, else operating profit' } },
  // margins & returns
  { key: 'fcfmTTM', label: 'FCF margin (latest full year)', unit: '%', markets: BOTH, group: 'Margins & returns', approxNote: { US: FCFM_US, IN: FCFM_IN } },
  { key: 'fcfmT', label: 'FCF margin, trailing 12 months (USA)', unit: '%', markets: ['US'], group: 'Margins & returns', approxNote: { US: FCFM_T_US } },
  { key: 'gmFY', label: 'Gross margin, FY', unit: '%', markets: BOTH, group: 'Margins & returns', approxNote: { IN: GP_IN } },
  { key: 'opmTTM', label: 'Operating margin, TTM', unit: '%', markets: BOTH, group: 'Margins & returns', approxNote: { IN: 'India: operating profit after depreciation (before other income)' } },
  { key: 'opmFY', label: 'Operating margin, FY', unit: '%', markets: BOTH, group: 'Margins & returns', approxNote: { IN: 'India: operating profit after depreciation (before other income)' } },
  { key: 'ptmTTM', label: 'Pre-tax margin, TTM', unit: '%', markets: BOTH, group: 'Margins & returns' },
  { key: 'nmTTM', label: 'Net margin, TTM', unit: '%', markets: BOTH, group: 'Margins & returns' },
  { key: 'roeTTM', label: 'ROE, TTM', unit: '%', markets: BOTH, group: 'Margins & returns', approxNote: { US: 'last 4 quarters\' profit ÷ average of this and last year\'s equity', IN: 'last 4 quarters\' profit ÷ equity; only when a balance sheet was published for the latest quarter (as on TradingView)' }, sparse: { IN: FQ_IN } },
  { key: 'roeFY', label: 'ROE, FY', unit: '%', markets: BOTH, group: 'Margins & returns' },
  { key: 'roceTTM', label: 'ROCE, TTM', unit: '%', markets: BOTH, group: 'Margins & returns', approxNote: { US: 'operating profit (last 4 quarters) ÷ (assets − current liabilities)', IN: 'screener.in ROCE of the latest year' } },
  { key: 'roceFY', label: 'ROCE, FY', unit: '%', markets: BOTH, group: 'Margins & returns', approxNote: { IN: 'screener.in ROCE of the latest year' } },
  // valuation
  { key: 'pe', label: 'P/E', unit: 'x', markets: BOTH, group: 'Valuation' },
  { key: 'ps', label: 'P/S', unit: 'x', markets: BOTH, group: 'Valuation' },
  { key: 'evRev', label: 'EV / revenue, TTM', unit: 'x', markets: BOTH, group: 'Valuation' },
  { key: 'pcf', label: 'Price / cash', unit: 'x', markets: BOTH, group: 'Valuation' },
  // balance sheet
  { key: 'de', label: 'Debt / equity, latest quarter', unit: 'x', markets: BOTH, group: 'Balance sheet', approxNote: { IN: 'India: only when a balance sheet was published for the latest quarter — usually twice a year (as on TradingView)' }, sparse: { IN: FQ_IN } },
  { key: 'deFY', label: 'Debt / equity, FY', unit: 'x', markets: BOTH, group: 'Balance sheet' },
  { key: 'cash', label: 'Cash and short-term investments', unit: 'money', markets: BOTH, group: 'Balance sheet' },
  { key: 'netDebt', label: 'Net debt, latest quarter', unit: 'money', markets: BOTH, group: 'Balance sheet', sparse: { IN: FQ_IN } },
  { key: 'liabQ', label: 'Total liabilities, latest quarter', unit: 'money', markets: BOTH, group: 'Balance sheet', sparse: { IN: FQ_IN } },
  { key: 'liabA', label: 'Total liabilities, FY', unit: 'money', markets: BOTH, group: 'Balance sheet' },
  { key: 'debtAssetsQ', label: 'Debt / assets, latest quarter', unit: 'x', markets: BOTH, group: 'Balance sheet', sparse: { IN: FQ_IN } },
  { key: 'debtAssetsA', label: 'Debt / assets, FY', unit: 'x', markets: BOTH, group: 'Balance sheet' },
  { key: 'debtCapQ', label: 'Debt / capital, latest quarter', unit: 'x', markets: BOTH, group: 'Balance sheet', sparse: { IN: FQ_IN } },
  { key: 'debtCapA', label: 'Debt / capital, FY', unit: 'x', markets: BOTH, group: 'Balance sheet' },
  { key: 'debtEbitdaQ', label: 'Debt / EBITDA, latest quarter', unit: 'x', markets: BOTH, group: 'Balance sheet', sparse: { IN: FQ_IN } },
  { key: 'debtEbitdaA', label: 'Debt / EBITDA, FY', unit: 'x', markets: BOTH, group: 'Balance sheet' },
  // company
  { key: 'niFY', label: 'Net income, FY', unit: 'money', markets: BOTH, group: 'Company' },
  { key: 'emp', label: 'Employees', unit: 'num', markets: BOTH, group: 'Company', approxNote: { IN: 'India: Yahoo\'s company profile (not every company has one)' } },
  { key: 'fcfEmp', label: 'Free cash flow per employee, FY', unit: 'usd', markets: ['US'], group: 'Company' },
  { key: 'bb', label: 'Shares buyback ratio, FY', unit: '%', markets: BOTH, group: 'Company' },
  { key: 'fs', label: 'F-score, FY', unit: 'num', markets: BOTH, group: 'Company', approxNote: { IN: 'India: "current ratio" check uses other assets ÷ other liabilities' } },
  { key: 'earnD', label: 'Latest results date', unit: 'date', markets: ['IN'], group: 'Company', approxNote: { IN: 'the results announcement on screener.in; when not listed there, the day the new quarter first appeared in our weekly read' }, sparse: { IN: 'known for results announced in the last few weeks (the page lists recent announcements) or found by our weekly read — enough for "this month"' } },
  { key: 'flt', label: 'Free float %', unit: '%', markets: ['US'], group: 'Company' },
];
export const fieldOf = (k: string): FieldDef | undefined => FIELDS.find((f) => f.key === k);

/** One filter.
 *   num    — a field against a number (gt / ge / lt / le / between — between includes both ends, like TradingView's);
 *   cmp    — a field against another field (above / below = strictly; ge / le = "or equal");
 *   near   — a field lies between lo % and hi % above another (Price within 0–10% above EMA 10 → key px, other ema10, 0, 10);
 *   sector — TradingView sectors (an empty list = all);
 *   exch   — the exchanges (NASDAQ / NYSE / AMEX, NSE / BSE);
 *   date   — a date field this calendar month, or within the last `v` years;
 *   pattern — (zzz994) a chart pattern on the daily / weekly / monthly scan: bias, pattern types, stage, shape score, pivot window. */
export type CmpOp = 'above' | 'below' | 'ge' | 'le';
export type NumOp = 'gt' | 'ge' | 'lt' | 'le' | 'between';
/** zzz974 — `off`: the rule is paused (kept in the screen, not applied). */
export type Filter = (
  | ({ kind: 'pattern' } & PatternRule)
  | { kind: 'num'; key: NumKey; op: NumOp; v: number; v2?: number }
  | { kind: 'cmp'; key: NumKey; op: CmpOp; other: NumKey }
  | { kind: 'near'; key: NumKey; other: NumKey; lo: number; hi: number }
  | { kind: 'sector'; sectors: string[] }
  | { kind: 'exch'; ex: string[] }
  | { kind: 'date'; key: NumKey; op: 'thisMonth' | 'pastYears'; v?: number }
) & { off?: boolean };

export interface Screen { id: string; name: string; market: ScreenMarket; filters: Filter[]; builtIn?: boolean; note?: string }

const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const TV_SET = new Set<string>(TV_SECTORS);
const DAY = 86_400_000;

// ── zzz994: chart-pattern rules (Stock Screener filter kind; the Pine Screener's query uses the same matcher) ─────────────
/** Analysis timeframe of a pattern scan: daily, weekly, monthly bars. */
export type PatTf = 'D' | 'W' | 'M';
export const PATTERN_TFS: ReadonlyArray<{ id: PatTf; label: string; long: string }> = [
  { id: 'D', label: 'D', long: 'daily' }, { id: 'W', label: 'W', long: 'weekly' }, { id: 'M', label: 'M', long: 'monthly' },
];
export type PatStage = 'f' | 'b' | 'x';
export const ALL_STAGES: readonly PatStage[] = ['f', 'b', 'x'];
/** A stored pattern tag as rows carry it: the engine's compact tag + optional length / depth / timeframe / quality fields.
 *  `vq` = volume confirmed (1 / 0; absent = unknown), `dq` = distance from the latest quote (beside `d`, distance from the scan close). */
export type RowTag = PatternTag & { l?: number; dp?: number | null; tf?: PatTf; vq?: boolean | 0 | 1 | null; dq?: number | null };
export interface PatternRule {
  bias: 'U' | 'D' | 'both';
  /** pattern types (empty = every type of the bias) */
  ids: PatternId[];
  /** analysis timeframes; `tfMode` any = a match on one of them, all = a match on every one */
  tfs: PatTf[]; tfMode: 'any' | 'all';
  /** stages (empty = none: the rule matches nothing — never "all") */
  stages: PatStage[];
  /** shape score floor 0–100 (not a probability): possible ≥ 35, likely ≥ 55, very likely ≥ 75 */
  minScore: number;
  /** distance to the pivot in the pattern's direction, % (− = not reached yet) */
  dist: { on: boolean; lo: number; hi: number };
  /** zzz1008 — false: a breakout (breakdown) whose analysis close is back on the near side of its pivot does NOT count as stage
   *  'breakout' (only breakouts holding beyond the pivot); true / absent: it counts (labelled "broke out · back below pivot"). */
  returned?: boolean;
}
export const DEFAULT_PATTERN_RULE: PatternRule = { bias: 'U', ids: [], tfs: ['D'], tfMode: 'any', stages: ['f', 'b'], minScore: 55, dist: { on: true, lo: -15, hi: 5 } };
/** Shape-score bands (a heuristic score of how closely the shape fits the definition — not a win probability). */
export const SHAPE_BANDS: ReadonlyArray<{ min: number; label: string }> = [
  { min: 35, label: 'Possible or better (≥ 35)' }, { min: 55, label: 'Likely or better (≥ 55)' }, { min: 75, label: 'Very likely (≥ 75)' },
];
export const shapeWord = (c: number) => (c >= 75 ? 'very likely' : c >= 55 ? 'likely' : 'possible');
/** Distance in the pattern's direction (bullish: close vs pivot; bearish: the mirror). */
export const tagDirDist = (t: Pick<PatternTag, 'b' | 'd'>): number | null => (t.d == null || !fin(t.d) ? null : t.b === 'U' ? t.d : -t.d);
const asTagList = (v: unknown): RowTag[] | null => (Array.isArray(v) ? (v as RowTag[]).filter((t) => t && typeof t === 'object' && !!PATTERN_META[t.id as PatternId]) : null);
/** The row's tags for one timeframe, or null when that timeframe cannot be read for this company (not scanned yet, too little
 *  history, an error or an outdated scan version — unknown ≠ no pattern). D: `pat` + `scan`; W / M: `patW` / `patM` + `scanW` /
 *  `scanM`. A row without any scan status but with `patAt` (or tags) is an older snapshot row: read as scanned. */
export function patTagsOf(row: unknown, tf: PatTf): RowTag[] | null {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, any>;
  const list = asTagList(r[tf === 'D' ? 'pat' : tf === 'W' ? 'patW' : 'patM']);
  const st: string | undefined = r[tf === 'D' ? 'scan' : tf === 'W' ? 'scanW' : 'scanM']?.st;
  if (st) {
    if (st !== 'ready' && st !== 'no-pattern') return null;
    return (list || []).filter((t) => !t.tf || t.tf === tf).map((t) => (t.tf ? t : { ...t, tf }));
  }
  if (tf === 'D') {
    if (list) return list.filter((t) => !t.tf || t.tf === 'D');
    return r.patAt ? [] : null;
  }
  if (list) return list.map((t) => (t.tf ? t : { ...t, tf }));
  const inBase = asTagList(r.pat)?.filter((t) => t.tf === tf) || [];
  return inBase.length ? inBase : null;
}
/** Why a timeframe cannot be read for a row (for "missing" explanations). */
export function patMissingWhy(row: unknown, tf: PatTf): string {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, any>;
  const st: string | undefined = r[tf === 'D' ? 'scan' : tf === 'W' ? 'scanW' : 'scanM']?.st;
  const name = PATTERN_TFS.find((x) => x.id === tf)?.long || tf;
  if (st === 'insufficient-history') return `${name}: too little price history to read patterns`;
  if (st === 'invalid-data') return `${name}: price data rejected by validation`;
  if (st === 'error') return `${name}: the pattern scan failed`;
  if (st === 'stale-version') return `${name}: read by an older scan version — waiting for a re-read`;
  return `${name}: not scanned yet`;
}
/** Does one tag pass the pattern part (bias, type, stage, score, pivot window)? */
export function tagPasses(t: RowTag, rule: Pick<PatternRule, 'bias' | 'ids' | 'stages' | 'minScore' | 'dist'> & { returned?: boolean }, idSet?: ReadonlySet<string> | null): boolean {
  if (!t || !PATTERN_META[t.id]) return false;
  if (rule.bias !== 'both' && t.b !== rule.bias) return false;
  const ids = idSet !== undefined ? idSet : rule.ids.length ? new Set<string>(rule.ids) : null;
  if (ids && !ids.has(t.id)) return false;
  if (!rule.stages.includes(t.s)) return false;   // empty stages = nothing (zzz994 MC-03)
  if (rule.returned === false && t.s === 'b') { const dd = tagDirDist(t); if (dd != null && dd < 0) return false; }   // zzz1008
  if (!(t.c >= rule.minScore)) return false;
  if (rule.dist.on) {
    const d = tagDirDist(t);
    if (d == null || d < Math.min(rule.dist.lo, rule.dist.hi) || d > Math.max(rule.dist.lo, rule.dist.hi)) return false;
  }
  return true;
}
export interface PatternEval {
  /** pass = matched; fail = scanned and not matched; missing = cannot be decided (a selected timeframe not scanned yet) */
  status: 'pass' | 'fail' | 'missing';
  /** matching tags, each with its timeframe */
  tags: RowTag[];
  missingTfs: PatTf[];
  matchedTfs: PatTf[];
}
/** Evaluate a pattern rule on one row: ANY selected timeframe or ALL selected timeframes; an unscanned timeframe is "missing". */
export function evalPattern(row: unknown, rule: Pick<PatternRule, 'bias' | 'ids' | 'stages' | 'minScore' | 'dist' | 'tfs' | 'tfMode'> & { returned?: boolean }): PatternEval {
  const tfs = rule.tfs?.length ? rule.tfs : (['D'] as PatTf[]);
  const idSet = rule.ids.length ? new Set<string>(rule.ids) : null;
  const tags: RowTag[] = [], missingTfs: PatTf[] = [], matchedTfs: PatTf[] = [];
  let failed = 0;
  for (const tf of tfs) {
    const list = patTagsOf(row, tf);
    if (!list) { missingTfs.push(tf); continue; }
    const hit = list.filter((t) => tagPasses(t, rule, idSet)).map((t) => (t.tf ? t : { ...t, tf }));
    if (hit.length) { matchedTfs.push(tf); tags.push(...hit); } else failed++;
  }
  let status: PatternEval['status'];
  if (rule.tfMode === 'all') status = failed ? 'fail' : missingTfs.length ? 'missing' : 'pass';
  else status = matchedTfs.length ? 'pass' : missingTfs.length ? 'missing' : 'fail';
  return { status, tags: status === 'pass' || rule.tfMode !== 'all' ? tags : [], missingTfs, matchedTfs };
}
const STAGE_WORD: Record<PatStage, string> = { f: 'forming', b: 'breakout', x: 'failed' };
export function patternRuleLabel(r: Pick<PatternRule, 'bias' | 'ids' | 'stages' | 'minScore' | 'dist' | 'tfs' | 'tfMode'>): string {
  const bias = r.bias === 'U' ? '▲ bullish' : r.bias === 'D' ? '▼ bearish' : 'bullish or bearish';
  const types = !r.ids.length ? 'any type' : r.ids.length <= 2 ? r.ids.map((id) => PATTERN_META[id]?.label || id).join(' or ') : `${r.ids.length} types`;
  const tfs = (r.tfs?.length ? r.tfs : ['D']).join(r.tfMode === 'all' ? ' + ' : '/');
  const st = !r.stages.length ? 'no stage selected' : r.stages.length === 3 ? 'all stages' : r.stages.map((s) => STAGE_WORD[s]).join('/');
  const dist = r.dist.on ? ` · ${r.dist.lo}…${r.dist.hi}% to pivot` : '';
  return `Pattern ${bias}: ${types} · ${tfs} · ${st} · score ≥ ${r.minScore}${dist}`;
}
/** zzz1004 (PS-06) — a ticked pattern type the engine does not read on a selected timeframe (PATTERN_TIMEFRAMES): which timeframes,
 *  why (PATTERN_NA_REASON) and the nearest timeframe it is read on. `blocked` = it can never match under this choice (not applicable
 *  on any selected timeframe, or on one of them when every timeframe must match) — a zero there means "not supported", not "none
 *  found". The choice itself is never relaxed automatically. */
export interface UnsupportedChoice { id: PatternId; label: string; tfs: PatTf[]; reason: string; suggest: PatTf | null; blocked: boolean }
export function patternTfSuggest(id: PatternId, from: PatTf): PatTf | null {
  const order: PatTf[] = from === 'M' ? ['W', 'D'] : from === 'W' ? ['D', 'M'] : ['W', 'M'];
  return order.find((tf) => patternApplies(id, tf)) || null;
}
export function unsupportedChoices(ids: readonly PatternId[], tfs: readonly PatTf[], tfMode: 'any' | 'all' = 'any'): UnsupportedChoice[] {
  const sel = tfs.length ? tfs : (['D'] as PatTf[]);
  const out: UnsupportedChoice[] = [];
  for (const id of ids) {
    if (!PATTERN_META[id]) continue;
    const na = sel.filter((tf) => !patternApplies(id, tf));
    if (!na.length) continue;
    const coarsest = na.includes('M') ? 'M' : na.includes('W') ? 'W' : 'D';
    out.push({ id, label: PATTERN_META[id].label, tfs: na, reason: PATTERN_NA_REASON[id] || 'not read on this timeframe', suggest: patternTfSuggest(id, coarsest),
      blocked: na.length === sel.length || tfMode === 'all' });
  }
  return out;
}
const cleanTfList = (v: unknown): PatTf[] => (Array.isArray(v) ? Array.from(new Set(v.filter((x): x is PatTf => x === 'D' || x === 'W' || x === 'M'))) : []);
const cleanStageList = (v: unknown): PatStage[] => (Array.isArray(v) ? Array.from(new Set(v.filter((x): x is PatStage => x === 'f' || x === 'b' || x === 'x'))) : []);
/** Pure clean-up of a stored pattern rule (unknown parts take the default; an empty stage list stays empty = matches nothing). */
export function cleanPatternRule(x: any): PatternRule {
  const d = DEFAULT_PATTERN_RULE;
  const tfs = cleanTfList(x?.tfs);
  return {
    bias: x?.bias === 'D' || x?.bias === 'both' ? x.bias : x?.bias === 'U' ? 'U' : d.bias,
    ids: Array.from(new Set<PatternId>((Array.isArray(x?.ids) ? x.ids : []).filter((i: unknown): i is PatternId => typeof i === 'string' && i in PATTERN_META))).slice(0, PATTERN_IDS.length),
    tfs: tfs.length ? tfs : ['D'], tfMode: x?.tfMode === 'all' ? 'all' : 'any',
    stages: Array.isArray(x?.stages) ? cleanStageList(x.stages) : d.stages.slice(),
    minScore: fin(x?.minScore) ? Math.min(100, Math.max(35, x.minScore)) : d.minScore,
    dist: x?.dist && typeof x.dist === 'object' && fin(x.dist.lo) && fin(x.dist.hi) ? { on: x.dist.on !== false, lo: x.dist.lo, hi: x.dist.hi } : { ...d.dist },
  };
}

/** exactOnly (zzz957): a figure this company has only as an approximation (≈ on the row, e.g. EV / revenue with debt taken as 0
 *  because no debt line is filed) fails the filter instead of passing on an assumption. */
export function passes(r: ScreenRow, f: Filter, now: Date = new Date(), exactOnly = false): boolean {
  if (f.off) return true;
  if (f.kind === 'sector') {
    if (!f.sectors.length) return true;
    // a screen saved before zzz948 ticks the source's own sector names; TradingView names are matched against our TradingView sector
    const tv = f.sectors.some((s) => TV_SET.has(s));
    const v = tv ? r.tvSec : r.sec;
    return !!v && f.sectors.includes(v);
  }
  if (f.kind === 'exch') return !f.ex.length || (Array.isArray(r.exch) && r.exch.some((e) => f.ex.includes(e)));
  if (f.kind === 'pattern') return evalPattern(r, f).status === 'pass';   // strict: an unscanned timeframe never passes
  if (exactOnly && Array.isArray(r.approx) && filterKeys(f).some((k) => r.approx!.includes(k))) return false;
  const a = r[f.key] as number | null | undefined;
  if (!fin(a)) return false;
  if (f.kind === 'date') {
    if (f.op === 'thisMonth') { const d = new Date(a * DAY); return d.getUTCFullYear() === now.getUTCFullYear() && d.getUTCMonth() === now.getUTCMonth(); }
    const yrs = fin(f.v) ? f.v : 5;
    const from = new Date(now); from.setUTCFullYear(from.getUTCFullYear() - yrs);
    return a * DAY >= from.getTime() && a * DAY <= now.getTime();
  }
  if (f.kind === 'cmp' || f.kind === 'near') {
    const b = r[f.other] as number | null | undefined;
    if (!fin(b)) return false;
    if (f.kind === 'near') { if (!(b > 0)) return false; const p = (a / b - 1) * 100; return p >= Math.min(f.lo, f.hi) && p <= Math.max(f.lo, f.hi); }
    return f.op === 'above' ? a > b : f.op === 'below' ? a < b : f.op === 'ge' ? a >= b : a <= b;
  }
  if (f.op === 'gt') return a > f.v;
  if (f.op === 'ge') return a >= f.v;
  if (f.op === 'lt') return a < f.v;
  if (f.op === 'le') return a <= f.v;
  const v2 = fin(f.v2) ? f.v2 : f.v;
  return a >= Math.min(f.v, v2) && a <= Math.max(f.v, v2);
}
export const runScreen = (rows: readonly ScreenRow[], filters: readonly Filter[], now: Date = new Date(), exactOnly = false): ScreenRow[] => rows.filter((r) => filters.every((f) => passes(r, f, now, exactOnly)));

/** How many companies each single filter keeps (so the owner sees which filter is the tight one). */
export function filterCounts(rows: readonly ScreenRow[], filters: readonly Filter[], now: Date = new Date(), exactOnly = false): number[] {
  return filters.map((f) => rows.reduce((n, r) => n + (passes(r, f, now, exactOnly) ? 1 : 0), 0));
}
/** The fields a filter reads (to show them as columns and to tell how many companies have the figure yet). */
export function filterKeys(f: Filter): NumKey[] {
  if (f.kind === 'num' || f.kind === 'date') return [f.key];
  if (f.kind === 'cmp' || f.kind === 'near') return [f.key, f.other];
  return [];
}

// ── labels ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** zzz994 (MC-08) — a share price at the chart's precision: 2 decimals below 10,000 (4 below 1 — US sub-dollar ticks), 1 above. */
export function fmtPrice(v: number | null | undefined, market: ScreenMarket): string {
  if (!fin(v)) return '—';
  const a = Math.abs(v);
  const dp = a < 1 ? 4 : a < 10_000 ? 2 : 1;
  return `${v < 0 ? '−' : ''}${market === 'US' ? '$' : '₹'}${a.toLocaleString(market === 'US' ? 'en-US' : 'en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
}
/** zzz994 (MC-08) — money in the snapshot's unit: USA $ million shown as $ T / B / M, India ₹ crore with Indian grouping. */
export function fmtMoney(v: number | null | undefined, market: ScreenMarket): string {
  if (!fin(v)) return '—';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (market === 'US') {
    const f = (x: number, dp: number) => x.toLocaleString('en-US', { maximumFractionDigits: dp });
    if (a >= 1e6) return `${s}$${f(a / 1e6, 2)}T`;
    if (a >= 1000) return `${s}$${f(a / 1000, a >= 100_000 ? 0 : 1)}B`;
    return `${s}$${f(a, a >= 10 ? 0 : 2)}M`;
  }
  return `${s}₹${a.toLocaleString('en-IN', { maximumFractionDigits: a >= 100 ? 0 : 2 })} Cr`;
}
/** The unrounded figure for a tooltip (what filters compare). */
export function fmtExact(v: number | null | undefined): string {
  return fin(v) ? String(v) : 'not known';
}
export function fmtValue(v: number | null | undefined, unit: FieldUnit, market: ScreenMarket): string {
  if (!fin(v)) return '—';
  if (unit === '%') return `${Math.round(v * 10) / 10}%`;
  if (unit === 'x') return `${Math.round(v * 100) / 100}`;
  if (unit === 'date') return new Date(v * DAY).toISOString().slice(0, 10);
  if (unit === 'money') return fmtMoney(v, market);
  if (unit === 'usd') { const a = Math.abs(v); const s = v < 0 ? '−' : ''; return a >= 1e6 ? `${s}$${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${s}$${(a / 1e3).toFixed(0)}K` : `${s}$${Math.round(a)}`; }
  if (unit === 'shares' || unit === 'num') return v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : `${Math.round(v * 10) / 10}`;
  return fmtPrice(v, market);
}
const OPS: Record<string, string> = { gt: '>', ge: '≥', lt: '<', le: '≤', above: '>', below: '<' };
export function filterLabel(f: Filter, market: ScreenMarket): string {
  if (f.kind === 'sector') return `Sector (${f.sectors.length || 'all'})`;
  if (f.kind === 'exch') return `Exchange ${f.ex.join(' / ') || 'any'}`;
  if (f.kind === 'pattern') return patternRuleLabel(f);
  const d = fieldOf(f.key); const name = d?.label || f.key;
  if (f.kind === 'date') return f.op === 'thisMonth' ? `${name}: this month` : `${name}: last ${f.v ?? 5} years`;
  if (f.kind === 'near') return `${name} ${f.lo}–${f.hi}% above ${fieldOf(f.other)?.label || f.other}`;
  if (f.kind === 'cmp') return `${name} ${OPS[f.op]} ${fieldOf(f.other)?.label || f.other}`;
  const u = d?.unit || 'num';
  if (f.op === 'between') return `${name} ${fmtValue(f.v, u, market)} to ${fmtValue(f.v2 ?? f.v, u, market)}`;
  return `${name} ${OPS[f.op]} ${fmtValue(f.v, u, market)}`;
}

// ── the owner's screens (his own TradingView screens, read 7 Oct 2026) ─────────────────────────────────────────────────
// Market caps in TradingView are raw currency; here USA is $ million and India ₹ crore: $200,000,000 = 200; ₹100,000,000 = ₹10 Cr.
// TradingView's "between" includes both ends; an open end (null) becomes ≥ / ≤. "Common stock" filters are not repeated: both
// universes hold common stock only (no ETFs, funds, warrants, preferreds).
/** TradingView raw market cap → ours: $ million (US) or ₹ crore (India). */
export const capOf = (raw: number, m: ScreenMarket) => (m === 'US' ? raw / 1e6 : raw / 1e7);
const n = (key: NumKey, op: NumOp, v: number): Filter => ({ kind: 'num', key, op, v });
const btw = (key: NumKey, v: number, v2: number): Filter => ({ kind: 'num', key, op: 'between', v, v2 });
const cmp = (key: NumKey, op: CmpOp, other: NumKey): Filter => ({ kind: 'cmp', key, op, other });
const near = (key: NumKey, other: NumKey, lo: number, hi: number): Filter => ({ kind: 'near', key, other, lo, hi });
const sec = (...s: TvSector[]): Filter => ({ kind: 'sector', sectors: s });
const secEx = (...not: TvSector[]): Filter => ({ kind: 'sector', sectors: allSectorsExcept(...not) });
const ex = (...e: string[]): Filter => ({ kind: 'exch', ex: e });
const cap = (m: ScreenMarket, lo: number | null, hi: number | null): Filter =>
  lo != null && hi != null ? btw('mc', capOf(lo, m), capOf(hi, m)) : lo != null ? n('mc', 'ge', capOf(lo, m)) : n('mc', 'le', capOf(hi as number, m));

// the sector lists his screens use
const S15: TvSector[] = allSectorsExcept('Energy Minerals', 'Finance', 'Health Services', 'Health Technology', 'Industrial Services', 'Non-Energy Minerals');
const S15_IS: TvSector[] = allSectorsExcept('Energy Minerals', 'Finance', 'Health Services', 'Health Technology', 'Transportation', 'Non-Energy Minerals');

// screens that exist for both markets in TradingView ([america, india]) — one copy per market
function dual(id: string, name: string, f: (m: ScreenMarket) => Filter[], note?: Partial<Record<ScreenMarket, string>>): Screen[] {
  return (['US', 'IN'] as const).map((m) => ({ id: `${m === 'US' ? 'us' : 'in'}-${id}`, name, market: m, builtIn: true, filters: f(m), ...(note?.[m] ? { note: note[m] } : {}) }));
}

/** zzz999 — moved here from the Pine Screener (it is about fundamentals only): his "Revenue Growth YoY + FCF Margin" script.
 *  The US copy keeps the old Pine id 'tv-rule-of-40'; the Pine Screener can use either copy as its company list. */
export const RULE_OF_40_NOTE = 'Your "Revenue Growth YoY + FCF Margin" script: latest quarter\'s revenue growth % + FCF margin % ≥ 40. The FCF margin is the latest full fiscal year (not trailing twelve months); in India it is a cash-flow proxy (see the filter tip). Moved here from the Pine Screener; pick it there under Companies to see which of these charts are setting up.';
function RULE_OF_40(m: ScreenMarket): Screen {
  return { id: m === 'US' ? 'tv-rule-of-40' : 'tv-rule-of-40-in', name: 'Rule of 40 (based on your TradingView script)', market: m, builtIn: true, filters: [n('r40', 'ge', 40)], note: RULE_OF_40_NOTE };
}

const US_SCREENS: Screen[] = [
  { id: 'us-daily-gainers', name: 'Daily Gainers Stocks', market: 'US', builtIn: true, filters: [n('chg', 'gt', 4.7), cap('US', 300e6, 800e9)] },
  { id: 'us-zachs', name: 'ZACHS SCREENER', market: 'US', builtIn: true, filters: [
    n('revQYoY', 'gt', 9), n('epsQYoY', 'gt', 15), cap('US', 100e6, 50e9), cmp('sma50', 'ge', 'sma200'), sec('Technology Services', 'Electronic Technology', 'Producer Manufacturing'),
    n('gpQYoY', 'gt', 5), btw('ps', 0, 7), n('de', 'lt', 1), n('roceTTM', 'gt', -10), n('pcf', 'le', 15), n('gmFY', 'gt', 15), n('fs', 'gt', 4.9),
    n('ebitdaAYoY', 'gt', -10), n('evRev', 'lt', 20), n('cash', 'gt', 0), n('avgVol10', 'gt', 60_000),
  ] },
  { id: 'us-small-cap-crushed', name: 'small cap crushed earnings', market: 'US', builtIn: true, filters: [
    n('revQYoY', 'gt', 9), n('epsQYoY', 'gt', 10), n('vol', 'ge', 10_000), cap('US', 100e6, 5e9), cmp('sma50', 'ge', 'sma200'), sec(...TV_SECTORS),
    n('gpQYoY', 'gt', 10), btw('ps', 0, 7), n('roceTTM', 'gt', -10),
  ] },
  { id: 'us-overall', name: 'Overall Screener — all companies (start a screen)', market: 'US', builtIn: true, filters: [], note: 'No filters: every listed company. A starting point — add rules, then "Save as new…". (Your TradingView "Overall Screener".)' },
  { id: 'us-future-nvda', name: 'Future NVDIA ALAB APP PLTR(USA)', market: 'US', builtIn: true, filters: [
    sec(...S15), n('ebitdaQoQ', 'gt', 0), n('revQYoY', 'gt', 25), n('revAYoY', 'gt', 10), n('emp', 'gt', 100), n('gmFY', 'gt', 25),
    n('de', 'lt', 1), btw('ps', 3, 333), n('gpQYoY', 'gt', 50), n('opmTTM', 'gt', -15), n('bb', 'gt', -25),
  ], note: 'TradingView\'s "Float shares 80 to 111,111" filter is left out: it is a share count, so every company with a float passes it.' },
  { id: 'us-super-scalers-full', name: 'Future Super Scalers like NBIS Full', market: 'US', builtIn: true, filters: [
    sec(...S15), n('vol', 'ge', 30_000), n('de', 'lt', 2), n('revAYoY', 'gt', 10), n('revQYoY', 'gt', 20), n('bb', 'gt', -25), cap('US', 200e6, 30e9),
    cmp('sma50', 'above', 'sma200'), n('perfYTD', 'lt', 300),
  ] },
  { id: 'us-bonde-ep', name: 'Sales And EPS Growth for EP - Pradeep Bonde style', market: 'US', builtIn: true, filters: [
    sec(...S15), n('revQYoY', 'gt', 39), cap('US', 300e6, 500e9), cmp('sma50', 'above', 'sma200'), n('avgVol60', 'gt', 500_000), n('epsQYoY', 'gt', 30), n('vol1W', 'gt', 500_000),
  ] },
  { id: 'us-super-scalers-main', name: 'Future Super Scalers like NBIS Main (= NBIS 2)', market: 'US', builtIn: true, filters: [
    sec(...S15_IS), n('vol', 'ge', 30_000), cap('US', 200e6, 30e9), n('revAYoY', 'gt', 10), n('de', 'lt', 2), n('revQYoY', 'gt', 20), cmp('sma50', 'ge', 'sma200'),
  ], note: 'TradingView has two identical screens, "Future Super Scalers like NBIS Main" and "Future Super Scalers like NBIS 2" — one entry here.' },
  { id: 'us-super-scalers', name: 'Future Super Scalers like NBIS', market: 'US', builtIn: true, filters: [
    sec('Communications', 'Consumer Durables', 'Consumer Non-Durables', 'Distribution Services', 'Electronic Technology', 'Government', 'Miscellaneous', 'Industrial Services', 'Producer Manufacturing', 'Retail Trade', 'Technology Services', 'Consumer Services'),
    n('vol', 'ge', 30_000), cap('US', 200e6, 20e9), n('revAYoY', 'gt', 20), n('revQYoY', 'gt', 0), cmp('sma50', 'ge', 'sma200'),
  ] },
  { id: 'us-pead', name: 'PEAD', market: 'US', builtIn: true, filters: [
    n('epsQYoY', 'gt', 50), btw('revQYoY', 15, 500), btw('pe', 22, 100), n('de', 'lt', 1.5), cap('US', 500e6, null), n('gmFY', 'gt', 20), n('roeTTM', 'gt', 12), n('opmFY', 'gt', 0), ex('NASDAQ', 'NYSE'),
  ] },
  { id: 'us-momentum-bursts', name: 'Qualmagggie and Momentum Bursts', market: 'US', builtIn: true, filters: [
    cap('US', 300e6, 50e9), n('perf3M', 'gt', 80), n('perf6M', 'gt', 150), cmp('px', 'ge', 'sma21'), n('px', 'ge', 5), n('avgVol30', 'gt', 1_000_000), cmp('sma50', 'ge', 'sma200'), n('avgVol60', 'gt', 500_000),
  ] },
  { id: 'us-future-nvda-india2', name: 'Future NVDIA ALAB APP PLTR(India 2)', market: 'US', builtIn: true, filters: [
    sec(...TV_SECTORS), n('ebitdaQoQ', 'gt', 0), cap('US', 300e6, 500e9), n('revQYoY', 'gt', 20), n('revAYoY', 'gt', 10), n('emp', 'gt', 100), n('gmFY', 'gt', 25), n('roeTTM', 'gt', 5),
    n('de', 'lt', 1.5), btw('ps', 3, 333), n('gpQYoY', 'gt', 35), n('opmTTM', 'gt', 10), n('nmTTM', 'gt', 20),
  ], note: 'In TradingView this screen runs on the US market, despite "India" in its name.' },
  { id: 'us-stage-ipo-shorts', name: 'Stage Analysis IPO Shorts', market: 'US', builtIn: true, filters: [
    secEx('Energy Minerals', 'Finance'), cap('US', 300e6, 3e12), cmp('px', 'below', 'sma50'), n('perf3M', 'lt', -20), { kind: 'date', key: 'ipoD', op: 'pastYears', v: 5 }, n('perfAll', 'gt', 200),
  ] },
  { id: 'us-stage-short', name: 'Stage Analysis Short', market: 'US', builtIn: true, filters: [
    secEx('Energy Minerals', 'Finance'), cap('US', 300e6, 3e12), cmp('sma150', 'below', 'sma200'), cmp('px', 'below', 'sma50'), cmp('px', 'below', 'sma150'), cmp('sma50', 'below', 'sma150'),
    n('perf3M', 'lt', -10), n('perf6M', 'lt', -20),
  ] },
  { id: 'us-breakout', name: 'Breakout Screeener', market: 'US', builtIn: true, filters: [
    secEx('Energy Minerals', 'Finance', 'Non-Energy Minerals'), cap('US', 300e6, null), n('de', 'lt', 1.5), n('fcfEmp', 'ge', 0), n('avgVol10', 'gt', 500_000), n('adrP', 'ge', 2),
    cmp('px', 'above', 'ema21'), cmp('px', 'above', 'ema50'), n('chg', 'gt', 0.01), n('px', 'ge', 3), n('revQYoY', 'gt', 20), n('gpQYoY', 'gt', 30),
  ] },
  { id: 'us-crash-nvda', name: 'Crash Scenario Future NVDIA ALAB APP PLTR(India) / (USA)', market: 'US', builtIn: true, filters: [
    sec(...TV_SECTORS), cap('US', 300e6, 500e9), n('emp', 'gt', 100), n('gmFY', 'gt', 25), n('de', 'lt', 2),
  ], note: 'TradingView has two identical screens, "Crash Scenario … (India)" and "Crash Scenario … (USA)", both on the US market — one entry here.' },
  { id: 'us-all-growth', name: 'All Growth Stocks', market: 'US', builtIn: true, filters: [
    secEx('Non-Energy Minerals', 'Finance'), n('vol', 'ge', 100_000), cap('US', 900e6, null), n('revQYoY', 'gt', 18), n('nmTTM', 'gt', 0), n('opmFY', 'gt', -30), n('revTTMYoY', 'gt', 18),
    n('niFY', 'gt', 0), n('gmFY', 'gt', 20), n('roeTTM', 'gt', -15), n('de', 'lt', 3),
  ] },
  { id: 'us-ath', name: 'ATH Stocks', market: 'US', builtIn: true, filters: [cap('US', 750e6, null), n('epsTTMYoY', 'gt', 25), near('hi52', 'px', 0, 10)] },
  RULE_OF_40('US'),
];

const DUAL_SCREENS: Screen[] = [
  ...dual('qullamaggie-leaders', 'Qualmaggie Leader Stocks in Bearmarket or Corrections', (m) => [
    sec(...S15), n('revQYoY', 'gt', 20), cap(m, 300e6, 500e9), n('px', 'ge', 5), cmp('px', 'ge', 'ema21'), cmp('px', 'ge', 'ema50'), cmp('sma50', 'above', 'sma200'),
    cmp('sma150', 'ge', 'sma200'), n('avgVol10', 'gt', 100_000), cmp('sma50', 'above', 'sma100'), n('perf1Y', 'gt', 10), n('perf6M', 'gt', 20), n('perf3M', 'gt', 10),
    n('atrP', 'gt', 3), n('chgOpen', 'gt', 0), near('px', 'ema10', 0, 10), n('perf1W', 'gt', 2), ...(m === 'US' ? [ex('NASDAQ', 'NYSE')] : []),
  ], { IN: 'TradingView\'s copy also has "Exchange NASDAQ / NYSE", so on TradingView it shows no Indian stocks; that filter is left out here.' }),
  ...dual('minervini', 'Minervni Stocks', (m) => [
    sec(...S15), n('revQYoY', 'gt', 20), cap(m, 300e6, 500e9), cmp('px', 'ge', 'sma50'), cmp('sma50', 'above', 'sma200'), cmp('sma150', 'ge', 'sma200'), n('avgVol60', 'gt', 500_000),
    n('rsi', 'ge', 55), n('epsTTMYoY', 'gt', 0), cmp('sma50', 'above', 'sma100'), n('perf1Y', 'gt', 10), n('perf6M', 'gt', 20), n('perf3M', 'gt', 10),
  ]),
  ...dual('episodic-pivot', 'EPISODIC PIVOT / VOLUME SURGE', (m) => [
    n('chg', 'gt', 3), n('px', 'ge', 5), cap(m, 300e6, 500e9), cmp('px', 'ge', 'sma50'), n('avgVol60', 'gt', 500_000), cmp('vol', 'above', 'avgVol10'), cmp('sma50', 'above', 'sma200'),
    sec(...S15), n('revQYoY', 'gt', 0),
  ]),
  ...dual('liquidity-leaders', 'Liquidity Leaders', (m) => [
    sec(...S15_IS), cap(m, 300e6, 10e12), n('rsi', 'ge', 55), n('px', 'ge', 10), cmp('px', 'ge', 'sma50'), n('avgVol60', 'gt', 500_000), n('perf6M', 'gt', 25), n('perf1Y', 'gt', 40),
    n('revQYoY', 'gt', 25), cmp('sma50', 'above', 'sma200'),
  ]),
  ...dual('weekly-gainer-usa', 'Weekly Gainer Stocks USA', (m) => [
    sec(...S15_IS), n('chg1W', 'gt', 9), n('px', 'ge', 5), cap(m, 300e6, 10e12), cmp('px', 'ge', 'sma50'), n('avgVol10', 'gt', 900_000),
  ]),
];

const IN_SCREENS: Screen[] = [
  { id: 'in-debt-reduction', name: 'DEBT REDUCTION', market: 'IN', builtIn: true, filters: [
    n('de', 'lt', 1), cap('IN', 300e6, 700e9), n('opmFY', 'gt', 10), cmp('de', 'below', 'deFY'), ex('BSE'), cmp('debtEbitdaQ', 'below', 'debtEbitdaA'), cmp('liabQ', 'below', 'liabA'),
    cmp('debtAssetsQ', 'below', 'debtAssetsA'), cmp('debtCapQ', 'below', 'debtCapA'),
  ], note: 'The "latest quarter" balance-sheet figures exist only when a company published a balance sheet for its latest quarter (usually twice a year) — the same on TradingView, so this screen is near-empty between results seasons.' },
  { id: 'in-zachs', name: 'ZACHS SCREENER India', market: 'IN', builtIn: true, filters: [
    n('revQYoY', 'gt', 9), n('epsQYoY', 'gt', 15), cap('IN', 100e6, 50e9), cmp('sma50', 'ge', 'sma200'), sec('Technology Services', 'Electronic Technology', 'Producer Manufacturing'),
    n('gpQYoY', 'gt', 5), btw('ps', 0, 7), n('gmFY', 'gt', 15), n('fs', 'gt', 4.9), n('ebitdaAYoY', 'gt', -10), n('evRev', 'lt', 20), n('cash', 'gt', 0), n('avgVol10', 'gt', 60_000),
  ] },
  { id: 'in-rsi-m-over-w', name: 'RSI Monthly greater than RSI Weekly', market: 'IN', builtIn: true, filters: [
    n('epsTTMYoY', 'gt', 20), secEx('Finance'), cap('IN', 50e6, 900e9), n('avgVol10', 'gt', 500_000), n('revQYoY', 'gt', 20), cmp('sma50', 'ge', 'sma200'), n('gpQYoY', 'gt', 20),
    n('emp', 'gt', 1000), n('deFY', 'lt', 2), cmp('rsiM', 'above', 'rsiW'),
  ] },
  { id: 'in-future-nvda-2', name: 'Future NVDIA ALAB APP PLTR(India) 2', market: 'IN', builtIn: true, filters: [
    secEx('Health Services', 'Non-Energy Minerals'), cap('IN', 5e9, 300e9), n('revQYoY', 'gt', 25), n('revAYoY', 'gt', 10), n('gmFY', 'gt', 25), btw('gpQYoY', 35, 150),
    n('opmTTM', 'gt', 18), n('perf5Y', 'lt', 500), n('roceFY', 'gt', 5), n('roeFY', 'gt', 5),
  ] },
  { id: 'in-pead', name: 'PEAD India', market: 'IN', builtIn: true, filters: [
    n('epsQYoY', 'gt', 50), btw('revQYoY', 20, 800), btw('pe', 18, 200), n('de', 'lt', 1.5), cap('IN', 300e6, null), n('gmFY', 'gt', 20), n('roeTTM', 'gt', 12), n('opmFY', 'gt', 0),
    ex('NSE'), { kind: 'date', key: 'earnD', op: 'thisMonth' }, n('ebitdaTTMYoY', 'gt', 0),
  ] },
  { id: 'in-daily-gainers', name: 'Daily Gainers Stocks India', market: 'IN', builtIn: true, filters: [
    n('epsQYoY', 'gt', 0), n('chg', 'gt', 4.7), cap('IN', 300e6, 30e9), n('revQYoY', 'gt', 20), n('vol', 'gt', 100_000),
  ] },
  { id: 'in-reject', name: 'Reject Stocks Scanner — all companies (no filters)', market: 'IN', builtIn: true, filters: [], note: 'No filters: every listed company (your TradingView "Reject Stocks Scanner" had none active). A starting point — add rules, then "Save as new…".' },
  { id: 'in-breakout', name: 'Breakout Scanner', market: 'IN', builtIn: true, filters: [
    n('px', 'ge', 5), cmp('px', 'ge', 'sma21'), cmp('px', 'ge', 'sma50'), n('avgVol10', 'gt', 100_000), cap('IN', 500e6, null), n('revQYoY', 'gt', 15), n('perf1W', 'gt', 7),
    n('perf1M', 'gt', 0), cmp('sma21', 'ge', 'sma50'), n('chgOpen', 'gt', 0), near('px', 'ema10', 0, 10), n('atrP', 'gt', 3),
  ] },
  { id: 'in-ipo-winners', name: 'IPO Winners', market: 'IN', builtIn: true, filters: [
    secEx('Finance', 'Health Services', 'Health Technology'), cap('IN', 300e6, 900e9), n('revQYoY', 'gt', 20), n('emp', 'gt', 40), n('gmFY', 'gt', 20), n('de', 'lt', 1.5),
    btw('ps', 1, 80), n('gpQYoY', 'gt', 30), { kind: 'date', key: 'ipoD', op: 'pastYears', v: 5 }, n('perf5Y', 'lt', 500), cmp('sma50', 'ge', 'sma200'), n('revAYoY', 'gt', 10),
  ] },
  { id: 'in-overall-good', name: 'Overall Screener with Good Criteria', market: 'IN', builtIn: true, filters: [
    n('gpAYoY', 'gt', 20), n('revQYoY', 'gt', 20), cap('IN', 900e6, 1050e9), n('netDebt', 'lt', 0), n('epsQYoY', 'gt', 20), ex('NSE'), n('perf5Y', 'lt', 200),
  ] },
  { id: 'in-leaders-correction', name: 'Leader Stocks in Bearmarket or Correction', market: 'IN', builtIn: true, filters: [
    n('px', 'ge', 5), cmp('px', 'ge', 'sma21'), cmp('px', 'ge', 'sma50'), n('avgVol10', 'gt', 100_000), cap('IN', 500e6, null), n('revQYoY', 'gt', 20), n('perf1M', 'gt', -10),
    cmp('sma21', 'ge', 'sma50'), n('atrP', 'gt', 3), n('epsQYoY', 'gt', 20), n('ebitdaQYoY', 'gt', 0), btw('pe', 0, 40),
  ] },
  { id: 'in-weekly-gainers', name: 'Weekly Gainers Stocks india copy', market: 'IN', builtIn: true, filters: [
    n('chg1W', 'gt', 7), n('px', 'ge', 5), cap('IN', 300e6, 10e12), cmp('px', 'ge', 'sma21'), cmp('px', 'ge', 'sma50'), n('avgVol10', 'gt', 500_000),
  ] },
  { id: 'in-rsi-55', name: 'RSI Above 55', market: 'IN', builtIn: true, filters: [
    secEx('Finance'), cap('IN', 1e9, 10e12), n('avgVol10', 'gt', 500_000), n('revQYoY', 'gt', 20), cmp('sma50', 'ge', 'sma200'), n('gpQYoY', 'gt', 20), n('rsi', 'gt', 55),
  ] },
  { id: 'in-growth-margins', name: 'India Growth & Margins', market: 'IN', builtIn: true, filters: [
    n('ebitdaQoQ', 'gt', 0), cap('IN', 1e9, 500e9), n('revQYoY', 'gt', 20), n('gmFY', 'gt', 25), n('revAYoY', 'gt', 10), n('opmFY', 'gt', 10),
    secEx('Energy Minerals', 'Non-Energy Minerals', 'Finance'), n('emp', 'gt', 100), n('roeTTM', 'gt', 5), n('de', 'lt', 3), n('gpQYoY', 'gt', 40),
  ] },
  RULE_OF_40('IN'),
  { id: 'in-growth-stocks', name: 'India Growth Stocks', market: 'IN', builtIn: true, filters: [
    secEx('Communications', 'Finance'), btw('vol', 30_000, 5e10), btw('revQYoY', 20, 250), n('ptmTTM', 'gt', 0), n('gmFY', 'gt', 0), n('revTTMYoY', 'gt', 15), n('emp', 'gt', 100),
    n('opmTTM', 'gt', 10), n('gpQYoY', 'gt', 30), ex('NSE'),
  ] },
];

/** Every built-in screen: USA first, then India (the page groups them). */
export const BUILT_IN_SCREENS: readonly Screen[] = [
  ...US_SCREENS, ...DUAL_SCREENS.filter((s) => s.market === 'US'),
  ...IN_SCREENS, ...DUAL_SCREENS.filter((s) => s.market === 'IN'),
];

/** Saved screens are kept in the browser (synced to the owner's database by the vault). Pure clean-up of what was stored. */
export const SCREENS_KEY = 'mc:stock-screens:v1';
function cleanFilter(f: any): Filter | null {
  const c = cleanFilterShape(f);
  return c && f.off === true ? { ...c, off: true } : c;
}
function cleanFilterShape(f: any): Filter | null {
  if (!f || typeof f !== 'object') return null;
  if (f.kind === 'sector') return Array.isArray(f.sectors) ? { kind: 'sector', sectors: f.sectors.filter((s: unknown) => typeof s === 'string').slice(0, 40) } : null;
  if (f.kind === 'exch') return Array.isArray(f.ex) ? { kind: 'exch', ex: f.ex.filter((s: unknown) => typeof s === 'string').slice(0, 10) } : null;
  if (f.kind === 'pattern') return { kind: 'pattern', ...cleanPatternRule(f) };
  if (!fieldOf(f.key)) return null;
  if (f.kind === 'date') return f.op === 'thisMonth' || f.op === 'pastYears' ? { kind: 'date', key: f.key, op: f.op, ...(fin(f.v) ? { v: f.v } : {}) } : null;
  if (f.kind === 'cmp') return fieldOf(f.other) && ['above', 'below', 'ge', 'le'].includes(f.op) ? { kind: 'cmp', key: f.key, op: f.op, other: f.other } : null;
  if (f.kind === 'near') return fieldOf(f.other) && fin(f.lo) && fin(f.hi) ? { kind: 'near', key: f.key, other: f.other, lo: f.lo, hi: f.hi } : null;
  if (f.kind === 'num') return fin(f.v) && ['gt', 'ge', 'lt', 'le', 'between'].includes(f.op) ? { kind: 'num', key: f.key, op: f.op, v: f.v, ...(fin(f.v2) ? { v2: f.v2 } : {}) } : null;
  return null;
}
export function cleanScreens(raw: unknown): Screen[] {
  if (!Array.isArray(raw)) return [];
  const out: Screen[] = [];
  for (const s of raw.slice(0, 100)) {
    if (!s || typeof s !== 'object') continue;
    const x = s as any;
    if (typeof x.id !== 'string' || typeof x.name !== 'string' || (x.market !== 'US' && x.market !== 'IN') || !Array.isArray(x.filters)) continue;
    const filters = (x.filters as any[]).map(cleanFilter).filter((f): f is Filter => !!f);
    out.push({ id: x.id.slice(0, 60), name: x.name.slice(0, 80), market: x.market, filters });
  }
  return out;
}
